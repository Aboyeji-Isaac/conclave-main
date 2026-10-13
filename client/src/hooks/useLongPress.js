import { useCallback, useRef } from "react";

const DELAY_MS = 450;
const MOVE_TOLERANCE_PX = 10;

export default function useLongPress(
  onLongPress,
  { delay = DELAY_MS, disabled = false } = {},
) {
  const timerRef = useRef(null);
  const firedRef = useRef(false);
  const startRef = useRef({ x: 0, y: 0 });

  const clear = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const onTouchStart = useCallback(
    (event) => {
      if (disabled) return;
      const touch = event.touches[0];
      startRef.current = { x: touch.clientX, y: touch.clientY };
      firedRef.current = false;
      clear();
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        firedRef.current = true;
        onLongPress();
      }, delay);
    },
    [clear, delay, disabled, onLongPress],
  );

  // Scrolling the chat must never open a menu, so a drag cancels the press.
  const onTouchMove = useCallback(
    (event) => {
      if (!timerRef.current) return;
      const touch = event.touches[0];
      const movedX = Math.abs(touch.clientX - startRef.current.x);
      const movedY = Math.abs(touch.clientY - startRef.current.y);
      if (movedX > MOVE_TOLERANCE_PX || movedY > MOVE_TOLERANCE_PX) clear();
    },
    [clear],
  );

  // After a long press, swallow the click the browser would send on release,
  // otherwise it can land on a menu item that opened under the finger.
  const onTouchEnd = useCallback(
    (event) => {
      clear();
      if (firedRef.current) {
        event.preventDefault();
        firedRef.current = false;
      }
    },
    [clear],
  );

  // Android Chrome fires this on long press, and a desktop right click does too.
  const onContextMenu = useCallback(
    (event) => {
      if (disabled) return;
      event.preventDefault();
      clear();
      onLongPress();
    },
    [clear, disabled, onLongPress],
  );

  return {
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onTouchCancel: clear,
    onContextMenu,
  };
}
