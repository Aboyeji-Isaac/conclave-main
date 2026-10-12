-- Message pins (phase 8, wave 5).
--
-- Decisions had a pin; messages did not. Migration 014 deliberately put a
-- decision's pins in a row rather than a column on `decisions`, and the same
-- reasoning applies here — a pin is an action somebody took, so keeping it in a
-- row records who, for free, with the same two routes and the same query shape
-- for both scopes.
--
-- A bare `pinned BOOLEAN` on `messages` would have thrown that away and needed a
-- second table to get it back, and it could not answer "pinned by whom".
--
--   scope = 'user'  a personal bookmark. Only its author sees it in the panel,
--                   only they remove it. Nothing about the room changes.
--   scope = 'room'  a room-wide pin. Every member sees it. Removing one is a
--                   moderation act, so the author of the pin OR a room admin may
--                   do it.
--
-- At most ONE room pin per message, enforced by the partial unique index below.
-- "Pinned to the room" is a state a message is in, not a pile of people who each
-- said so — with several rows the panel would have to pick one to attribute, and
-- an admin's unpin could remove a row that is not the one being displayed.
--
-- A second user pinning to the room gets a 409 naming who holds it, rather than
-- silently becoming the new owner.
--
-- Composite primary key so pinning is idempotent: a second PUT with the same
-- (message, user, scope) is an UPDATE of pinned_at rather than a duplicate row,
-- exactly as decision_pins does. ON DELETE CASCADE on both keys means deleting a
-- message or an account leaves no orphaned pins behind for the panel to join
-- against.
--
-- The panel reads the room's pins by scanning the primary key, which covers
-- (message_id, user_id); an index led by room is not needed here because the read
-- path joins through messages.room_id and filters on message_id — the same shape
-- the decision strip uses against its own table.

CREATE TABLE IF NOT EXISTS message_pins (
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  scope      TEXT NOT NULL CHECK (scope IN ('user', 'room')),
  pinned_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (message_id, user_id, scope)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_message_pins_one_room_pin
  ON message_pins (message_id)
  WHERE scope = 'room';

-- Reads by message (attaching pins to a page of messages) and by room for the
-- panel's full listing, which is the reverse of what the decision strip does
-- because a message page arrives keyed by id while a panel arrives keyed by room.
CREATE INDEX IF NOT EXISTS idx_message_pins_user
  ON message_pins (user_id, message_id);