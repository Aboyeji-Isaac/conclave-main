import { useEffect, useRef, useState } from 'react';
import IconClose from '@/assets/icons/close.svg?react';
import IconMention from '@/assets/icons/mention.svg?react';
import IconSend from '@/assets/icons/send.svg?react';
import { uploadFile } from '@/services/messages.service';
import { rememberUploadedFile } from '@/services/attachments.service';
import { isAccepted, MAX_ATTACHMENTS, MAX_UPLOAD_BYTES } from '@/lib/media';
import AttachmentPicker from './AttachmentPicker';
import AttachmentPreviewDialog from './AttachmentPreviewDialog';
import MentionPicker from './MentionPicker';

const MAX_LINES = 5;

/**
 * The composer.
 *
 * Three things it has to get right, and one it must not fake.
 *
 * IME safety: Enter must not send while a composition is in flight. Japanese,
 * Korean and Chinese input commit with Enter, so a naive handler eats the
 * character the user just chose. `isComposing` is the honest check; the
 * keyCode fallback covers browsers that report it inconsistently.
 *
 * Growing: the box starts at one line and grows to five, then scrolls. A
 * fixed-height composer either wastes a row on a one-word reply or clips a
 * pasted paragraph, and the clipboard is where most long messages come from.
 *
 * Mentions record ids. The name goes in the text, the id goes on the wire, and
 * the two are independent from that point — renaming the person later does not
 * rewrite history.
 *
 * Files are picked into a full-screen preview and only uploaded when Send is
 * pressed there, so the bytes are never on their way to storage before the user
 * has decided to send. A failed upload keeps the preview open with the files,
 * the caption and the reason intact — the text must survive the failure, which
 * is the one thing the earlier upload-on-pick design was right to insist on.
 *
 * @param {boolean} disabled - no realtime connection
 * @param {(payload: object) => void} onSend
 * @param {Array} members - room members, for the mention picker
 * @param {() => void} onTyping - emits a typing event, throttled by the caller
 * @param {object|null} replyTo - message being replied to
 * @param {() => void} onCancelReply
 * @param {() => void} [onCreatePoll] - opens the poll dialog when supplied
 * @param {() => void} [onCreateDecision] - opens the decision dialog when supplied
 * @param {() => void} [onCreateTask] - opens the task dialog when supplied
 */
export default function MessageComposer({
  disabled,
  onSend,
  members = [],
  onTyping,
  replyTo,
  onCancelReply,
  onCreatePoll,
  onCreateDecision,
  onCreateTask,
  // The room pane is a grid and addresses its rows explicitly, so the composer
  // needs to accept the placement the parent decides rather than hardcoding one.
  className = '',
}) {
  const [content, setContent] = useState('');
  const [error, setError] = useState('');
  const [pendingFiles, setPendingFiles] = useState([]);
  const [sending, setSending] = useState(false);
  const [mentionQuery, setMentionQuery] = useState(null);
  const [mentionedIds, setMentionedIds] = useState([]);

  const textareaRef = useRef(null);
  const typingTimer = useRef(null);
  // Bumped when the preview is abandoned so an upload still in flight knows its
  // result is no longer wanted and must not touch state that has moved on.
  const sendToken = useRef(0);

  // Auto-grow. Reset to auto first so shrinking works, then clamp at five
  // lines — beyond that the box scrolls rather than eating the timeline.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const lineHeight = Number.parseFloat(getComputedStyle(el).lineHeight) || 20;
    el.style.height = `${Math.min(el.scrollHeight, lineHeight * MAX_LINES)}px`;
  }, [content]);

  useEffect(
    () => () => {
      if (typingTimer.current) clearTimeout(typingTimer.current);
    },
    [],
  );

  const signalTyping = () => {
    onTyping?.();
    // Throttled: the server expires a typing state after a few seconds of
    // silence, so re-announcing on a timer while the keys keep moving is what
    // keeps the indicator honest without a packet per keystroke.
    if (typingTimer.current) return;
    typingTimer.current = setTimeout(() => {
      typingTimer.current = null;
    }, 2500);
  };

  const handleTextChange = (event) => {
    const { value, selectionStart } = event.target;
    setContent(value);
    setError('');
    signalTyping();

    // Reconcile the recorded ids against the text that is actually there.
    // mentionedIds only ever grew, so deleting "@Priya" after selecting her left
    // the id in place and the mention still fired on send — a notification for
    // somebody the message no longer names. Ids are rebuilt from the members
    // whose @token is still present, which is the same fact the server acts on.
    setMentionedIds((prev) => {
      if (prev.length === 0) return prev;
      return prev.filter((id) => {
        const person = members.find((entry) => entry.id === id);
        if (!person) return false;
        return value.includes(`@${person.display_name}`);
      });
    });

    // The mention query is whatever follows an @ that has no space after it,
    // ending at the caret. Cheap, and correct for the only case that matters:
    // typing a name immediately after the @.
    const before = value.slice(0, selectionStart);
    const match = before.match(/@([^\s@]*)$/);
    setMentionQuery(match ? match[1] : null);
  };

  const applyMention = (member) => {
    const el = textareaRef.current;
    const caret = el?.selectionStart ?? content.length;
    const before = content.slice(0, caret);
    const after = content.slice(caret);
    const match = before.match(/@([^\s@]*)$/);

    // With no token to replace, append at the caret instead of giving up. The
    // picker can be opened without an `@` (the button used to do exactly that),
    // and returning early there left the list open and the text untouched with
    // no indication anything had been attempted.
    const start = match ? before.length - match[0].length : caret;
    const insertion = `@${member.display_name} `;
    setContent(`${content.slice(0, start)}${insertion}${after}`);
    setMentionQuery(null);
    setMentionedIds((prev) => (prev.includes(member.id) ? prev : [...prev, member.id]));

    requestAnimationFrame(() => {
      const position = start + insertion.length;
      el?.setSelectionRange(position, position);
      el?.focus();
    });
  };

  /**
   * Accept the picked files into the preview, or explain why none of them fit.
   *
   * The type check runs here rather than waiting for the server's 415 so the
   * message can name the file: a rejection after a multi-second round trip says
   * only what the server decided, and the browser's own `accept` filter is not
   * enough on its own because it does not run when a file arrives by any other
   * path.
   *
   * The preview only ever opens with a non-empty list — if nothing survived,
   * the composer stays put and says so, rather than presenting an empty modal.
   *
   * @param {File[]} files
   */
  const handleFiles = (files) => {
    const rejected = [];
    const accepted = [];

    for (const file of files) {
      if (file.size > MAX_UPLOAD_BYTES) {
        rejected.push(`"${file.name}" is larger than the 25MB limit.`);
      } else if (!isAccepted(file.type, file.name)) {
        rejected.push(`"${file.name}" is not a file type this app can store.`);
      } else {
        accepted.push(file);
      }
    }

    if (accepted.length > MAX_ATTACHMENTS) {
      rejected.push(
        `A message can hold at most ${MAX_ATTACHMENTS} files; the extra ${
          accepted.length - MAX_ATTACHMENTS
        } were not added.`,
      );
      accepted.length = MAX_ATTACHMENTS;
    }

    const note = rejected.join(' ');
    setError(note);

    if (accepted.length > 0) {
      setPendingFiles(accepted);
    }
  };

  const removeFile = (index) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
    // The remaining files stay, so a leftover rejection note about the file
    // that is no longer there would be actively misleading.
    setError('');
  };

  // Backing out of the preview discards the picked files and any caption typed
  // into it, and leaves the composer untouched — the draft was only ever read
  // from it, never moved out of it, so cancelling cannot lose text.
  const cancelPreview = () => {
    sendToken.current += 1;
    setSending(false);
    setPendingFiles([]);
    setError('');
  };

  /**
   * Upload every pending file, then send the message they belong to.
   *
   * Sequential rather than parallel: an error has to name a file, and with
   * requests in flight at once the one that failed is not knowable. Ten files
   * is the ceiling, and each is a single small request.
   *
   * On failure nothing is cleared. The preview stays open with the files, the
   * caption and the reason, so the retry costs one press and no typing — losing
   * the message along with the file is the outcome this whole flow exists to
   * avoid.
   *
   * @param {string} caption - what the user typed in the preview
   */
  const submitPreview = async (caption) => {
    if (sending || pendingFiles.length === 0) return;

    const token = ++sendToken.current;
    setSending(true);
    setError('');

    let attachments;
    try {
      attachments = [];
      for (const file of pendingFiles) {
        const stored = await uploadFile(file);
        if (sendToken.current !== token) return;
        // Now, rather than when the message renders: at this instant the file
        // has bytes and a URL and the message that will name it does not exist
        // yet, and the URL is the cache key. This is the sender's half of the
        // store — the receiver's half is the first open of the image.
        await rememberUploadedFile(stored.url, file);
        attachments.push({ url: stored.url });
      }
    } catch (err) {
      if (sendToken.current !== token) return;
      // The reason first — a server says something useful, a dropped connection
      // does not, and axios's own "Network Error" explains nothing to the
      // person reading it. The second half is the part that matters: it says
      // out loud what the open preview already proves, so a failure does not
      // look like a lost message.
      const reason =
        err?.response?.data?.message ||
        (err?.code === 'ERR_NETWORK' || err?.message === 'Network Error'
          ? 'Could not reach the server.'
          : err?.message) ||
        'Could not upload one of the files.';
      const sentence = reason.endsWith('.') ? reason : `${reason}.`;
      setSending(false);
      setError(`${sentence} Nothing was sent — the files and caption are still here.`);
      return;
    }

    try {
      onSend({
        content: caption.trim(),
        replyToId: replyTo?.id,
        attachments,
        // Rebuilt from the caption rather than reused from the composer: the
        // caption is editable here, so the ids have to follow the text that is
        // actually going out — the same rule handleTextChange applies.
        mentionedUserIds: members
          .filter((person) => caption.includes(`@${person.display_name}`))
          .map((person) => person.id),
      });
    } catch (err) {
      if (sendToken.current !== token) return;
      setSending(false);
      setError(err?.message || 'Could not send this message.');
      return;
    }

    if (sendToken.current !== token) return;
    setSending(false);
    setPendingFiles([]);
    reset();
  };

  const reset = () => {
    setContent('');
    setMentionedIds([]);
    setMentionQuery(null);
    onCancelReply?.();
  };

  const submit = (event) => {
    event?.preventDefault();
    const text = content.trim();
    if (!text || disabled) return;

    try {
      onSend({
        content: text,
        replyToId: replyTo?.id,
        attachments: [],
        mentionedUserIds: mentionedIds,
      });
      reset();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleKeyDown = (event) => {
    // A composition is in flight (IME). Enter is committing a character, not
    // sending a message.
    if (event.nativeEvent?.isComposing || event.keyCode === 229) return;

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <form
      onSubmit={submit}
      className={`relative mx-auto w-full max-w-3xl shrink-0 bg-surface px-4 pb-6 pt-2 ${className}`}
    >
      {replyTo && (
        <div className="mb-2 flex items-center gap-3 rounded-lg border-l-2 border-brand bg-canvas px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="text-metadata text-brand">Replying to {replyTo.sender_name || 'a message'}</p>
            <p className="truncate text-metadata text-muted">
              {replyTo.content || (replyTo.is_deleted ? 'deleted message' : 'attachment')}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancelReply}
            aria-label="Cancel reply"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-surface hover:text-ink"
          >
            <IconClose className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}

      <div className="relative flex items-end gap-2 rounded-lg border border-line bg-surface px-3 py-2 focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/10">
        <div className="flex shrink-0 gap-1 pb-1">
          <AttachmentPicker
            onFiles={handleFiles}
            disabled={disabled}
            onPoll={onCreatePoll}
            onDecision={onCreateDecision}
            onTask={onCreateTask}
          />
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              const el = textareaRef.current;
              const caret = el?.selectionStart ?? content.length;
              const before = content.slice(0, caret);
              const after = content.slice(caret);

              // Insert the @ for real. The button used to just open the picker,
              // which then did nothing: applyMention looks for an `@…` token
              // before the caret, found none, and returned before inserting text
              // or recording an id — so the list opened and no mention was ever
              // made.
              //
              // Appending rather than inserting when the text does not already
              // end in a mention keeps a second press from stacking `@`s, and
              // leaves an in-progress token (`@Pr`) alone to keep filtering on.
              if (!/@[^\s@]*$/.test(before)) {
                const separator = before && !/\s$/.test(before) ? ' ' : '';
                const next = `${before}${separator}@${after}`;
                setContent(next);
                const position = caret + separator.length + 1;
                requestAnimationFrame(() => {
                  el?.setSelectionRange(position, position);
                  el?.focus();
                });
              }

              textareaRef.current?.focus();
              setMentionQuery('');
            }}
            aria-label="Mention someone"
            className="grid h-8 w-8 place-items-center rounded-lg text-muted transition-colors hover:bg-canvas hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 disabled:opacity-40"
          >
            <IconMention className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <textarea
          ref={textareaRef}
          value={content}
          onChange={handleTextChange}
          onKeyDown={handleKeyDown}
          rows={1}
          placeholder="Message…"
          aria-label="Message"
          className="block min-h-6 min-w-0 flex-1 resize-none border-0 bg-transparent py-1 text-body text-ink outline-none placeholder:text-muted"
        />

        <button
          type="submit"
          disabled={disabled || !content.trim()}
          aria-label="Send message"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand pb-0.5 text-surface transition-opacity disabled:opacity-40"
        >
          <IconSend className="h-5 w-5" aria-hidden="true" />
        </button>

        {mentionQuery !== null && (
          <MentionPicker
            members={members}
            query={mentionQuery}
            onSelect={applyMention}
            onDismiss={() => setMentionQuery(null)}
          />
        )}
      </div>

      {error && pendingFiles.length === 0 && (
        <p role="alert" className="mt-2 px-1 text-metadata text-error">
          {error}
        </p>
      )}

      <AttachmentPreviewDialog
        open={pendingFiles.length > 0}
        files={pendingFiles}
        initialCaption={content}
        sending={sending}
        error={error}
        onSend={submitPreview}
        onCancel={cancelPreview}
        onRemoveFile={removeFile}
      />
    </form>
  );
}
