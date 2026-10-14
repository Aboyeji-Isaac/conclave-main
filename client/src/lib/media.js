// The accept lists for the attach menu, mirrored from ALLOWED_MIME_TYPES in
// backend/src/controllers/upload.controller.js.
//
// These are enumerated rather than written as `image/*`, `text/*` and `audio/*`
// because the server is enumerated too. A broad `image/*` offered image/bmp,
// which the server refuses with a 415 — so the browser's filter promised a
// type the upload would then reject. Enumerating both keeps the promise and the
// allowlist the same list.
//
// Video is absent because the server excludes it: a 25MB ceiling is a poor
// limit for video, so it is held back rather than half-supported. Offering it
// here would be a guaranteed 415.
//
// Server sections, for the comparison:
//   images   svg, jpeg, png, gif, webp
//   documents pdf, text/plain, text/markdown, text/csv
//   office   msword, docx, xls, xlsx, ppt, pptx
//   archives zip, gzip
//   audio    mpeg, ogg, wav, webm, mp4

/**
 * The multer limit in routes/upload.routes.js, stated here so the rejection
 * happens before a 25MB request is put on the wire, and so the message names
 * the real bound rather than echoing whatever the server happened to say.
 */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** MAX_ATTACHMENTS in services/message.service.js — per message, not per pick. */
export const MAX_ATTACHMENTS = 10;

/** What "Photos & videos" and "Camera" may pick. Images only, like the server. */
export const PHOTO_ACCEPT = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
].join(',');

/** What "Document" may pick: everything the server accepts that is not an image. */
export const DOCUMENT_ACCEPT = [
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip',
  'application/gzip',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'audio/webm',
  'audio/mp4',
].join(',');

/**
 * Whether the server would accept this file's declared type.
 *
 * Checked before the upload rather than after, so a rejection is an immediate
 * message naming the file instead of a multi-second round trip that ends in a
 * bare 415.
 *
 * @param {string} type - the file's `type`, which browsers leave blank for
 *   extensions they do not recognise (`.md` is the common case)
 * @param {string} filename - used as the fallback when `type` is blank
 */
export function isAccepted(type, filename = '') {
  const all = `${PHOTO_ACCEPT},${DOCUMENT_ACCEPT}`.split(',');
  if (type && all.includes(type)) return true;

  // Browsers report '' for .md and for several audio containers, so the
  // extension is the only signal the client has. The server still checks the
  // declared type first, so this only narrows what we *offer* to send — it does
  // not widen what the server will store.
  const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')).toLowerCase() : '';
  const byExtension = {
    '.md': ['text/markdown', 'text/plain'],
    '.txt': ['text/plain'],
    '.csv': ['text/csv'],
    '.jpg': ['image/jpeg'],
    '.jpeg': ['image/jpeg'],
    '.png': ['image/png'],
    '.gif': ['image/gif'],
    '.webp': ['image/webp'],
    '.svg': ['image/svg+xml'],
    '.pdf': ['application/pdf'],
    '.zip': ['application/zip'],
    '.gz': ['application/gzip'],
    '.doc': ['application/msword'],
    '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    '.xls': ['application/vnd.ms-excel'],
    '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    '.ppt': ['application/vnd.ms-powerpoint'],
    '.pptx': ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    '.mp3': ['audio/mpeg'],
    '.ogg': ['audio/ogg'],
    '.wav': ['audio/wav'],
    '.weba': ['audio/webm'],
    '.m4a': ['audio/mp4'],
  };

  const allowed = byExtension[ext];
  if (!allowed) return false;
  return !type || allowed.includes(type);
}
