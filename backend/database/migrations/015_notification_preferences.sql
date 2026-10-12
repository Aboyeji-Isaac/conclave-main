-- Per-user notification preferences (phase 7, frontend.md section 16).
--
-- Settings offered a "notification preferences" section with nothing behind it:
-- no route, no service, no table, nothing to store a choice in. A checkbox that
-- forgets what you ticked is worse than no checkbox, so this table is what makes
-- that section honest.
--
-- One row per user rather than a column per preference. The preference set is
-- the notification `type` allowlist (notification.service.js), and that list is
-- expected to grow with new notification kinds — a column per type would mean a
-- migration every time one ships, where a jsonb map does not.
--
-- Defaults live here as NOT NULL columns rather than as "missing row means on".
-- A missing row and a row of explicit choices have to mean the same thing, and
-- the only way to guarantee that is to never allow the first state to mean
-- anything different from the second: the read path treats "no row" as these
-- values, and the write path upserts into them.
--
-- `muted_at` rather than a boolean, because a preference that turns itself off
-- needs to remember when it went quiet. A bool can only say whether something
-- is muted; a timestamp also says whether to un-mute it when they come back.
-- NULL means not muted, so the column is its own answer.
--
-- CASCADE on user_id so account deletion (users.controller deleteMe) leaves
-- nothing behind. That endpoint already strips the user row's own fields in a
-- transaction, and this goes with it for free.

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id           UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,

  -- 'all' | 'mentions' | 'none'. Deliberately not a per-type map: the bell is
  -- one control, and three states is what a person can hold in their head. The
  -- per-type `muted` map below is for the finer-grained case.
  activity_level    TEXT NOT NULL DEFAULT 'all'
                      CHECK (activity_level IN ('all', 'mentions', 'none')),

  -- Per-type overrides, keyed by the notification type. Absent key = follow
  -- activity_level. jsonb so adding a notification type is not a migration.
  muted             JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Whether a push/sound should fire at all, as opposed to what is recorded.
  -- Recorded but not enforced: there is no push or sound transport in this
  -- build (no FCM, no web-push), so this is stored and returned honestly rather
  -- than left as a UI switch that silently does nothing.
  push_enabled      BOOLEAN NOT NULL DEFAULT TRUE,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- `muted` must be a JSON object. Deeper validation — that every value is a
-- boolean, and that every key is a real notification type — cannot live here:
-- Postgres forbids subqueries in CHECK constraints, and `jsonb_each_text` is one.
-- It runs in the controller instead, where it can also reject an unknown type by
-- name, which a CHECK could not do without hardcoding the allowlist into the
-- schema and breaking every time a notification kind is added.
ALTER TABLE notification_preferences
  DROP CONSTRAINT IF EXISTS notification_preferences_muted_shape;
ALTER TABLE notification_preferences
  ADD CONSTRAINT notification_preferences_muted_shape
  CHECK (jsonb_typeof(muted) = 'object');