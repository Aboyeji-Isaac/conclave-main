import IconAudio from '@/assets/icons/audio-file.svg?react';
import IconDocument from '@/assets/icons/document.svg?react';
import IconDownload from '@/assets/icons/download.svg?react';
import IconFile from '@/assets/icons/file.svg?react';
import IconImage from '@/assets/icons/image.svg?react';
import IconSpreadsheet from '@/assets/icons/spreadsheet.svg?react';
import { useState } from 'react';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import { useToast } from '@/contexts/ToastContext';
import useAttachmentImage from '@/hooks/useAttachmentImage';
import { downloadAttachment } from '@/services/attachments.service';

/**
 * A human-readable byte count.
 *
 * Binary units rather than decimal, because the server's 25MB cap is stated in
 * binary megabytes — showing "26.2 MB" for a file under the limit is the kind
 * of small lie that makes a limit look arbitrary.
 */
function formatSize(bytes) {
  if (typeof bytes !== 'number' || Number.isNaN(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

function iconFor(mimeType = '') {
  if (mimeType.startsWith('image/')) return IconImage;
  if (mimeType.startsWith('audio/')) return IconAudio;
  if (mimeType.startsWith('video/')) return IconFile;
  if (mimeType.includes('sheet') || mimeType.includes('excel')) return IconSpreadsheet;
  if (mimeType.startsWith('text/') || mimeType.includes('pdf') || mimeType.includes('document')) {
    return IconDocument;
  }
  return IconFile;
}

function FileAttachment({ attachment }) {
  const Icon = iconFor(attachment.mime_type);
  const size = formatSize(attachment.size);
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  // An optimistic row has no id yet, so there is nothing to fetch.
  const ready = Boolean(attachment.id);

  const handleClick = async () => {
    if (!ready || busy) return;
    setBusy(true);
    try {
      await downloadAttachment(attachment);
    } catch (err) {
      toast({ title: 'Download failed', description: err.message, tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={!ready || busy}
      className="group flex w-full max-w-sm items-center gap-3 rounded-lg border border-line bg-canvas px-3 py-2.5 text-left transition-colors hover:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 disabled:opacity-70"
    >
      <Icon className="h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body text-ink">
          {attachment.filename || 'Attachment'}
        </span>
        <span className="block text-metadata text-muted">{ready ? size : 'Sending…'}</span>
      </span>
      <IconDownload
        className={`h-4 w-4 shrink-0 text-muted transition-colors group-hover:text-brand ${
          busy ? 'animate-pulse' : ''
        }`}
        aria-hidden="true"
      />
      <span className="sr-only">Download {attachment.filename}</span>
    </button>
  );
}

function ImageAttachment({ attachment }) {
  const { src, failed } = useAttachmentImage(attachment);
  const [open, setOpen] = useState(false);
  const { toast } = useToast();

  const save = () =>
    downloadAttachment(attachment).catch((err) =>
      toast({ title: 'Download failed', description: err.message, tone: 'error' }),
    );

  if (failed) return <FileAttachment attachment={attachment} />;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={!src}
        aria-label={`Open ${attachment.filename}`}
        className="relative block w-full max-w-xs overflow-hidden rounded-xl bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
      >
        {src ? (
          <img src={src} alt={attachment.filename} className="max-h-72 w-full object-cover" />
        ) : (
          <span className="block aspect-[4/3] w-full animate-pulse bg-line" aria-hidden="true" />
        )}
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={attachment.filename}
        footer={
          <Button variant="secondary" onClick={save}>
            Download
          </Button>
        }
      >
        {src && (
          <img
            src={src}
            alt={attachment.filename}
            className="mx-auto max-h-[65vh] w-auto max-w-full object-contain"
          />
        )}
      </Modal>
    </>
  );
}

export default function AttachmentCard({ attachment }) {
  const isImage = attachment.id && (attachment.mime_type || '').startsWith('image/');
  return isImage ? <ImageAttachment attachment={attachment} /> : <FileAttachment attachment={attachment} />;
}
