const { pool, query } = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { ok } = require('../utils/apiResponse');
const ApiError = require('../utils/ApiError');

const UPDATABLE_FIELDS = ['display_name', 'avatar_url', 'bio'];
const PAGE_SIZE = 25;

// Per-field length ceilings. Without these, updateProfile accepted an
// arbitrarily long avatar_url or bio (BACKEND_TASKS.md Bug 15).
const FIELD_LIMITS = {
  display_name: 100,
  avatar_url: 2048,
  bio: 1000,
};

// ---------- getMe ----------
const getMe = asyncHandler(async (req, res) => {
  const result = await query(
    'SELECT id, email, display_name, avatar_url, bio, created_at FROM users WHERE id = $1 AND deleted_at IS NULL',
    [req.user.id]
  );
  if (result.rows.length === 0) {
    throw new ApiError(404, 'User not found');
  }
  return ok(res, result.rows[0]);
});

// ---------- updateProfile ----------
// Whitelist-only update: only display_name, avatar_url, bio can change here.
// Email/password changes need their own, more carefully guarded endpoints
// later (not added yet — changing email should probably re-verify it,
// changing password needs the current password confirmed).
const updateProfile = asyncHandler(async (req, res) => {
  // 1. Whitelist: pull out only the fields we allow, ignore everything else
  const updates = {};
  for (const field of UPDATABLE_FIELDS) {
    if (req.body[field] !== undefined) updates[field] = req.body[field];
  }

  if (Object.keys(updates).length === 0) {
    throw new ApiError(
      400,
      `No updatable fields provided. Allowed: ${UPDATABLE_FIELDS.join(', ')}`
    );
  }

  if ('display_name' in updates && !String(updates.display_name).trim()) {
    throw new ApiError(400, 'display_name cannot be empty');
  }

  for (const [field, value] of Object.entries(updates)) {
    const limit = FIELD_LIMITS[field];
    if (limit === undefined) continue;
    if (value !== null && String(value).length > limit) {
      throw new ApiError(400, `${field} must be at most ${limit} characters`);
    }
  }

  // 2. Build a dynamic SET clause from only the whitelisted fields present
  //    in this request — never string-interpolate values, only column names
  //    from our own constant list above.
  const setClauses = [];
  const values = [];
  let i = 1;
  for (const [field, value] of Object.entries(updates)) {
    setClauses.push(`${field} = $${i}`);
    values.push(field === 'display_name' ? String(value).trim() : value);
    i += 1;
  }
  values.push(req.user.id);

  // 3. Apply the update, return the fresh row
  const result = await query(
    `UPDATE users SET ${setClauses.join(', ')} WHERE id = $${i}
     RETURNING id, email, display_name, avatar_url, bio, created_at`,
    values
  );

  if (result.rows.length === 0) {
    throw new ApiError(404, 'User not found');
  }

  return ok(res, result.rows[0]);
});

// ---------- listUsers ----------
// Paginated user directory, optionally filtered by a search term matching
// display_name or email. Primary use case: "add member to room" pickers.
const listUsers = asyncHandler(async (req, res) => {
  const { q, page = '1' } = req.query;
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const offset = (pageNum - 1) * PAGE_SIZE;

  const params = [];
  let where = 'WHERE deleted_at IS NULL';
  if (q && q.trim()) {
    params.push(`%${q.trim()}%`);
    where += ` AND (display_name ILIKE $${params.length} OR email ILIKE $${params.length})`;
  }

  params.push(PAGE_SIZE, offset);
  const result = await query(
    `SELECT id, display_name, avatar_url, email, created_at
     FROM users
     ${where}
     ORDER BY display_name ASC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  return ok(res, {
    users: result.rows,
    page: pageNum,
    pageSize: PAGE_SIZE,
    hasMore: result.rows.length === PAGE_SIZE,
  });
});

// ---------- searchUsers ----------
// A picker-safe subset of listUsers, for the "start a conversation" and
// "add a member" screens.
//
// listUsers returns `email` to every authenticated caller, which is defensible
// for an admin directory and wrong for a people picker: a compose box would
// hand every user's email address to anyone who can type a name. This endpoint
// exists so those two screens have a path that cannot leak one.
//
// Email is still searchable — you can type an address and find the person it
// belongs to — it is just never returned.
const searchUsers = asyncHandler(async (req, res) => {
  const { q, page = '1' } = req.query;
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const offset = (pageNum - 1) * PAGE_SIZE;

  // An empty query would return the whole directory, which is not a search.
  // "Recent" is a different screen with a different answer; this one answers
  // "find someone I have a name for".
  if (!q || !q.trim()) {
    return ok(res, { users: [], page: pageNum, pageSize: PAGE_SIZE, hasMore: false });
  }

  const result = await query(
    `SELECT id, display_name, avatar_url
     FROM users
     WHERE deleted_at IS NULL
       AND (display_name ILIKE $1 OR email ILIKE $1)
     ORDER BY display_name ASC
     LIMIT $2 OFFSET $3`,
    [`%${q.trim()}%`, PAGE_SIZE, offset]
  );

  return ok(res, {
    users: result.rows,
    page: pageNum,
    pageSize: PAGE_SIZE,
    hasMore: result.rows.length === PAGE_SIZE,
  });
});

// ---------- deleteMe ----------
// Soft-delete the authenticated user's account. Anonymizes profile data,
// kills all sessions, and removes room memberships in a transaction.
// Messages, decisions, and tasks are preserved — they still reference
// sender_id/created_by which still exists; the JOIN on users returns
// "Deleted user" for display.
const deleteMe = asyncHandler(async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Anonymize and mark deleted
    await client.query(
      `UPDATE users
       SET deleted_at = NOW(),
           email = NULL,
           password_hash = '',
           display_name = 'Deleted user',
           avatar_url = NULL,
           bio = NULL
       WHERE id = $1 AND deleted_at IS NULL`,
      [req.user.id],
    );

    // 2. Kill all sessions (refresh tokens)
    await client.query('DELETE FROM refresh_tokens WHERE user_id = $1', [req.user.id]);

    // 3. Remove from all rooms
    await client.query('DELETE FROM room_members WHERE user_id = $1', [req.user.id]);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return ok(res, { message: 'Account deleted' });
});

module.exports = { getMe, updateProfile, listUsers, searchUsers, deleteMe };
