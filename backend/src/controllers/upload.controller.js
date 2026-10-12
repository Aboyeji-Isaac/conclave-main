const cloudinary = require('../config/cloudinary');
const { query } = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { ok } = require('../utils/apiResponse');

// BACKEND_TASKS.md item C: which uploads we accept.
//
// Video is deliberately absent for now — the 25MB cap in upload.routes.js is a
// poor ceiling for it, so it is held back rather than half-supported.
//
// SVG is allowed. It is safe in the current client, which renders only the
// filename and never the URL, and it stays safe if previews are added later
// because <img src> does not execute script in an SVG. The exposure would be
// <object>, <embed>, or inlining the markup — avoid those. The real residual
// risk is a user hosting branded content on our Cloudinary quota.
//
// NOTE: this list is checked against req.file.mimetype, which is the
// client-declared multipart Content-Type, not a sniffed type. A client can
// declare image/png and upload anything. Cloudinary stores the real bytes, so
// nothing executable is served as an image, but the mime_type recorded here can
// be inaccurate. See the note in 010_add_file_uploads.sql.
const ALLOWED_MIME_TYPES = new Set([
  // images
  'image/svg+xml',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  // documents
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  // office — word
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  // office — sheet
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  // office — presentation
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  // archives
  'application/zip',
  'application/gzip',
  // audio
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'audio/webm',
  'audio/mp4',
]);

// Keep in step with the multer limit in upload.routes.js. Redundant on the happy
// path — multer rejects anything larger before we get here — but it means the
// bound does not live in exactly one place.
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * Where an asset is stored in Cloudinary.
 *
 * This was `'auto'`, which sounded safer because Cloudinary classifies the file
 * itself. It is not, for documents: `auto` files a PDF under the `image` store
 * because Cloudinary can render its pages, and then serving the *original* PDF
 * back out of an image store fails — measured as a 401 "deny or ACL failure" on
 * this account for a PDF that had uploaded perfectly. Only plain images were
 * reliably retrievable.
 *
 * So the split is made explicitly: an image is an image, and everything else is
 * raw. `auto` also decided *per request* and could disagree with the record
 * written for it, which is worse than deciding once and storing the answer.
 *
 * @param {string} mimetype - as declared by the client (see note above)
 * @returns {'image'|'raw'}
 */
function resourceTypeFor(mimetype) {
  return mimetype.startsWith('image/') ? 'image' : 'raw';
}

/**
 * Push an in-memory buffer to Cloudinary and resolve with the stored asset.
 * Uses a stream rather than the buffer overload so the upload does not need a
 * second copy of the file in memory on top of multer's.
 *
 * Returns the public_id and resource_type as well as the URL: delivery is
 * served through the Admin API (see attachments.controller), and that endpoint
 * is addressed by public_id, not by URL. The URL is still stored, because it is
 * what the client used before the proxy existed and is the only thing left to
 * fall back on for rows written before migration 016.
 *
 * @returns {Promise<{ url: string, publicId: string, resourceType: string, bytes: number, format: string }>}
 */
function streamToCloudinary(buffer, filename, resourceType) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: resourceType,
        use_filename: true,
        filename_override: filename,
        // Folder them so the quota is easy to audit and clean up later.
        folder: 'conclave/attachments',
      },
      (error, result) => {
        if (error) return reject(error);
        // Cloudinary's delivery signature is always taken over
        // `public_id + "." + format`, but which half carries the extension is
        // inconsistent across resource types on this account: listing the
        // assets back shows `conclave/attachments/x.pdf` with format undefined
        // for a raw file, and `conclave/attachments/y` with format "png" for an
        // image. So the reference is normalised here, once, to always include
        // the extension — and the proxy can then sign the stored value verbatim
        // instead of guessing which shape it got.
        // `format` is absent for raw uploads on this account (the extension is already
        // inside public_id), so it has to be guarded: a naive template produced
        // "…/x.pdf.undefined" and Cloudinary answered 404.
        const suffix = result.format ? `.${result.format}` : '';
        const cloudRef =
          suffix && !String(result.public_id).endsWith(suffix)
            ? `${result.public_id}${suffix}`
            : result.public_id;
        resolve({
          url: result.secure_url,
          publicId: cloudRef,
          resourceType: result.resource_type || resourceType,
          bytes: result.bytes,
          format: result.format,
        });
      },
    );

    // Only the buffer goes to end() — the second argument is an *encoding*, so
    // passing metadata there throws ERR_UNKNOWN_ENCODING.
    stream.on('error', reject);
    stream.end(buffer);
  });
}

/**
 * Accept a multipart upload, store it in Cloudinary, and record it so a later
 * message can attach it exactly once.
 *
 * Response shape is { filename, url, mime_type, size } — the same shape
 * listMessages returns. Note that clients must send only `url` back when
 * attaching; filename/mime_type/size are read from the record created here, not
 * from the request (see services/message.service.js).
 */
const uploadFile = asyncHandler(async (req, res) => {
  if (!cloudinary.isConfigured()) {
    throw new ApiError(503, 'File uploads are not configured on this server');
  }

  if (!req.file) {
    throw new ApiError(400, 'No file provided');
  }

  const { buffer, mimetype, originalname } = req.file;

  if (!ALLOWED_MIME_TYPES.has(mimetype)) {
    throw new ApiError(415, `Unsupported file type: ${mimetype}`);
  }

  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new ApiError(413, 'File exceeds the 25MB limit');
  }

  const filename = (originalname || 'upload').trim() || 'upload';

  let asset;
  const resourceType = resourceTypeFor(mimetype);
  try {
    asset = await streamToCloudinary(buffer, filename, resourceType);
  } catch (err) {
    // Cloudinary is an upstream dependency: a failure here is a 502, not our
    // bug, and its own error types are meaningless to the client. Logged because
    // otherwise a credential or quota problem is invisible — the client only
    // ever sees "temporarily unavailable".
    console.error('Cloudinary upload failed', err);
    throw new ApiError(502, 'File storage is temporarily unavailable');
  }

  const size = typeof asset.bytes === 'number' ? asset.bytes : buffer.length;

  // UNIQUE on file_url: if Cloudinary ever hands back a URL we already have, the
  // insert fails rather than creating a second unclaimed record for one asset.
  try {
    await query(
      `INSERT INTO file_uploads (uploader_id, file_url, filename, mime_type, size_bytes, public_id, resource_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [req.user.id, asset.url, filename, mimetype, size, asset.publicId, asset.resourceType],
    );
  } catch (err) {
    if (err.code === '23505') {
      throw new ApiError(409, 'That file has already been uploaded');
    }
    // 42P01 is undefined_table — the 010 migration has not been run.
    if (err.code === '42P01') {
      throw new ApiError(503, 'File uploads are not available on this server');
    }
    throw err;
  }

  // Wrapped in the standard { success, data } envelope every other route uses.
  return ok(res, {
    filename,
    url: asset.url,
    mime_type: mimetype,
    size,
  }, 201);
});

module.exports = { uploadFile, resourceTypeFor, ALLOWED_MIME_TYPES, MAX_UPLOAD_BYTES };