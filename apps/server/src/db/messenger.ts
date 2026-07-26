import { randomUUID } from 'node:crypto';
import { pool } from './pool.js';
import { liteUserColumns, type UserRecord } from './users.js';

export type MessageRecord = {
  id: string;
  sender_id: string;
  recipient_id: string;
  sender_group_id: string | null;
  sender_group_name: string | null;
  sender_group_avatar_data: string | null;
  body: string;
  image_data: string | null;
  image_name: string | null;
  image_spoiler: boolean;
  media_items: ChatMediaItem[] | null;
  edited_at: Date | null;
  deleted_at: Date | null;
  read_at: Date | null;
  pinned_at: Date | null;
  reply_to: string | null;
  created_at: Date;
};

export type MessageReaction = {
  emoji: string;
  count: number;
  userIds: string[];
};

// A compact snapshot of the replied-to message, embedded in a reply so the UI
// can render the small quote bar without a second fetch.
export type MessageReplySnippet = {
  id: string;
  senderId: string;
  senderGroup: { id: string; name: string; avatarData: string } | null;
  body: string;
  imageData: string | null;
  imageName: string | null;
  mediaItems: ChatMediaItem[];
  deletedAt: string | null;
};

export type ChatMediaItem = {
  dataUrl: string;
  name: string | null;
  spoiler: boolean;
};

export type PublicMessage = {
  id: string;
  senderId: string;
  recipientId: string;
  senderGroup: { id: string; name: string; avatarData: string } | null;
  body: string;
  imageData: string | null;
  imageName: string | null;
  imageSpoiler: boolean;
  mediaItems: ChatMediaItem[];
  editedAt: string | null;
  deletedAt: string | null;
  readAt: string | null;
  createdAt: string;
  pinnedAt: string | null;
  reactions: MessageReaction[];
  replyTo: MessageReplySnippet | null;
};

export type ConversationPreview = {
  user: UserRecord;
  message: MessageRecord;
  unreadCount: number;
};

export type ConversationSettingsRecord = {
  user_a: string;
  user_b: string;
  background_data: string;
  updated_by: string | null;
  updated_at: Date;
};

export type PublicConversationSettings = {
  backgroundData: string;
  updatedBy: string | null;
  updatedAt: string | null;
};

const visibleToUserClause = `
  NOT EXISTS (
    SELECT 1
    FROM message_hidden_for mhf
    WHERE mhf.message_id = messages.id
      AND mhf.user_id = $1
  )
`;

export type FriendshipRequestStatus = 'pending' | 'accepted' | 'friends';
export type FriendRequestUserRecord = UserRecord & { request_created_at: Date };

function normalizeMediaItems(message: Pick<MessageRecord, 'deleted_at' | 'media_items' | 'image_data' | 'image_name' | 'image_spoiler'>): ChatMediaItem[] {
  if (message.deleted_at) return [];
  if (Array.isArray(message.media_items) && message.media_items.length > 0) {
    return message.media_items
      .filter((item) => typeof item?.dataUrl === 'string' && item.dataUrl.length > 0)
      .map((item) => ({ dataUrl: item.dataUrl, name: item.name ?? null, spoiler: Boolean(item.spoiler) }));
  }
  return message.image_data
    ? [{ dataUrl: message.image_data, name: message.image_name ?? null, spoiler: Boolean(message.image_spoiler) }]
    : [];
}

export function toPublicMessage(message: MessageRecord, reactions: MessageReaction[] = [], replyTo: MessageReplySnippet | null = null): PublicMessage {
  const mediaItems = normalizeMediaItems(message);
  return {
    id: message.id,
    senderId: message.sender_id,
    recipientId: message.recipient_id,
    senderGroup: message.deleted_at || !message.sender_group_id
      ? null
      : {
        id: message.sender_group_id,
        name: message.sender_group_name ?? '',
        avatarData: message.sender_group_avatar_data ?? ''
      },
    body: message.deleted_at ? '' : message.body,
    imageData: mediaItems[0]?.dataUrl ?? null,
    imageName: mediaItems[0]?.name ?? null,
    imageSpoiler: mediaItems[0]?.spoiler ?? false,
    mediaItems,
    editedAt: message.edited_at?.toISOString() ?? null,
    deletedAt: message.deleted_at?.toISOString() ?? null,
    readAt: message.read_at?.toISOString() ?? null,
    createdAt: message.created_at.toISOString(),
    pinnedAt: message.pinned_at?.toISOString() ?? null,
    reactions: message.deleted_at ? [] : reactions,
    replyTo
  };
}

type DmReactionRow = { message_id: string; user_id: string; emoji: string };

// Load reactions for a set of message ids, grouped per message and per emoji.
export async function loadDmReactions(messageIds: string[]): Promise<Map<string, MessageReaction[]>> {
  const map = new Map<string, MessageReaction[]>();
  if (messageIds.length === 0) return map;
  const result = await pool.query<DmReactionRow>(
    `
      SELECT message_id, user_id, emoji
      FROM message_reactions
      WHERE message_id = ANY($1::uuid[])
      ORDER BY created_at ASC
    `,
    [messageIds]
  );
  for (const row of result.rows) {
    let list = map.get(row.message_id);
    if (!list) { list = []; map.set(row.message_id, list); }
    let entry = list.find((r) => r.emoji === row.emoji);
    if (!entry) { entry = { emoji: row.emoji, count: 0, userIds: [] }; list.push(entry); }
    entry.count += 1;
    entry.userIds.push(row.user_id);
  }
  return map;
}

// Load reply snippets for a set of reply_to ids in a single query.
export async function loadReplySnippets(replyIds: string[]): Promise<Map<string, MessageReplySnippet>> {
  const map = new Map<string, MessageReplySnippet>();
  const ids = [...new Set(replyIds.filter(Boolean))];
  if (ids.length === 0) return map;
  const result = await pool.query<MessageRecord>('SELECT * FROM messages WHERE id = ANY($1::uuid[])', [ids]);
  for (const row of result.rows) {
    map.set(row.id, {
      id: row.id,
      senderId: row.sender_id,
      senderGroup: row.deleted_at || !row.sender_group_id
        ? null
        : {
            id: row.sender_group_id,
            name: row.sender_group_name ?? '',
            avatarData: row.sender_group_avatar_data ?? ''
          },
      body: row.deleted_at ? '' : row.body,
      imageData: normalizeMediaItems(row)[0]?.dataUrl ?? null,
      imageName: normalizeMediaItems(row)[0]?.name ?? null,
      mediaItems: normalizeMediaItems(row),
      deletedAt: row.deleted_at?.toISOString() ?? null
    });
  }
  return map;
}

// Convert a list of message records to public messages with reactions and
// reply snippets attached in batched queries.
export async function toPublicMessagesEnriched(messages: MessageRecord[]): Promise<PublicMessage[]> {
  const reactions = await loadDmReactions(messages.filter((m) => !m.deleted_at).map((m) => m.id));
  const replies = await loadReplySnippets(messages.map((m) => m.reply_to).filter((id): id is string => Boolean(id)));
  return messages.map((m) => toPublicMessage(m, reactions.get(m.id) ?? [], m.reply_to ? replies.get(m.reply_to) ?? null : null));
}

// Enrich a single message record.
export async function toPublicMessageEnriched(message: MessageRecord): Promise<PublicMessage> {
  const [enriched] = await toPublicMessagesEnriched([message]);
  return enriched;
}

// Toggle a DM reaction; returns the updated reaction list for the message.
export async function toggleMessageReaction(messageId: string, userId: string, emoji: string): Promise<MessageReaction[]> {
  const existing = await pool.query(
    'SELECT 1 FROM message_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3',
    [messageId, userId, emoji]
  );
  if ((existing.rowCount ?? 0) > 0) {
    await pool.query('DELETE FROM message_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3', [messageId, userId, emoji]);
  } else {
    await pool.query('INSERT INTO message_reactions (message_id, user_id, emoji) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [messageId, userId, emoji]);
  }
  const map = await loadDmReactions([messageId]);
  return map.get(messageId) ?? [];
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
      SELECT ${liteUserColumns('users')}
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
      SELECT ${liteUserColumns('users')}
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
  const [incoming, outgoing] = await Promise.all([
    pool.query<FriendRequestUserRecord>(
      `
        SELECT ${liteUserColumns('users')}, friend_requests.created_at AS request_created_at
        FROM friend_requests
        JOIN users ON users.id = friend_requests.requester_id
        WHERE friend_requests.recipient_id = $1
        ORDER BY friend_requests.created_at DESC
      `,
      [userId]
    ),
    pool.query<FriendRequestUserRecord>(
      `
        SELECT ${liteUserColumns('users')}, friend_requests.created_at AS request_created_at
        FROM friend_requests
        JOIN users ON users.id = friend_requests.recipient_id
        WHERE friend_requests.requester_id = $1
        ORDER BY friend_requests.created_at DESC
      `,
      [userId]
    )
  ]);

  return { incoming: incoming.rows, outgoing: outgoing.rows };
}

export async function areFriends(userId: string, friendId: string) {
  const result = await pool.query('SELECT 1 FROM friends WHERE user_id = $1 AND friend_id = $2 LIMIT 1', [userId, friendId]);
  return (result.rowCount ?? 0) > 0;
}

// ── User blocking ──────────────────────────────────────────────────────────
export async function blockUser(blockerId: string, blockedId: string) {
  await pool.query(
    'INSERT INTO blocked_users (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [blockerId, blockedId]
  );
}

export async function unblockUser(blockerId: string, blockedId: string) {
  await pool.query('DELETE FROM blocked_users WHERE blocker_id = $1 AND blocked_id = $2', [blockerId, blockedId]);
}

// True when `blockerId` has blocked `blockedId`.
export async function isBlocked(blockerId: string, blockedId: string) {
  const result = await pool.query(
    'SELECT 1 FROM blocked_users WHERE blocker_id = $1 AND blocked_id = $2 LIMIT 1',
    [blockerId, blockedId]
  );
  return (result.rowCount ?? 0) > 0;
}

// True when a block exists in EITHER direction between the two users — used to
// forbid messaging/calling and to hide the conversation.
export async function blockExistsBetween(a: string, b: string) {
  const result = await pool.query(
    'SELECT 1 FROM blocked_users WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1) LIMIT 1',
    [a, b]
  );
  return (result.rowCount ?? 0) > 0;
}

// All user ids the given user has blocked.
export async function listBlockedIds(blockerId: string): Promise<string[]> {
  const result = await pool.query<{ blocked_id: string }>(
    'SELECT blocked_id FROM blocked_users WHERE blocker_id = $1',
    [blockerId]
  );
  return result.rows.map((row) => row.blocked_id);
}

// The two block flags for a given pair, from `userId`'s perspective.
export async function blockState(userId: string, otherId: string): Promise<{ blocked: boolean; blockedMe: boolean }> {
  const result = await pool.query<{ blocker_id: string; blocked_id: string }>(
    'SELECT blocker_id, blocked_id FROM blocked_users WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)',
    [userId, otherId]
  );
  let blocked = false;
  let blockedMe = false;
  for (const row of result.rows) {
    if (row.blocker_id === userId) blocked = true;
    else blockedMe = true;
  }
  return { blocked, blockedMe };
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
        WHERE (sender_id = $1 OR recipient_id = $1)
          AND deleted_at IS NULL
          AND ${visibleToUserClause}
        ORDER BY other_id, created_at DESC
      ), unread AS (
        SELECT sender_id AS other_id, COUNT(*)::int AS unread_count
        FROM messages
        WHERE recipient_id = $1
          AND read_at IS NULL
          AND deleted_at IS NULL
          AND ${visibleToUserClause}
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

  const users = await pool.query<UserRecord>(`SELECT ${liteUserColumns()} FROM users WHERE id = ANY($1::uuid[])`, [userIds]);
  const userById = new Map(users.rows.map((user) => [user.id, user]));

  const previews: ConversationPreview[] = [];

  for (const message of messages.rows) {
    const user = userById.get(message.other_id);
    if (user) previews.push({ user, message, unreadCount: message.unread_count });
  }

  return previews.sort((left, right) => right.message.created_at.getTime() - left.message.created_at.getTime());
}

// Page size for a single conversation fetch. The client loads the latest page
// first and pages backwards (older messages) as the user scrolls up.
export const CONVERSATION_PAGE_SIZE = 40;

// Load one page of a conversation, newest-first internally then returned in
// chronological (ascending) order so the UI can render top-to-bottom. When
// `before` is provided, only messages older than that message are returned,
// which powers infinite scroll-up. `hasMore` tells the client whether an older
// page still exists.
export async function listConversation(
  userId: string,
  friendId: string,
  options: { limit?: number; before?: string } = {}
): Promise<{ messages: MessageRecord[]; hasMore: boolean }> {
  const limit = options.limit ?? CONVERSATION_PAGE_SIZE;

  // Resolve the cursor message's timestamp+id for stable keyset pagination.
  let beforeCreatedAt: Date | null = null;
  if (options.before) {
    const cursor = await pool.query<{ created_at: Date }>(
      'SELECT created_at FROM messages WHERE id = $1',
      [options.before]
    );
    beforeCreatedAt = cursor.rows[0]?.created_at ?? null;
  }

  const params: unknown[] = [userId, friendId];
  let cursorClause = '';
  if (beforeCreatedAt) {
    params.push(beforeCreatedAt, options.before);
    cursorClause = `AND (created_at, id) < ($3, $4)`;
  }
  // Fetch one extra row to detect whether an older page exists.
  params.push(limit + 1);
  const limitParam = `$${params.length}`;

  const result = await pool.query<MessageRecord>(
    `
      SELECT *
      FROM messages
      WHERE LEAST(sender_id, recipient_id) = LEAST($1::uuid, $2::uuid)
        AND GREATEST(sender_id, recipient_id) = GREATEST($1::uuid, $2::uuid)
        AND ${visibleToUserClause}
        AND deleted_at IS NULL
        ${cursorClause}
      ORDER BY created_at DESC, id DESC
      LIMIT ${limitParam}
    `,
    params
  );

  const hasMore = result.rows.length > limit;
  const page = hasMore ? result.rows.slice(0, limit) : result.rows;
  // Reverse to chronological order for rendering.
  return { messages: page.reverse(), hasMore };
}

// Search a conversation's non-deleted text messages for `query`
// (case-insensitive substring), newest first. Returns a bounded list.
export async function searchConversation(
  userId: string,
  friendId: string,
  query: string,
  limit = 50
): Promise<MessageRecord[]> {
  const result = await pool.query<MessageRecord>(
    `
      SELECT *
      FROM messages
      WHERE LEAST(sender_id, recipient_id) = LEAST($1::uuid, $2::uuid)
        AND GREATEST(sender_id, recipient_id) = GREATEST($1::uuid, $2::uuid)
        AND ${visibleToUserClause}
        AND deleted_at IS NULL
        AND body ILIKE '%' || $3 || '%'
      ORDER BY created_at DESC, id DESC
      LIMIT $4
    `,
    [userId, friendId, query, limit]
  );
  return result.rows;
}

// Load a window of messages centred on `targetId`: `radius` newer and `radius`
// older, plus the target itself, in chronological order. Powers "jump to
// message" for messages outside the currently loaded page. `hasMoreBefore`/
// `hasMoreAfter` tell the client whether further paging is possible.
export async function listConversationAround(
  userId: string,
  friendId: string,
  targetId: string,
  radius = 25
): Promise<{ messages: MessageRecord[]; hasMoreBefore: boolean; hasMoreAfter: boolean } | null> {
  const cursor = await pool.query<{ created_at: Date }>(
    `
      SELECT created_at
      FROM messages
      WHERE id = $1
        AND deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM message_hidden_for mhf
          WHERE mhf.message_id = messages.id
            AND mhf.user_id = $2
        )
    `,
    [targetId, userId]
  );
  const at = cursor.rows[0]?.created_at;
  if (!at) return null;

  const pair = `LEAST(sender_id, recipient_id) = LEAST($1::uuid, $2::uuid)
    AND GREATEST(sender_id, recipient_id) = GREATEST($1::uuid, $2::uuid)
    AND ${visibleToUserClause}
    AND deleted_at IS NULL`;

  // Older page (strictly before the target), newest-first then reversed.
  const older = await pool.query<MessageRecord>(
    `SELECT * FROM messages WHERE ${pair} AND (created_at, id) < ($3, $4)
     ORDER BY created_at DESC, id DESC LIMIT $5`,
    [userId, friendId, at, targetId, radius + 1]
  );
  // Target + newer page.
  const newer = await pool.query<MessageRecord>(
    `SELECT * FROM messages WHERE ${pair} AND (created_at, id) >= ($3, $4)
     ORDER BY created_at ASC, id ASC LIMIT $5`,
    [userId, friendId, at, targetId, radius + 1]
  );

  const hasMoreBefore = older.rows.length > radius;
  const hasMoreAfter = newer.rows.length > radius;
  const olderPage = (hasMoreBefore ? older.rows.slice(0, radius) : older.rows).reverse();
  const newerPage = hasMoreAfter ? newer.rows.slice(0, radius) : newer.rows;
  return { messages: [...olderPage, ...newerPage], hasMoreBefore, hasMoreAfter };
}

// All image-bearing messages in a conversation, newest first. Used by the
// shared-media panel. Bounded to a sane cap.
export async function listConversationImages(
  userId: string,
  friendId: string,
  limit = 500
): Promise<MessageRecord[]> {
  const result = await pool.query<MessageRecord>(
    `
      SELECT *
      FROM messages
      WHERE LEAST(sender_id, recipient_id) = LEAST($1::uuid, $2::uuid)
        AND GREATEST(sender_id, recipient_id) = GREATEST($1::uuid, $2::uuid)
        AND ${visibleToUserClause}
        AND deleted_at IS NULL
        AND image_data IS NOT NULL
      ORDER BY created_at DESC, id DESC
      LIMIT $3
    `,
    [userId, friendId, limit]
  );
  return result.rows;
}

export async function listConversationPinned(
  userId: string,
  friendId: string,
  limit = 100
): Promise<MessageRecord[]> {
  const result = await pool.query<MessageRecord>(
    `
      SELECT *
      FROM messages
      WHERE LEAST(sender_id, recipient_id) = LEAST($1::uuid, $2::uuid)
        AND GREATEST(sender_id, recipient_id) = GREATEST($1::uuid, $2::uuid)
        AND ${visibleToUserClause}
        AND deleted_at IS NULL
        AND pinned_at IS NOT NULL
      ORDER BY pinned_at DESC, created_at DESC
      LIMIT $3
    `,
    [userId, friendId, Math.max(1, Math.min(limit, 100))]
  );
  return result.rows;
}

// All messages in a conversation whose body contains a URL, newest first.
export async function listConversationLinks(
  userId: string,
  friendId: string,
  limit = 200
): Promise<MessageRecord[]> {
  const result = await pool.query<MessageRecord>(
    `
      SELECT *
      FROM messages
      WHERE LEAST(sender_id, recipient_id) = LEAST($1::uuid, $2::uuid)
        AND GREATEST(sender_id, recipient_id) = GREATEST($1::uuid, $2::uuid)
        AND ${visibleToUserClause}
        AND deleted_at IS NULL
        AND body ~* 'https?://'
      ORDER BY created_at DESC, id DESC
      LIMIT $3
    `,
    [userId, friendId, limit]
  );
  return result.rows;
}

export async function markConversationRead(userId: string, friendId: string) {
  const result = await pool.query<{ id: string; read_at: Date }>(
    `
      UPDATE messages
      SET read_at = COALESCE(read_at, NOW())
      WHERE sender_id = $2
        AND recipient_id = $1
        AND read_at IS NULL
        AND deleted_at IS NULL
      RETURNING id, read_at
    `,
    [userId, friendId]
  );
  return {
    messageIds: result.rows.map((row) => row.id),
    readAt: result.rows[0]?.read_at.toISOString() ?? null
  };
}

export function toPublicConversationSettings(settings: ConversationSettingsRecord | null): PublicConversationSettings {
  return {
    backgroundData: settings?.background_data ?? '',
    updatedBy: settings?.updated_by ?? null,
    updatedAt: settings?.updated_at?.toISOString() ?? null
  };
}

export async function getConversationSettings(userId: string, friendId: string) {
  const result = await pool.query<ConversationSettingsRecord>(
    `
      SELECT *
      FROM conversation_settings
      WHERE user_a = LEAST($1::uuid, $2::uuid)
        AND user_b = GREATEST($1::uuid, $2::uuid)
      LIMIT 1
    `,
    [userId, friendId]
  );
  return result.rows[0] ?? null;
}

export async function setConversationBackground(userId: string, friendId: string, backgroundData: string) {
  const result = await pool.query<ConversationSettingsRecord>(
    `
      INSERT INTO conversation_settings (user_a, user_b, background_data, updated_by)
      VALUES (LEAST($1::uuid, $2::uuid), GREATEST($1::uuid, $2::uuid), $3, $1)
      ON CONFLICT (user_a, user_b)
      DO UPDATE SET
        background_data = EXCLUDED.background_data,
        updated_by = EXCLUDED.updated_by,
        updated_at = NOW()
      RETURNING *
    `,
    [userId, friendId, backgroundData]
  );
  return result.rows[0];
}

export async function createMessage(
  senderId: string,
  recipientId: string,
  body: string,
  image?: { dataUrl: string; name?: string; spoiler?: boolean },
  replyTo?: string | null,
  senderGroup?: { id: string; name: string; avatarData: string } | null,
  mediaItems?: Array<{ dataUrl: string; name?: string | null; spoiler?: boolean }>
) {
  const items = (mediaItems && mediaItems.length > 0 ? mediaItems : image ? [image] : [])
    .map((item) => ({ dataUrl: item.dataUrl, name: item.name ?? null, spoiler: Boolean(item.spoiler) }));
  const first = items[0];
  const result = await pool.query<MessageRecord>(
    `
      INSERT INTO messages (id, sender_id, recipient_id, sender_group_id, sender_group_name, sender_group_avatar_data, body, image_data, image_name, image_spoiler, media_items, reply_to)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12)
      RETURNING *
    `,
    [
      randomUUID(),
      senderId,
      recipientId,
      senderGroup?.id ?? null,
      senderGroup?.name ?? null,
      senderGroup?.avatarData ?? null,
      body,
      first?.dataUrl ?? null,
      first?.name ?? null,
      first?.spoiler ?? false,
      items.length > 0 ? JSON.stringify(items) : null,
      replyTo ?? null
    ]
  );

  return result.rows[0];
}

export async function updateMessage(
  messageId: string,
  senderId: string,
  body: string,
  mediaItems?: Array<{ dataUrl: string; name?: string | null; spoiler?: boolean }>
) {
  const items = mediaItems?.map((item) => ({ dataUrl: item.dataUrl, name: item.name ?? null, spoiler: Boolean(item.spoiler) }));
  const first = items?.[0];
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
      SET body = $3,
          image_data = CASE WHEN $4::jsonb IS NULL THEN messages.image_data ELSE $5 END,
          image_name = CASE WHEN $4::jsonb IS NULL THEN messages.image_name ELSE $6 END,
          image_spoiler = CASE WHEN $4::jsonb IS NULL THEN messages.image_spoiler ELSE $7 END,
          media_items = CASE WHEN $4::jsonb IS NULL THEN messages.media_items ELSE $4::jsonb END,
          edited_at = NOW()
      FROM editable
      WHERE messages.id = editable.id
      RETURNING messages.*
    `,
    [messageId, senderId, body, items ? JSON.stringify(items) : null, first?.dataUrl ?? null, first?.name ?? null, first?.spoiler ?? false]
  );

  return result.rows[0] ?? null;
}

export async function deleteMessage(messageId: string, senderId: string) {
  const result = await pool.query<MessageRecord>(
    `
      UPDATE messages
      SET body = '', image_data = NULL, image_name = NULL, image_spoiler = FALSE, media_items = NULL, deleted_at = NOW()
      WHERE id = $1
        AND sender_id = $2
        AND deleted_at IS NULL
      RETURNING *
    `,
    [messageId, senderId]
  );

  return result.rows[0] ?? null;
}

export async function clearConversation(userId: string, friendId: string, forEveryone: boolean) {
  if (forEveryone) {
    await pool.query(
      `
        UPDATE messages
        SET body = '', image_data = NULL, image_name = NULL, image_spoiler = FALSE, media_items = NULL, deleted_at = COALESCE(deleted_at, NOW())
        WHERE LEAST(sender_id, recipient_id) = LEAST($1::uuid, $2::uuid)
          AND GREATEST(sender_id, recipient_id) = GREATEST($1::uuid, $2::uuid)
      `,
      [userId, friendId]
    );
  }

  const viewers = forEveryone ? [userId, friendId] : [userId];
  await pool.query(
    `
      INSERT INTO message_hidden_for (message_id, user_id)
      SELECT messages.id, viewer_id
      FROM messages
      CROSS JOIN unnest($3::uuid[]) AS viewer_id
      WHERE LEAST(sender_id, recipient_id) = LEAST($1::uuid, $2::uuid)
        AND GREATEST(sender_id, recipient_id) = GREATEST($1::uuid, $2::uuid)
      ON CONFLICT DO NOTHING
    `,
    [userId, friendId, viewers]
  );
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
