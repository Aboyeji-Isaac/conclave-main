/**
 * A local, bounded copy of attachment bytes.
 *
 * IndexedDB rather than localStorage. The two reasons are not decorative:
 * localStorage only stores strings, so every file would be base64'd and grow
 * by a third before it is stored, and it is synchronously limited to a few
 * megabytes per origin — one 25MB upload would fill it. IndexedDB stores
 * `Blob`s as they are, asynchronously, and does not have that ceiling.
 *
 * The key is the file's URL, not its attachment id. The same Cloudinary asset
 * can be reached through two ids (a message and its decision copy, for one),
 * and the URL is also the only key the sender has at upload time, before any
 * message row exists. One key, two callers, no reconciliation step.
 *
 * The store is capped by bytes, not by count: entries are `Blob`s of wildly
 * different sizes, so a record limit would let a handful of videos occupy the
 * whole budget. Eviction is least-recently-*used* rather than oldest-inserted —
 * `lastUsedAt` is touched on every read, so a conversation the user scrolls
 * past daily keeps its images while a month-old PDF falls out.
 *
 * Everything is best-effort. Private modes, storage pressure and quota errors
 * all degrade to "no cache", never to a failed render: a file the user can see
 * but not open is worse than one that re-downloads.
 */

const DB_NAME = 'conclave-files';
const DB_VERSION = 1;
const STORE = 'files';

const MAX_BYTES = 250 * 1024 * 1024;

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'url' });
        store.createIndex('lastUsedAt', 'lastUsedAt');
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open file cache'));
    request.onblocked = () => reject(new Error('File cache blocked by another tab'));
  }).catch((error) => {
    // Cache the failure too: a browser without IndexedDB should not pay the
    // open cost on every read.
    dbPromise = null;
    throw error;
  });

  return dbPromise;
}

/**
 * Read every record's metadata (no blobs) to get the running total and an
 * eviction order.
 *
 * @returns {Promise<Array<{url: string, size: number, lastUsedAt: number}>>}
 */
async function readMeta() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).getAll();
    request.onsuccess = () => {
      const rows = request.result || [];
      resolve(
        rows.map(({ url, size, lastUsedAt }) => ({
          url,
          size: Number(size) || 0,
          lastUsedAt: Number(lastUsedAt) || 0,
        })),
      );
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Drop least-recently-used entries until `incoming` bytes fit under the cap.
 *
 * @param {number} incoming - size about to be written
 */
async function evictToFit(incoming) {
  let meta;
  try {
    meta = await readMeta();
  } catch {
    return;
  }

  let total = meta.reduce((sum, row) => sum + row.size, 0) + incoming;
  if (total <= MAX_BYTES) return;

  const oldestFirst = [...meta].sort((a, b) => a.lastUsedAt - b.lastUsedAt);

  try {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    for (const row of oldestFirst) {
      if (total <= MAX_BYTES) break;
      store.delete(row.url);
      total -= row.size;
    }
  } catch {
    // Nothing to do: eviction is advisory.
  }
}

/**
 * @param {string} url
 * @returns {Promise<Blob|null>} the cached bytes, or null on any miss
 */
export async function getFile(url) {
  if (!url) return null;

  let db;
  try {
    db = await openDb();
  } catch {
    return null;
  }

  try {
    const row = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).get(url);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    if (!row?.blob) return null;

    // Touch on read, not on insert, so "recently used" tracks the last time
    // the user actually saw the file. Fire-and-forget: a failed touch must not
    // fail the read it accompanies.
    const touched = db.transaction(STORE, 'readwrite');
    touched.objectStore(STORE).put({
      ...row,
      lastUsedAt: Date.now(),
    });
    touched.onerror = () => {};

    return row.blob;
  } catch {
    return null;
  }
}

/**
 * @param {string} url
 * @param {Blob|File} blob
 * @returns {Promise<boolean>} whether the file is now cached
 */
export async function putFile(url, blob) {
  if (!url || !blob) return false;

  const size = blob.size || 0;
  if (size > MAX_BYTES) return false;

  try {
    await evictToFit(size);

    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ url, blob, size, lastUsedAt: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Wipe everything.
 *
 * Called on sign-out. The cache is keyed by URL and URLs are per-account
 * signed or short-lived, and more to the point a shared device should not
 * still hold one user's conversation after another logs in — "cache" is a
 * performance detail, not a licence to retain.
 *
 * @returns {Promise<void>}
 */
export async function clearLocalFiles() {
  try {
    const db = await openDb();
    await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch {
    // Nothing retained, or nothing to clear.
  }

  try {
    await new Promise((resolve) => {
      const request = indexedDB.deleteDatabase(DB_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      // Another tab may hold the DB open; the store is already empty, so this
      // does not need to block sign-out.
      request.onblocked = () => resolve();
    });
  } catch {
    // Ignore.
  }
}
