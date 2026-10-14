import { useEffect, useState } from 'react';
import IconAudio from '@/assets/icons/audio-file.svg?react';
import IconClose from '@/assets/icons/close.svg?react';
import IconDocument from '@/assets/icons/document.svg?react';
import IconFile from '@/assets/icons/file.svg?react';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';

/**
 * The full-screen preview a picked file lands in, before anything is uploaded.
 *
 * Picking a file used to start the upload immediately, which meant the file was
 * on its way to Cloudinary before the user had decided to send it, and the
 * message went out the moment the last upload returned. This inverts that: the
 * bytes stay local until Send is pressed, so a file chosen by mistake is
 * discarded with Cancel rather than becoming an orphaned asset, and the caption
 * is written where the file can be seen.
 *
 * Nothing is lost on failure. An upload that fails leaves this dialog open with
 * the files and the caption exactly as they were and the reason spelled out, so
 * the retry is one press and the text never had to be retyped. That is the
 * whole reason the failure path does not dismiss: a preview that vanishes on
 * error turns a transient upstream problem into lost work.
 *
 * Object URLs are made here and revoked when the file list changes or the
 * dialog unmounts. They are never stored anywhere else, so a revoked URL can
 * never find its way onto the wire — `uploadFile` takes the `File` itself.
 *
 * @param {boolean} open
 * @param {File[]} files - the picked files; empty closes the dialog
 * @param {string} initialCaption - the composer's draft at the moment of picking
 * @param {boolean} sending - an upload is in flight; closing is blocked
 * @param {string} error - shown in place of a status line
 * @param {(caption: string) => void} onSend
 * @param {() => void} onCancel
 * @param {(index: number) => void} onRemoveFile - dropping the last one closes
 */
export default function AttachmentPreviewDialog({
  open,
  files,
  initialCaption = '',
  sending = false,
  error = '',
  onSend,
  onCancel,
  onRemoveFile,
}) {
  const [caption, setCaption] = useState(initialCaption);
  const [activeIndex, setActiveIndex] = useState(0);
  const [urls, setUrls] = useState([]);

  // Re-seeded on open rather than on every file change: removing one file from
  // a set of three must not wipe the caption being written alongside them.
  useEffect(() => {
    if (!open) return;
    setCaption(initialCaption);
    setActiveIndex(0);
  }, [open, initialCaption]);

  useEffect(() => {
    if (!open || files.length === 0) return undefined;
    const next = files.map((file) => URL.createObjectURL(file));
    setUrls(next);
    return () => next.forEach((url) => URL.revokeObjectURL(url));
  }, [open, files]);

  if (!open || files.length === 0) return null;

  const index = Math.min(activeIndex, files.length - 1);
  const active = files[index];
  const isImage = (file) => Boolean(file?.type?.startsWith('image/'));
  const Icon = active?.type === 'application/pdf' ? IconDocument
    : active?.type?.startsWith('audio/') ? IconAudio
    : IconFile;

  const formatSize = (bytes) => {
    if (!Number.isFinite(bytes)) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const submit = (event) => {
    event?.preventDefault();
    if (sending) return;
    onSend(caption);
  };

  return (
    <Modal
      open
      onClose={onCancel}
      closeDisabled={sending}
      fullscreen
      title="Send attachment"
      footer={
        <form onSubmit={submit} className="flex w-full items-end gap-3">
          <label className="min-w-0 flex-1">
            <span className="sr-only">Add a caption</span>
            <textarea
              value={caption}
              onChange={(event) => setCaption(event.target.value)}
              rows={1}
              placeholder="Add a caption…"
              disabled={sending}
              className="block max-h-32 min-h-10 w-full resize-none rounded-lg border border-line bg-surface px-3.5 py-2.5 text-body text-ink outline-none transition-shadow placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand/15 disabled:opacity-60"
            />
          </label>
          <Button
            variant="primary"
            type="submit"
            disabled={sending}
            className="shrink-0"
            aria-label={sending ? 'Uploading' : 'Send'}
          >
            {sending ? 'Uploading…' : 'Send'}
          </Button>
        </form>
      }
    >
      <div className="flex h-full flex-col">
        <div className="flex min-h-0 flex-1 items-center justify-center bg-canvas p-4">
          {isImage(active) && urls[index] ? (
            <img
              src={urls[index]}
              alt={active.name}
              className="max-h-full max-w-full rounded-lg object-contain"
            />
          ) : (
            <div className="flex max-w-xs flex-col items-center gap-3 text-center">
              <span className="grid h-20 w-20 place-items-center rounded-2xl bg-brand-soft text-brand">
                <Icon className="h-10 w-10" aria-hidden="true" />
              </span>
              <p className="break-words text-body text-ink">{active.name}</p>
              <p className="text-metadata text-muted">{formatSize(active.size)}</p>
            </div>
          )}
        </div>

        {files.length > 1 && (
          <div className="scrollbar-none flex shrink-0 gap-2 overflow-x-auto border-t border-line px-4 py-3">
            {files.map((file, i) => (
              <div key={`${file.name}-${i}`} className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => setActiveIndex(i)}
                  aria-label={`Preview ${file.name}`}
                  aria-current={i === index}
                  className={`block overflow-hidden rounded-lg border-2 transition-colors ${
                    i === index ? 'border-brand' : 'border-transparent'
                  }`}
                >
                  {isImage(file) && urls[i] ? (
                    <img src={urls[i]} alt="" className="h-14 w-14 object-cover" />
                  ) : (
                    <span className="grid h-14 w-14 place-items-center rounded-lg bg-canvas text-muted">
                      <IconFile className="h-6 w-6" aria-hidden="true" />
                    </span>
                  )}
                </button>
                {!sending && (
                  <button
                    type="button"
                    onClick={() => onRemoveFile(i)}
                    aria-label={`Remove ${file.name}`}
                    className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-ink text-surface transition-colors hover:bg-error focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
                  >
                    <IconClose className="h-3 w-3" aria-hidden="true" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {error && (
          <p role="alert" className="shrink-0 border-t border-line bg-canvas px-4 py-2.5 text-metadata text-error">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
