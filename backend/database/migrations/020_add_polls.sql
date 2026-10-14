-- Polls.
--
-- A poll is a message. The message row carries the question as its content, so
-- previews, search, replies, reactions, pins and deletion all keep working with
-- no special cases. These tables hold only what a message cannot: the options
-- and the votes.
--
-- That split is the point. A poll bolted onto `messages` as a nullable blob
-- would have needed its own read path in every place a message already has one,
-- and a poll that is not a message cannot be replied to, pinned or searched.
-- Instead `polls.message_id` is UNIQUE, so at most one poll hangs off a message
-- and a question cannot be edited after people have voted on it.
--
-- poll_votes has a composite foreign key to (poll_id, option_id), so a vote can
-- never point at an option from a different poll. The primary key is
-- (option_id, user_id): one vote per person per option. A single-choice poll
-- is enforced in poll.service.castVote, which replaces the voter's rows — so
-- multi-choice stays expressible (pick two options) while single-choice stays
-- honest (replacing the whole set cannot leave a stray second row behind).
--
-- Votes are deliberately public: the asker wants to know who voted for what, so
-- there is no anonymity to protect and no separate "results only" read path.

CREATE TABLE IF NOT EXISTS polls (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id     UUID NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
  room_id        UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  created_by     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question       TEXT NOT NULL,
  allow_multiple BOOLEAN NOT NULL DEFAULT FALSE,
  closed_at      TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS poll_options (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id  UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  label    TEXT NOT NULL,
  position SMALLINT NOT NULL,
  UNIQUE (poll_id, id),
  UNIQUE (poll_id, position)
);

CREATE TABLE IF NOT EXISTS poll_votes (
  poll_id    UUID NOT NULL,
  option_id  UUID NOT NULL,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (option_id, user_id),
  FOREIGN KEY (poll_id, option_id) REFERENCES poll_options (poll_id, id) ON DELETE CASCADE
);

-- One row per option per poll: the shape every read path wants, and the
-- window index for counting a poll's votes without touching users.
CREATE INDEX IF NOT EXISTS idx_poll_votes_poll_user ON poll_votes (poll_id, user_id);
