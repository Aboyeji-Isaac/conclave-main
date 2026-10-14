import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import IconArrowDown from '@/assets/icons/arrow-down.svg?react';
import EmptyState from '../ui/EmptyState';
import Spinner from '../ui/Spinner';
import { annotateMessages, daySeparatorLabel } from '@/lib/messageMeta';
import Message from './Message';
import TypingIndicator from './TypingIndicator';

function DaySeparator({ label }) {
  return (
    <div className="my-4 flex items-center gap-3" role="separator" aria-label={label}>
      <span className="h-px flex-1 bg-line" aria-hidden="true" />
      <span className="shrink-0 text-metadata text-muted">{label}</span>
      <span className="h-px flex-1 bg-line" aria-hidden="true" />
    </div>
  );
}

const NEAR_BOTTOM_PX = 120;

/**
 * The conversation timeline.
 *
 * Day separators, grouped runs, the typing row, load-older, and a "jump to
 * latest" pill. Each is derived from the message list rather than tracked as
 * separate UI state, so a reload, a socket edit and a paginated page all
 * produce the same rendering.
 *
 * Loading older messages prepends ABOVE the current scroll position and
 * preserves it by offset. Without that compensation the container's scroll
 * height grows upward, the browser keeps the same scrollTop, and the reader is
 * silently dropped thousands of pixels down the history they did not ask for —
 * the single most disorienting bug a paginated chat can have.
 *
 * @param {Array} messages - ascending by created_at, already merged
 * @param {{ current: HTMLElement }} scrollContainerRef
 */
export default function MessageTimeline({
  messages,
  scrollContainerRef,
  viewerId,
  members = [],
  isAdmin,
  roomId,
  deliveryIds,
  typingUserIds = [],
  hasMore,
  isLoadingOlder,
  onLoadOlder,
  onReply,
  onEdit,
  onDelete,
  onPromote,
  onFlagTask,
  onPin,
  onUnpin,
  onToggleReaction,
}) {
  const contentRef = useRef(null);
  const topSentinelRef = useRef(null);
  const stickRef = useRef(true); // are we following the bottom?
  const placedRoomRef = useRef(null); // which room has had its first scroll
  const lastSeenRef = useRef({ firstId: null, lastId: null });
  const heightBeforeOlderRef = useRef(0);
  const [showJump, setShowJump] = useState(false);
  const [newBelow, setNewBelow] = useState(0);

  const hasMessages = messages.length > 0;
  const annotated = useMemo(() => annotateMessages(messages), [messages]);
  const messagesById = useMemo(
    () => new Map(annotated.map((message) => [message.id, message])),
    [annotated],
  );

  // A Map lookup instead of a scan per row.
  const replyTargetFor = (message) =>
    message.reply_to_id ? messagesById.get(message.reply_to_id) || null : null;

  // Instant on purpose. A smooth scroll fires scroll events on the way down,
  // and those events are what decide whether we are "at the bottom".
  const scrollToBottom = useCallback(() => {
    const container = scrollContainerRef?.current;
    if (container) container.scrollTop = container.scrollHeight;
    stickRef.current = true;
    setShowJump(false);
    setNewBelow(0);
  }, [scrollContainerRef]);

  useEffect(() => {
    const container = scrollContainerRef?.current;
    if (!container) return undefined;

    const handleScroll = () => {
      const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
      const atBottom = distance <= NEAR_BOTTOM_PX;
      stickRef.current = atBottom;
      setShowJump(!atBottom);
      if (atBottom) setNewBelow(0);
    };

    handleScroll();
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [scrollContainerRef]);

  // Runs before paint, so the reader never sees the top of the room flash by.
  useLayoutEffect(() => {
    const container = scrollContainerRef?.current;
    if (!container || annotated.length === 0) return;

    const first = annotated[0];
    const last = annotated[annotated.length - 1];
    const seen = lastSeenRef.current;

    if (placedRoomRef.current !== roomId) {
      // 1. First paint of this room: open at the latest message.
      placedRoomRef.current = roomId;
      container.scrollTop = container.scrollHeight;
      stickRef.current = true;
    } else if (seen.firstId && first.id !== seen.firstId && last.id === seen.lastId) {
      // 2. Older page prepended: keep the reader on the message they were on.
      if (heightBeforeOlderRef.current > 0) {
        container.scrollTop += container.scrollHeight - heightBeforeOlderRef.current;
        heightBeforeOlderRef.current = 0;
      }
    } else if (last.id !== seen.lastId) {
      // 3. Something new at the bottom. Your own sends always follow.
      const mine = last.sender_id === viewerId;
      if (mine || stickRef.current) {
        container.scrollTop = container.scrollHeight;
        stickRef.current = true;
        setShowJump(false);
        setNewBelow(0);
      } else {
        setNewBelow((count) => count + 1);
      }
    }

    lastSeenRef.current = { firstId: first.id, lastId: last.id };
  }, [annotated, roomId, viewerId, scrollContainerRef]);

  // Images loading, the composer growing and the mobile keyboard opening all
  // change heights without a message arriving. Stay on the bottom through them.
  useEffect(() => {
    const container = scrollContainerRef?.current;
    const content = contentRef.current;
    if (!container || !content || typeof ResizeObserver === 'undefined') return undefined;

    const observer = new ResizeObserver(() => {
      if (stickRef.current) container.scrollTop = container.scrollHeight;
    });
    observer.observe(content);
    observer.observe(container);
    return () => observer.disconnect();
  }, [scrollContainerRef, hasMessages]);

  const requestOlder = useCallback(() => {
    const container = scrollContainerRef?.current;
    if (container) heightBeforeOlderRef.current = container.scrollHeight;
    onLoadOlder?.();
  }, [onLoadOlder, scrollContainerRef]);

  useEffect(() => {
    const node = topSentinelRef.current;
    const container = scrollContainerRef?.current;
    if (!node || !container || !hasMore || !onLoadOlder) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) requestOlder();
      },
      { root: container, rootMargin: '200px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, onLoadOlder, requestOlder, scrollContainerRef, messages.length]);

  if (!messages.length) {
    return (
      // Fills the scroller row so the notice centres in the pane. Left bare,
      // EmptyState is only `min-h-48`, which collapsed the row to 192px and left
      // the composer floating in the space below it. `min-h-full` rather than
      // `h-full` so a viewport too short for the notice scrolls instead of
      // clipping the text.
      <div className="flex min-h-full flex-col justify-center">
        <EmptyState
          title="Start the conversation"
          description="Messages sent to this room will appear here."
        />
      </div>
    );
  }

  return (
    <div
      ref={contentRef}
      className="relative mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 pb-5 pt-4 md:px-7"
    >
      {hasMore && (
        <div ref={topSentinelRef} className="py-2">
          {isLoadingOlder && <Spinner label="Loading earlier messages" />}
        </div>
      )}

      {annotated.map((message, index) => (
        <Fragment key={message.id}>
          {message._startsDay && (
            <DaySeparator label={daySeparatorLabel(message.created_at)} />
          )}
          {/* mt-auto on the first row keeps a short conversation pinned to the
              bottom of the pane, next to the composer, rather than stranded at
              the top with a void beneath it. */}
          <div className={index === 0 ? 'mt-auto' : message._consecutive ? 'mt-0.5' : 'mt-3'}>
            <Message
              message={message}
              viewerId={viewerId}
              members={members}
              isAdmin={isAdmin}
              roomId={roomId}
              replyTarget={replyTargetFor(message)}
              deliveryIds={deliveryIds}
              onReply={onReply}
              onEdit={onEdit}
              onDelete={onDelete}
              onPromote={onPromote}
              onFlagTask={onFlagTask}
              onPin={onPin}
              onUnpin={onUnpin}
              onToggleReaction={onToggleReaction}
            />
          </div>
        </Fragment>
      ))}

      <TypingIndicator typingUserIds={typingUserIds} members={members} />

      {/*
        `sticky`, not `absolute`. This container is the scroll *content*, so an
        absolutely positioned child anchors to the end of the whole transcript
        — measured 910px below the visible pane, visible only once the reader
        had already scrolled to the bottom, which is the one moment the pill is
        not needed. `sticky` pins it to the scrollport instead.

        The wrapper is `h-0` so it reserves no space: `showJump` flips on every
        scroll tick, and an in-flow button would shove the transcript each time
        it appeared or disappeared.
      */}
      {showJump && (
        <div className="pointer-events-none sticky bottom-3 z-10 h-0">
          <button
            type="button"
            onClick={scrollToBottom}
            className="pointer-events-auto absolute bottom-0 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-line bg-surface px-4 py-2 text-label text-ink shadow-modal transition-colors hover:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
          >
            <IconArrowDown className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
            {newBelow > 0 ? `${newBelow} new message${newBelow === 1 ? '' : 's'}` : 'Jump to latest'}
          </button>
        </div>
      )}
    </div>
  );
}
