import { randomUUID } from 'node:crypto';
import { pool } from './pool.js';
import { type UserRecord } from './users.js';

export type MessageRecord = {
  id: string;
  sender_id: string;
  recipient_id: string;
  body: string;
  image_data: string | null;
  image_name: string | null;
  image_spoiler: boolean;
  edited_at: Date | null;
  deleted_at: Date | null;
  read_at: Date | null;
  pinned_at: Date | null;
  created_at: Date;
};

export type PublicMessage = {
  id: string;
  senderId: string;
  recipientId: string;
  body: string;
  imageData: string | null;
  imageName: string | null;
  imageSpoiler: boolean;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  pinnedAt: string | null;
};

export type ConversationPreview = {
  user: UserRecord;
  message: MessageRecord;
  unreadCount: number;
};

export type FriendshipRequestStatus = 'pending' | 'accepted' | 'friends';

export function toPublicMessage(message: MessageRecord): PublicMessage {
  return {
    id: message.id,
    senderId: message.sender_id,
    recipientId: message.recipient_id,
    body: message.deleted_at ? '' : message.body,
    imageData: message.deleted_at ? null : message.image_data,
    imageName: message.deleted_at ? null : message.image_name,
    imageSpoiler: message.deleted_at ? false : message.image_spoiler,
    editedAt: message.edited_at?.toISOString() ?? null,
    deletedAt: message.deleted_at?.toISOString() ?? null,
    createdAt: message.created_at.toISOString(),
    pinnedAt: message.pinned_at?.toISOString() ?? null
  };
}

export async function getFriendshipDate(userId: string, friendId: string) {
  const result = await pool.query<{ created_at: Date }>(
    `
      SELECT created_at
      FROM friends
      WHERE user_id = $1 AND friend_id = $2
      LIMIT 1
    `,
    [userId, friendId]
  );
  return result.rows[0]?.created_at ?? null;
}

export async function listMutualFriends(userId: string, otherUserId: string) {
  const result = await pool.query<UserRecord>(
    `
      SELECT users.*
      FROM friends f1
      JOIN friends f2 ON f1.friend_id = f2.friend_id
      JOIN users ON users.id = f1.friend_id
      WHERE f1.user_id = $1 AND f2.user_id = $2
      ORDER BY users.nickname_normalized ASC
    `,
    [userId, otherUserId]
  );
  return result.rows;
}

export async function listFriends(userId: string) {
  const result = await pool.query<UserRecord>(
    `
      SELECT users.*
      FROM friends
      JOIN users ON users.id = friends.friend_id
      WHERE friends.user_id = $1
      ORDER BY users.nickname_normalized ASC
    `,
    [userId]
  );

  return result.rows;
}

export async function listFriendRequests(userId: string) {
  const incoming = await pool.query<UserRecord>(
    `
      SELECT users.*
      FROM friend_requests
      JOIN users ON users.id = friend_requests.requester_id
      WHERE friend_requests.recipient_id = $1
      ORDER BY friend_requests.created_at DESC
    `,
    [userId]
  );
  const outgoing = await pool.query<UserRecord>(
    `
      SELECT users.*
      FROM friend_requests
      JOIN users ON users.id = friend_requests.recipient_id
      WHERE friend_requests.requester_id = $1
      ORDER BY friend_requests.created_at DESC
    `,
    [userId]
  );

  return { incoming: incoming.rows, outgoing: outgoing.rows };
}

export async function areFriends(userId: string, friendId: string) {
  const result = await pool.query('SELECT 1 FROM friends WHERE user_id = $1 AND friend_id = $2 LIMIT 1', [userId, friendId]);
  return (result.rowCount ?? 0) > 0;
}

export async function addFriend(userId: string, friendId: string) {
  await pool.query(
    `
      INSERT INTO friends (user_id, friend_id)
      VALUES ($1, $2), ($2, $1)
      ON CONFLICT DO NOTHING
    `,
    [userId, friendId]
  );
  await pool.query(
    `
      DELETE FROM friend_requests
      WHERE (requester_id = $1 AND recipient_id = $2)
         OR (requester_id = $2 AND recipient_id = $1)
    `,
    [userId, friendId]
  );
}

export async function requestFriendship(userId: string, friendId: string): Promise<FriendshipRequestStatus> {
  if (await areFriends(userId, friendId)) return 'friends';

  const reciprocal = await pool.query(
    `
      DELETE FROM friend_requests
      WHERE requester_id = $2 AND recipient_id = $1
      RETURNING requester_id
    `,
    [userId, friendId]
  );

  if ((reciprocal.rowCount ?? 0) > 0) {
    await addFriend(userId, friendId);
    return 'accepted';
  }

  await pool.query(
    `
      INSERT INTO friend_requests (requester_id, recipient_id)
      VALUES ($1, $2)
      ON CONFLICT DO NOTHING
    `,
    [userId, friendId]
  );

  return 'pending';
}

export async function acceptFriendRequest(userId: string, requesterId: string) {
  const result = await pool.query(
    `
      DELETE FROM friend_requests
      WHERE requester_id = $2 AND recipient_id = $1
      RETURNING requester_id
    `,
    [userId, requesterId]
  );

  if ((result.rowCount ?? 0) === 0) return false;
  await addFriend(userId, requesterId);
  return true;
}

export async function removeFriend(userId: string, friendId: string) {
  const result = await pool.query(
    `
      DELETE FROM friends
      WHERE (user_id = $1 AND friend_id = $2)
         OR (user_id = $2 AND friend_id = $1)
    `,
    [userId, friendId]
  );
  await pool.query(
    `
      DELETE FROM friend_requests
      WHERE (requester_id = $1 AND recipient_id = $2)
         OR (requester_id = $2 AND recipient_id = $1)
    `,
    [userId, friendId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function deleteFriendRequest(userId: string, otherUserId: string) {
  const result = await pool.query<{ requester_id: string; recipient_id: string }>(
    `
      DELETE FROM friend_requests
      WHERE (requester_id = $1 AND recipient_id = $2)
         OR (requester_id = $2 AND recipient_id = $1)
      RETURNING requester_id, recipient_id
    `,
    [userId, otherUserId]
  );

  return result.rows[0] ?? null;
}

export async function listConversationPreviews(userId: string): Promise<ConversationPreview[]> {
  const messages = await pool.query<MessageRecord & { other_id: string; unread_count: number }>(
    `
      WITH latest AS (
        SELECT DISTINCT ON (other_id)
          CASE WHEN sender_id = $1 THEN recipient_id ELSE sender_id END AS other_id,
          messages.*
        FROM messages
        WHERE sender_id = $1 OR recipient_id = $1
        ORDER BY other_id, created_at DESC
      ), unread AS (
        SELECT sender_id AS other_id, COUNT(*)::int AS unread_count
        FROM messages
        WHERE recipient_id = $1
          AND read_at IS NULL
          AND deleted_at IS NULL
        GROUP BY sender_id
      )
      SELECT latest.*, COALESCE(unread.unread_count, 0) AS unread_count
      FROM latest
      LEFT JOIN unread ON unread.other_id = latest.other_id
      ORDER BY latest.created_at DESC
      LIMIT 50
    `,
    [userId]
  );

  const userIds = messages.rows.map((message) => message.other_id);
  if (!userIds.length) return [];

  const users = await pool.query<UserRecord>('SELECT * FROM users WHERE id = ANY($1::uuid[])', [userIds]);
  const userById = new Map(users.rows.map((user) => [user.id, user]));

  const previews: ConversationPreview[] = [];

  for (const message of messages.rows) {
    const user = userById.get(message.other_id);
    if (user) previews.push({ user, message, unreadCount: message.unread_count });
  }

  return previews.sort((left, right) => right.message.created_at.getTime() - left.message.created_at.getTime());
}

export async function listConversation(userId: string, friendId: string) {
  const result = await pool.query<MessageRecord>(
    `
      SELECT *
      FROM messages
      WHERE (sender_id = $1 AND recipient_id = $2)
         OR (sender_id = $2 AND recipient_id = $1)
      ORDER BY created_at ASC
      LIMIT 150
    `,
    [userId, friendId]
  );

  return result.rows;
}

export async function markConversationRead(userId: string, friendId: string) {
  await pool.query(
    `
      UPDATE messages
      SET read_at = COALESCE(read_at, NOW())
      WHERE sender_id = $2
        AND recipient_id = $1
        AND read_at IS NULL
        AND deleted_at IS NULL
    `,
    [userId, friendId]
  );
}

export async function createMessage(senderId: string, recipientId: string, body: string, image?: { dataUrl: string; name?: string; spoiler?: boolean }) {
  const result = await pool.query<MessageRecord>(
    `
      INSERT INTO messages (id, sender_id, recipient_id, body, image_data, image_name, image_spoiler)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `,
    [randomUUID(), senderId, recipientId, body, image?.dataUrl ?? null, image?.name ?? null, image?.spoiler ?? false]
  );

  return result.rows[0];
}

export async function updateMessage(messageId: string, senderId: string, body: string) {
  const result = await pool.query<MessageRecord>(
    `
      WITH target AS (
        SELECT *
        FROM messages
        WHERE id = $1
          AND sender_id = $2
          AND deleted_at IS NULL
      ), editable AS (
        SELECT target.id
        FROM target
        WHERE target.created_at > NOW() - INTERVAL '10 minutes'
          AND (
            SELECT COUNT(*)
            FROM messages AS newer
            WHERE newer.deleted_at IS NULL
              AND newer.created_at > target.created_at
              AND (
                (newer.sender_id = target.sender_id AND newer.recipient_id = target.recipient_id)
                OR (newer.sender_id = target.recipient_id AND newer.recipient_id = target.sender_id)
              )
          ) < 5
      )
      UPDATE messages
      SET body = $3, edited_at = NOW()
      FROM editable
      WHERE messages.id = editable.id
      RETURNING messages.*
    `,
    [messageId, senderId, body]
  );

  return result.rows[0] ?? null;
}

export async function deleteMessage(messageId: string, senderId: string) {
  const result = await pool.query<MessageRecord>(
    `
      UPDATE messages
      SET body = '', image_data = NULL, image_name = NULL, image_spoiler = FALSE, deleted_at = NOW()
      WHERE id = $1
        AND sender_id = $2
        AND deleted_at IS NULL
      RETURNING *
    `,
    [messageId, senderId]
  );

  return result.rows[0] ?? null;
}

export async function pinMessage(messageId: string, userId: string) {
  const result = await pool.query<MessageRecord>(
    `
      UPDATE messages
      SET pinned_at = NOW()
      WHERE id = $1
        AND deleted_at IS NULL
        AND (sender_id = $2 OR recipient_id = $2)
        AND pinned_at IS NULL
      RETURNING *
    `,
    [messageId, userId]
  );
  return result.rows[0] ?? null;
}

export async function unpinMessage(messageId: string, userId: string) {
  const result = await pool.query<MessageRecord>(
    `
      UPDATE messages
      SET pinned_at = NULL
      WHERE id = $1
        AND (sender_id = $2 OR recipient_id = $2)
        AND pinned_at IS NOT NULL
      RETURNING *
    `,
    [messageId, userId]
  );
  return result.rows[0] ?? null;
}
