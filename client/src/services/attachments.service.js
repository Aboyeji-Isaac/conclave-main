import { api } from '../lib/api';
import { clearLocalFiles as clearFileStore, getFile, putFile } from '@/lib/fileCache';

/**
 * Fetching an attachment.
 *
 * Two levels in front of the network: a synchronous module-level map of
 * promises, and the IndexedDB store in `fileCache`. The map exists because the
 * same image is requested many times in one session — every re-render of a
 * message row restarts its effect — and an IDB round trip, however fast, is
 * still async work per render. The store exists because the map dies with the
 * tab. Neither is a correctness concern: a miss falls through to the network,
 * which is where the file lives anyway.
 *
 * Documents are still fetched on click rather than prefetched. Prefetching
 * every PDF in a transcript would spend the same budget the image cache is
 * designed to protect, on files nobody has asked to see.
 */

// url -> Promise<Blob>. Keyed by URL for the same reason as fileCache.
const memo = new Map();

async function readError(error) {
  const data = error.response?.data;
  // With responseType "blob", a JSON error body arrives as a Blob.
  if (data instanceof Blob) {
    try {
      return JSON.parse(await data.text()).message;
    } catch {
      return null;
    }
  }
  return data?.message || null;
}

/** Accepts an attachment object, or a bare id for the oldest callers. */
function normalise(attachment) {
  if (typeof attachment === 'string' || typeof attachment === 'number') {
    return { id: attachment, url: null };
  }
  return attachment || {};
}

function cacheKey(attachment) {
  const { url, id } = attachment;
  return url || (id ? `id:${id}` : null);
}

function dropMemo(key) {
  if (key) memo.delete(key);
}

/**
 * @param {object|string} attachment
 * @param {{ cache?: boolean }} [options] - `cache: false` skips the reads but
 *   still writes, so a download leaves the file ready for the next open.
 * @returns {Promise<Blob>}
 */
export function fetchAttachmentBlob(attachment, { cache = true } = {}) {
  const record = normalise(attachment);
  const key = cacheKey(record);

  if (!record.id) return Promise.reject(new Error('This file is still sending.'));

  if (key && memo.has(key)) return memo.get(key);

  const pending = (async () => {
    if (cache && key) {
      const hit = await getFile(key);
      if (hit) return hit;
    }

    try {
      const response = await api.get(`/attachments/${record.id}`, { responseType: 'blob' });
      const blob = response.data;
      // Not awaited: storing must never delay the thing it is stored for, and
      // putFile cannot reject.
      if (key) putFile(key, blob);
      return blob;
    } catch (error) {
      dropMemo(key);
      throw new Error((await readError(error)) || 'Could not load this file.');
    }
  })();

  if (key) memo.set(key, pending);
  return pending;
}

/**
 * Store a file the user just uploaded, before any message row names it.
 *
 * The sender has bytes and a URL and nothing else — the message that will
 * reference it may not exist yet — which is exactly what the cache is keyed on.
 * Written at upload time rather than at render time because that is the only
 * moment both are in hand.
 *
 * @param {string} url
 * @param {Blob|File} blob
 * @returns {Promise<boolean>}
 */
export function rememberUploadedFile(url, blob) {
  if (!url || !blob) return Promise.resolve(false);
  const key = url;
  memo.delete(key);
  return putFile(key, blob);
}

/**
 * Empty both cache levels.
 *
 * `fileCache` handles what outlives the tab; the memo has to go too, or a
 * signed-out session would keep serving blobs from memory until a reload.
 *
 * @returns {Promise<void>}
 */
export async function clearLocalFiles() {
  memo.clear();
  await clearFileStore();
}

export async function downloadAttachment(attachment) {
  const blob = await fetchAttachmentBlob(attachment, { cache: false });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = attachment.filename || 'download';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
}
