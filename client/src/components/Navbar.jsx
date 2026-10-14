import { NavLink, useLocation, useMatch } from "react-router-dom";
import { useNotifications } from "@/contexts/NotificationsContext";
import Logo from "@/components/landing/Logo";
import IconMenu from "../assets/icons/menu.svg?react";
import IconNotify from "../assets/icons/notify.svg?react";

const TITLES = [
  ["/chats", "Chats"],
  ["/tasks", "Tasks"],
  ["/decisions", "Decisions"],
  ["/digest", "Catch up"],
  ["/notifications", "Notifications"],
  ["/settings", "Settings"],
  ["/profile", "Profile"],
  ["/new", "New chat"],
];

function titleFor(pathname) {
  const match = TITLES.find(
    ([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  return match ? match[1] : "Conclave";
}

const iconButton =
  "relative grid h-10 w-10 shrink-0 place-items-center rounded-lg text-ink transition-colors hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30";

/**
 * The header.
 *
 * Left: the sidebar button and the bell, then the page title. On chat routes the
 * header splits into the same two columns as the chat shell, so the room's own
 * header sits above the conversation instead of above the list. Below md, an
 * open room replaces the whole row with the room header (back arrow, name),
 * which is how phone messengers behave.
 *
 * Search lives in the chat list now, next to the thing it filters.
 *
 * @param {React.ReactNode|null} roomHeader - a richer title supplied by the route
 * @param {() => void} onMenuClick
 * @param {string} menuLabel
 */
export default function Navbar({
  roomHeader = null,
  onMenuClick,
  menuLabel = "Open menu",
}) {
  const { pathname } = useLocation();
  const roomOpen = Boolean(useMatch("/chats/:roomId/*"));
  const inChats = pathname.startsWith("/chats");
  const { unreadCount } = useNotifications();

  // Below md an open room shows its own header, unless the page has not
  // supplied one (the room info page), in which case the controls stay.
  const roomOwnsRow = roomOpen && Boolean(roomHeader);

  return (
    <header className="border-b border-line bg-surface">
      <nav
        className={`grid h-16 grid-cols-1 items-center ${
          inChats ? "md:grid-cols-[var(--list-w)_1fr]" : ""
        }`}
      >
        <div
          className={`flex min-w-0 items-center justify-between px-3 ${roomOwnsRow ? "hidden md:flex" : ""}`}
        >
          <NavLink to="/chats" aria-label="Conclave, home" className="md:hidden">
            <Logo withWordmark />
          </NavLink>

          <div className="ml-auto flex items-center gap-1 md:ml-0">
            <button
              type="button"
              onClick={onMenuClick}
              aria-label={menuLabel}
              className={iconButton}
            >
              <IconMenu className="h-6 w-6" aria-hidden="true" />
            </button>

            <NavLink
              to="/notifications"
              aria-label={
                unreadCount > 0
                  ? `Notifications, ${unreadCount} unread`
                  : "Notifications"
              }
              className={iconButton}
            >
              <IconNotify className="h-6 w-6" aria-hidden="true" />
              {unreadCount > 0 && (
                <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-metadata font-semibold text-surface">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </NavLink>

            <div className="ml-2 hidden min-w-0 flex-1 truncate text-h2 text-ink md:block">
              {titleFor(pathname)}
            </div>
          </div>
        </div>

        {inChats && (
          <div
            className={`min-w-0 md:border-l md:border-line md:px-4 ${
              roomOwnsRow ? "px-3" : "hidden md:block"
            }`}
          >
            {roomHeader}
          </div>
        )}
      </nav>
    </header>
  );
}
