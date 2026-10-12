-- Room descriptions and task bodies (phase 8, wave 3).
--
-- Two fields the client already collects and the server already throws away.
--
-- rooms.description
--   The flag-as-task and room-info work needed somewhere to put a room's
--   purpose. Without it an admin can rename a room but not describe it, and the
--   description is the part people actually want to change.
--
--   Deliberately NOT on `type`. A DM has no description worth writing: its
--   display name is derived from the other member on every read (see the
--   display_name CASE in listRooms and getRoom), so a description would be a
--   second piece of metadata about a conversation whose name is a person.
--
-- tasks.body
--   The flag-as-task dialog has rendered an optional "Notes" field for a while
--   and the value was never transmitted: the POST body carried title, assignee
--   and due date only, and this table had nowhere to put notes even if it had.
--   The dialog's own comment says the full message text "stays available in the
--   body field" — which was true of neither the wire nor the table.
--
-- Both nullable and unconstrained in the database. Length limits are enforced
-- in the controller alongside the rest of the input validation, the same place
-- UPDATABLE_FIELDS' limits are applied for users, so a column limit cannot
-- drift from the validation that describes it.

ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS description TEXT;

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS body TEXT;