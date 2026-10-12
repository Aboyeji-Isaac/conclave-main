-- Cloudinary identifiers on uploads and attachments (phase 8, wave 3).
--
-- Attachments were served as `https://res.cloudinary.com/<cloud>/...` links
-- embedded in the message payload, and the client opened them directly. On this
-- Cloudinary account the delivery domain returns 401 "deny or ACL failure" for
-- everything that is not a plain image — a JPEG serves fine, a PDF and a ZIP
-- both fail — so an uploaded document could be stored and linked but never
-- downloaded.
--
-- The fix is to stop using the delivery domain and fetch through the Admin API
-- instead, which is authenticated with the same API credentials the upload
-- already uses and is not subject to delivery ACLs. That requires two things
-- the row did not carry:
--
--   public_id      e.g. 'conclave/attachments/report-abc123'. The delivery URL
--                  embeds this, but it has to be addressable on its own because
--                  the Admin API takes a public_id, not a URL.
--   resource_type  'image' | 'raw' | 'video'. Required by the Admin API path,
--                  and it is what makes the URL guessable-wrong: a PDF stored
--                  as 'image' cannot be fetched as a document.
--
-- Both are nullable. Rows written before this migration have neither, and the
-- read path falls back to parsing the stored delivery URL rather than leaving
-- those attachments unreachable. Nullable also keeps the migration additive and
-- re-runnable.
--
-- `attachments` gets the same two columns because the claim step in
-- message.service.js copies file_uploads → attachments and the proxy reads from
-- `attachments`: copying public_id there means the document's fetch coordinates
-- live with the document, not with a staging record that is otherwise about to
-- become irrelevant.

ALTER TABLE file_uploads
  ADD COLUMN IF NOT EXISTS public_id    TEXT,
  ADD COLUMN IF NOT EXISTS resource_type TEXT;

ALTER TABLE attachments
  ADD COLUMN IF NOT EXISTS public_id    TEXT,
  ADD COLUMN IF NOT EXISTS resource_type TEXT;

-- The proxy reads by attachment id after joining to the owning room, so this
-- is the same access path the row already gets through its primary key. No new
-- index is warranted; public_id is written once and read by that id.