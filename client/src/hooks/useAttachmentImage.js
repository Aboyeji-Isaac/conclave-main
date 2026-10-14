import { useEffect, useState } from 'react';
import { fetchAttachmentBlob } from '@/services/attachments.service';

/**
 * Resolve an attachment's image bytes to something an `<img>` can render.
 *
 * Takes the whole attachment rather than just its id: the cache is keyed by
 * `url`, and the id alone cannot produce one. `failed` is what the card falls
 * back to — an image that cannot be fetched renders as a document row instead
 * of a broken-image placeholder, which tells the user the file is still there
 * even though the picture is not.
 *
 * `src` is an object URL created here and revoked on cleanup. Reusing one URL
 * past the effect's lifetime would leave an `<img>` pointing at memory the
 * browser has already returned.
 *
 * @param {object|string} attachment
 * @returns {{src: string|null, failed: boolean}}
 */
export default function useAttachmentImage(attachment) {
  const [src, setSrc] = useState(null);
  const [failed, setFailed] = useState(false);

  const id = typeof attachment === 'string' ? attachment : attachment?.id;

  useEffect(() => {
    if (!id) return undefined;
    let active = true;
    let objectUrl = null;
    setSrc(null);
    setFailed(false);

    fetchAttachmentBlob(attachment, { cache: true })
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => {
        if (active) setFailed(true);
      });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // `attachment` itself is a fresh object on every message-array rebuild, so
    // it cannot be the dependency without re-fetching on every keystroke in the
    // composer. The id is the identity of the file.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return { src, failed };
}
