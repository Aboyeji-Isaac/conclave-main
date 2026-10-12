// Seed a predictable local test room and accounts.
// Run after migrations with: npm run seed
const bcrypt = require("bcrypt");
const { pool } = require("../src/config/db");

const PASSWORD = "ConclaveTest123!";
const ROOM_SLUG = "conclave-test-room";
const USERS = [
  {
    email: "admin1@example.test",
    displayName: "Test Admin One",
    roomRole: "admin",
  },
  {
    email: "admin2@example.test",
    displayName: "Test Admin Two",
    roomRole: "admin",
  },
  {
    email: "member1@example.test",
    displayName: "Test Member One",
    roomRole: "member",
  },
  {
    email: "member2@example.test",
    displayName: "Test Member Two",
    roomRole: "member",
  },
  {
    email: "member3@example.test",
    displayName: "Test Member Three",
    roomRole: "member",
  },
];
const MESSAGES = [
  {
    id: "d0000000-0000-4000-8000-000000000001",
    sender: 0,
    content:
      "Welcome to the project room, everyone. Let’s use this chat to coordinate the first release.",
  },
  {
    id: "d0000000-0000-4000-8000-000000000002",
    sender: 2,
    content:
      "I’ve reviewed the main flows. The room list and sign-in are looking good on my end.",
  },
  {
    id: "d0000000-0000-4000-8000-000000000003",
    sender: 1,
    content:
      "Great. I’ll keep an eye on feedback and make sure we capture decisions here.",
  },
  {
    id: "d0000000-0000-4000-8000-000000000004",
    sender: 3,
    content:
      "I noticed the mobile layout could use a little more room around the message composer.",
  },
  {
    id: "d0000000-0000-4000-8000-000000000005",
    sender: 4,
    content:
      "Agreed. I can check that on a smaller screen and share a screenshot.",
  },
  {
    id: "d0000000-0000-4000-8000-000000000006",
    sender: 0,
    content:
      "Thanks. Let’s treat that as a polish item and keep the release scope focused.",
  },
  {
    id: "d0000000-0000-4000-8000-000000000007",
    sender: 2,
    content:
      "I’ll verify the sign-in and refresh flow with a second browser session too.",
  },
  {
    id: "d0000000-0000-4000-8000-000000000008",
    sender: 3,
    content:
      "The chat updates are arriving live for me. I’ll check that reconnecting restores the room.",
  },
  {
    id: "d0000000-0000-4000-8000-000000000009",
    sender: 1,
    content:
      "Please post any blockers here so we can decide what needs attention first.",
  },
  {
    id: "d0000000-0000-4000-8000-000000000010",
    sender: 4,
    content: "No blockers so far. I’ll report back after the responsive check.",
  },
  {
    id: "d0000000-0000-4000-8000-000000000011",
    sender: 2,
    content:
      "Quick update: both browser sessions stayed in sync after I refreshed one of them.",
  },
  {
    id: "d0000000-0000-4000-8000-000000000012",
    sender: 0,
    content:
      "Nice. Thanks, team. We have a good starting point for testing decisions and tasks next.",
  },
];

async function seed() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to seed test accounts when NODE_ENV=production");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const passwordHash = await bcrypt.hash(PASSWORD, 12);
    const userIds = [];
    for (const user of USERS) {
      const result = await client.query(
        `INSERT INTO users (email, password_hash, display_name, role_id, deleted_at)
         VALUES ($1, $2, $3, (SELECT id FROM roles WHERE name = 'user'), NULL)
         ON CONFLICT (email) DO UPDATE
           SET password_hash = EXCLUDED.password_hash,
               display_name = EXCLUDED.display_name,
               deleted_at = NULL
         RETURNING id`,
        [user.email, passwordHash, user.displayName],
      );
      userIds.push(result.rows[0].id);
    }

    const roomResult = await client.query(
      `INSERT INTO rooms (name, type, created_by, slug)
       VALUES ('Conclave Test Room', 'group', $1, $2)
       ON CONFLICT (slug) DO UPDATE
         SET name = EXCLUDED.name,
             type = EXCLUDED.type,
             created_by = EXCLUDED.created_by
       RETURNING id`,
      [userIds[0], ROOM_SLUG],
    );
    const roomId = roomResult.rows[0].id;

    for (const [index, user] of USERS.entries()) {
      await client.query(
        `INSERT INTO room_members (room_id, user_id, role)
         VALUES ($1, $2, $3)
         ON CONFLICT (room_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
        [roomId, userIds[index], user.roomRole],
      );
    }

    for (const [index, message] of MESSAGES.entries()) {
      await client.query(
        `INSERT INTO messages (id, room_id, sender_id, content, created_at)
         VALUES ($1, $2, $3, $4, NOW() - ($5::int * INTERVAL '3 minutes'))
         ON CONFLICT (id) DO NOTHING`,
        [
          message.id,
          roomId,
          userIds[message.sender],
          message.content,
          MESSAGES.length - index,
        ],
      );
    }

    await client.query("COMMIT");
    console.log(
      `Seeded Conclave Test Room with 2 admins, 3 members and ${MESSAGES.length} sample messages.`,
    );
    console.log(`Login password for all five accounts: ${PASSWORD}`);
    for (const user of USERS) console.log(`  ${user.email} (${user.roomRole})`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((error) => {
  console.error(`Seed failed: ${error.message}`);
  process.exitCode = 1;
  pool.end();
});
