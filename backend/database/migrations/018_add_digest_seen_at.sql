-- Separate digest read pointer (phase 8, wave 4).
--
-- The catch-up digest has always filtered against room_members.last_seen_at,
-- and that is the reason it never worked for anyone who actually uses the app.
-- last_seen_at is a read receipt, and three different things move it:
--
--   POST /rooms/:roomId/seen   on opening a room
--   socket  message-read        when the timeline catches up
--   socket  leave-room          on unmounting the room view
--
-- All three write NOW(). So the act of reading the messages a digest is
-- reporting on also erases the evidence that you had not read them. Opening
-- every room you belong to and then visiting /digest — which is what any user
-- does on arriving — advances every pointer past every item, and the page
-- renders "Nothing to catch up on" for a workspace full of activity.
--
-- The two facts are genuinely different and cannot share a column:
-- last_seen_at answers "does this person know about messages in this room",
-- which drives delivery ticks and the unread badge and must move the instant
-- they read. digest_seen_at answers "has this person seen the catch-up list",
-- which is a deliberate action on the digest page and should not move as a side
-- effect of doing anything else.
--
-- Backfilled from last_seen_at so a deployment does not suddenly show everyone
-- a backlog of everything since they joined. The alternative — defaulting to
-- NOW() — would be a loud, wrong first render; inheriting the current pointer
-- means the new column starts where the old one was and diverges from here.
--
-- NOT NULL with a default, so a row can never be missing one and every read
-- path can compare against it unconditionally.

ALTER TABLE room_members
  ADD COLUMN IF NOT EXISTS digest_seen_at TIMESTAMPTZ;

UPDATE room_members
   SET digest_seen_at = last_seen_at
 WHERE digest_seen_at IS NULL;

ALTER TABLE room_members
  ALTER COLUMN digest_seen_at SET DEFAULT NOW();

ALTER TABLE room_members
  ALTER COLUMN digest_seen_at SET NOT NULL;

COMMENT ON COLUMN room_members.digest_seen_at IS
  'Last time this user marked the catch-up digest as read. Deliberately separate '
  'from last_seen_at: opening a room advances the read receipt, and using that '
  'column for the digest meant reading your messages erased the backlog.';