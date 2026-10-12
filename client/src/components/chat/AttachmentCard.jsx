import IconAudio from '@/assets/icons/audio-file.svg?react';
import IconDocument from '@/assets/icons/document.svg?react';
import IconDownload from '@/assets/icons/download.svg?react';
import IconFile from '@/assets/icons/file.svg?react';
import IconImage from '@/assets/icons/image.svg?react';
import IconSpreadsheet from '@/assets/icons/spreadsheet.svg?react';

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

/**
 * One attachment on a message.
 *
 * The href points at this app's own `/attachments/:id` rather than at the
 * stored Cloudinary URL, for two reasons that both turned out to matter:
 *
 * 1. Access. A direct Cloudinary link meant anyone who ever saw the URL could
 *    download the file with no check that they were in the room. The proxy
 *    resolves the attachment to its room and refuses anyone who is not a member.
 *
 * 2. Delivery. The Cloudinary delivery domain returns 401 "deny or ACL failure"
 *    on this account for everything that is not a plain image — images served
 *    fine, a PDF and a ZIP both failed — so every document attachment was a dead
 *    link. The proxy fetches through Cloudinary's authenticated API instead,
 *    which is not subject to those delivery rules.
 *
 * `download` is not set: the proxy already sends Content-Disposition:
 * attachment, and setting it twice would let a filename chosen by the sender
 * override the sanitised one the server emits.
 *
 * @param {{ id?: string, filename: string, size?: number, mime_type?: string, url: string }} attachment
 */
export default function AttachmentCard({ attachment }) {
  const Icon = iconFor(attachment.mime_type);
  const size = formatSize(attachment.size);

  // Fall back to the stored URL only when there is no id at all, which happens
  // for a message payload from before the proxy existed.
  const href = attachment.id ? `/attachments/${attachment.id}` : attachment.url;

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="group flex w-full max-w-sm items-center gap-3 rounded-lg border border-line bg-canvas px-3 py-2.5 transition-colors hover:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
    >
      <Icon className="h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body text-ink">{attachment.filename}</span>
        {size && <span className="block text-metadata text-muted">{size}</span>}
      </span>
      <IconDownload className="h-4 w-4 shrink-0 text-muted transition-colors group-hover:text-brand" aria-hidden="true" />
      <span className="sr-only">Download {attachment.filename}</span>
    </a>
  );
}
