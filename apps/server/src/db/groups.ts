import { randomUUID } from 'node:crypto';
import { pool } from './pool.js';
import { liteUserColumns, type NamePlate, type UserRecord } from './users.js';

export type GroupRecord = {
  id: string;
  name: string;
  avatar_data: string;
  owner_id: string;
  invite_code: string;
  nameplate: NamePlate | null;
  description: string;
  default_role_id: string | null;
  everyone_permissions: string[];
  automod_words: string[];
  created_at: Date;
};

export type GroupMemberRecord = {
  group_id: string;
  user_id: string;
  role: string;
  role_id: string | null;
  nickname: string;
  timeout_until: Date | null;
  joined_at: Date;
};

export type GroupInviteRecord = {
  id: string;
  group_id: string;
  channel_id: string | null;
  code: string;
  creator_id: string;
  uses_count: number;
  max_uses: number | null;
  expires_at: Date | null;
  created_at: Date;
};

export type GroupBanRecord = {
  group_id: string;
  user_id: string;
  banned_by: string | null;
  reason: string;
  created_at: Date;
};

export type GroupChannelPermissionOverrideRecord = {
  channel_id: string;
  role_id: string | null;
  target_id: string;
  permission: string;
  value: 'allow' | 'deny';
};

export type GroupRoleRecord = {
  id: string;
  group_id: string;
  name: string;
  color: string;
  position: number;
  is_owner: boolean;
  permissions: string[];
  hoist: boolean;
  created_at: Date;
};

export type GroupChannelRecord = {
  id: string;
  group_id: string;
  name: string;
  position: number;
  folder_id: string | null;
  type: string;
  user_limit: number | null;
  topic: string;
  slowmode_seconds: number;
  nsfw: boolean;
  bitrate: number;
  feed_chat_channel_id: string | null;
  feed_parent_channel_id: string | null;
  sign_posts: boolean;
  settings: Record<string, unknown> | null;
  created_at: Date;
};

export type ChannelExtraSettings = {
  privateChannel: boolean;
  locked: boolean;
  announcement: boolean;
  defaultNotifications: 'all' | 'mentions' | 'nothing';
  videoQuality: 'auto' | '720' | '1080';
  rtcRegion: string;
  defaultAutoArchiveMinutes: number;
  newMemberSlowmodeSeconds: number;
  disableReactions: boolean;
  voiceMode: 'voice_activity' | 'ptt';
  videoEnabled: boolean;
  streamEnabled: boolean;
  hideInactive: boolean;
  defaultThreadSlowmodeSeconds: number;
};

export function parseChannelSettings(raw: unknown): ChannelExtraSettings {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const notifications = value.defaultNotifications;
  const videoQuality = value.videoQuality;
  const voiceMode = value.voiceMode;
  return {
    privateChannel: Boolean(value.privateChannel),
    locked: Boolean(value.locked),
    announcement: Boolean(value.announcement),
    defaultNotifications: notifications === 'mentions' || notifications === 'nothing' ? notifications : 'all',
    videoQuality: videoQuality === '720' || videoQuality === '1080' ? videoQuality : 'auto',
    rtcRegion: typeof value.rtcRegion === 'string' && value.rtcRegion.trim() ? value.rtcRegion.trim().slice(0, 40) : 'automatic',
    defaultAutoArchiveMinutes: [60, 1440, 4320, 10080].includes(Number(value.defaultAutoArchiveMinutes))
      ? Number(value.defaultAutoArchiveMinutes)
      : 1440,
    newMemberSlowmodeSeconds: Math.max(0, Math.min(604800, Number(value.newMemberSlowmodeSeconds) || 0)),
    disableReactions: Boolean(value.disableReactions),
    voiceMode: voiceMode === 'ptt' ? 'ptt' : 'voice_activity',
    videoEnabled: value.videoEnabled !== false,
    streamEnabled: value.streamEnabled !== false,
    hideInactive: Boolean(value.hideInactive),
    defaultThreadSlowmodeSeconds: Math.max(0, Math.min(21600, Number(value.defaultThreadSlowmodeSeconds) || 0))
  };
}

export type GroupFolderRecord = {
  id: string;
  group_id: string;
  name: string;
  position: number;
  required_role_id: string | null;
  created_at: Date;
};

export type GroupMessageRecord = {
  id: string;
  group_id: string;
  channel_id: string | null;
  sender_id: string;
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
  pinned_at: Date | null;
  reply_to: string | null;
  feed_source_id: string | null;
  feed_mirror: boolean;
  view_count?: number;
  thread_root_id: string | null;
  thread_count?: number;
  comment_count?: number;
  scheduled_at: Date | null;
  link_preview: { url: string; title: string; description: string; imageUrl: string; siteName: string } | null;
  ai_generated?: boolean;
  ai_name?: string | null;
  ai_avatar_data?: string | null;
  created_at: Date;
};

export type PublicGroup = {
  id: string;
  name: string;
  avatarData: string;
  ownerId: string;
  inviteCode: string;
  nameplate: NamePlate | null;
  description: string;
  defaultRoleId: string | null;
  everyonePermissions: string[];
  automodWords: string[];
  createdAt: string;
};

export type PublicGroupMember = {
  user: UserRecord;
  role: string;
  roleId: string | null;
  // Every role the member holds (primary + extra customization roles).
  roleIds: string[];
  joinedAt: string;
};

export type PublicGroupRole = {
  id: string;
  groupId: string;
  name: string;
  color: string;
  position: number;
  isOwner: boolean;
  permissions: string[];
  hoist: boolean;
};

export type PublicGroupChannel = {
  id: string;
  groupId: string;
  name: string;
  position: number;
  folderId: string | null;
  type: 'text' | 'voice' | 'feed';
  userLimit: number | null;
  topic: string;
  slowmodeSeconds: number;
  nsfw: boolean;
  bitrate: number;
  feedChatChannelId: string | null;
  feedParentChannelId: string | null;
  // Feed channels: show which admin published each post.
  signPosts: boolean;
  // Role ids that gate visibility. Empty array = visible to everyone.
  requiredRoleIds: string[];
  settings: ChannelExtraSettings;
};

export type GroupIdentityRecord = GroupRecord & {
  member_count: number;
};

export type PublicGroupFolder = {
  id: string;
  groupId: string;
  name: string;
  position: number;
  // Role id that gates visibility (auto-created hidden folders). Null = public.
  requiredRoleId: string | null;
};

export type GroupMessageReaction = {
  emoji: string;
  count: number;
  userIds: string[];
};

export type GroupMessageReplySnippet = {
  id: string;
  senderId: string;
  senderGroup: { id: string; name: string; avatarData: string } | null;
  aiGenerated?: boolean;
  aiName?: string | null;
  aiAvatarData?: string | null;
  body: string;
  imageData: string | null;
  imageName: string | null;
  mediaItems: ChatMediaItem[];
  deletedAt: string | null;
  feedPost: boolean;
  feedSourceId: string | null;
  feedMirror: boolean;
  viewCount: number;
  reactions: GroupMessageReaction[];
  createdAt: string;
};

export type ChatMediaItem = {
  dataUrl: string;
  name: string | null;
  spoiler: boolean;
};

export type PublicGroupMessage = {
  id: string;
  groupId: string;
  channelId: string | null;
  senderId: string;
  senderGroup: { id: string; name: string; avatarData: string } | null;
  aiGenerated?: boolean;
  aiName?: string | null;
  aiAvatarData?: string | null;
  body: string;
  imageData: string | null;
  imageName: string | null;
  imageSpoiler: boolean;
  mediaItems: ChatMediaItem[];
  editedAt: string | null;
  deletedAt: string | null;
  pinnedAt: string | null;
  feedSourceId: string | null;
  feedMirror: boolean;
  viewCount: number;
  reactions: GroupMessageReaction[];
  replyTo: GroupMessageReplySnippet | null;
  linkPreview: { url: string; title: string; description: string; imageUrl: string; siteName: string } | null;
  threadRootId: string | null;
  threadCount: number;
  commentCount: number;
  scheduledAt: string | null;
  createdAt: string;
};

export function toPublicGroup(group: GroupRecord): PublicGroup {
  return {
    id: group.id,
    name: group.name,
    avatarData: group.avatar_data,
    ownerId: group.owner_id,
    inviteCode: group.invite_code,
    nameplate: group.nameplate ?? null,
    description: group.description ?? '',
    defaultRoleId: group.default_role_id ?? null,
    everyonePermissions: group.everyone_permissions ?? [],
    automodWords: Array.isArray(group.automod_words) ? group.automod_words : [],
    createdAt: group.created_at.toISOString()
  };
}

function normalizeGroupMediaItems(message: Pick<GroupMessageRecord, 'deleted_at' | 'media_items' | 'image_data' | 'image_name' | 'image_spoiler'>): ChatMediaItem[] {
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

export function toPublicGroupMessage(message: GroupMessageRecord, reactions: GroupMessageReaction[] = [], replyTo: GroupMessageReplySnippet | null = null): PublicGroupMessage {
  const mediaItems = normalizeGroupMediaItems(message);
  return {
    id: message.id,
    groupId: message.group_id,
    channelId: message.channel_id,
    senderId: message.sender_id,
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
    pinnedAt: message.deleted_at ? null : (message.pinned_at?.toISOString() ?? null),
    feedSourceId: message.feed_source_id ?? null,
    feedMirror: Boolean(message.feed_mirror),
    viewCount: Number(message.view_count ?? 0),
    reactions: message.deleted_at ? [] : reactions,
    replyTo,
    linkPreview: message.deleted_at ? null : message.link_preview ?? null,
    threadRootId: message.thread_root_id ?? null,
    threadCount: Number(message.thread_count ?? 0),
    commentCount: Number(message.comment_count ?? 0),
    scheduledAt: message.scheduled_at?.toISOString() ?? null,
    aiGenerated: Boolean(message.ai_generated),
    aiName: message.ai_name ?? null,
    aiAvatarData: message.ai_avatar_data ?? null,
    createdAt: message.created_at.toISOString()
  };
}

// Load reply snippets for a set of group-message reply ids in one query.
export async function loadGroupReplySnippets(replyIds: string[]): Promise<Map<string, GroupMessageReplySnippet>> {
  const map = new Map<string, GroupMessageReplySnippet>();
  const ids = [...new Set(replyIds.filter(Boolean))];
  if (ids.length === 0) return map;
  const result = await pool.query<GroupMessageRecord & { view_count: number; feed_post: boolean }>(
    `
      SELECT gm.*,
        (
          SELECT COUNT(*)::int
          FROM group_message_views gmv
          WHERE gmv.message_id = COALESCE(gm.feed_source_id, gm.id)
        ) AS view_count,
        (gm.feed_mirror OR gc.type = 'feed') AS feed_post
      FROM group_messages gm
      LEFT JOIN group_channels gc ON gc.id = gm.channel_id
      WHERE gm.id = ANY($1::uuid[])
    `,
    [ids]
  );
  const reactions = await loadReactionsForMessages(result.rows.map((row) => row.feed_source_id ?? row.id));
  for (const row of result.rows) {
    const mediaItems = normalizeGroupMediaItems(row);
    const canonicalId = row.feed_source_id ?? row.id;
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
      aiGenerated: Boolean(row.ai_generated),
      aiName: row.ai_name ?? null,
      aiAvatarData: row.ai_avatar_data ?? null,
      body: row.deleted_at ? '' : row.body,
      imageData: mediaItems[0]?.dataUrl ?? null,
      imageName: mediaItems[0]?.name ?? null,
      mediaItems,
      deletedAt: row.deleted_at?.toISOString() ?? null,
      feedPost: Boolean(row.feed_post),
      feedSourceId: row.feed_source_id ?? null,
      feedMirror: Boolean(row.feed_mirror),
      viewCount: Number(row.view_count ?? 0),
      reactions: reactions.get(canonicalId) ?? [],
      createdAt: row.created_at.toISOString()
    });
  }
  return map;
}

type ReactionRow = { message_id: string; user_id: string; emoji: string };

// Load reactions for a set of message ids, grouped per message and per emoji.
// Returns a Map keyed by message id; emojis keep first-seen insertion order.
export async function loadReactionsForMessages(messageIds: string[]): Promise<Map<string, GroupMessageReaction[]>> {
  const map = new Map<string, GroupMessageReaction[]>();
  if (messageIds.length === 0) return map;
  const result = await pool.query<ReactionRow>(
    `
      SELECT message_id, user_id, emoji
      FROM group_message_reactions
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

// Load reactions for a single message.
export async function loadReactionsForMessage(messageId: string): Promise<GroupMessageReaction[]> {
  const map = await loadReactionsForMessages([messageId]);
  return map.get(messageId) ?? [];
}

// Convert a list of message records to public messages with their reactions
// attached in a single batched query.
export async function toPublicGroupMessagesWithReactions(messages: GroupMessageRecord[]): Promise<PublicGroupMessage[]> {
  const reactionIds = messages.filter((m) => !m.deleted_at).map((m) => m.feed_source_id ?? m.id);
  const reactions = await loadReactionsForMessages(reactionIds);
  const replies = await loadGroupReplySnippets(messages.map((m) => m.reply_to).filter((id): id is string => Boolean(id)));
  return messages.map((m) => toPublicGroupMessage(m, reactions.get(m.feed_source_id ?? m.id) ?? [], m.reply_to ? replies.get(m.reply_to) ?? null : null));
}

// Enrich a single group message record with reactions + reply snippet.
export async function toPublicGroupMessageEnriched(message: GroupMessageRecord): Promise<PublicGroupMessage> {
  const [enriched] = await toPublicGroupMessagesWithReactions([message]);
  return enriched;
}

// Toggle a reaction: if the user already reacted with this emoji it is removed,
// otherwise it is added. Returns the updated reaction list for the message.
export async function toggleGroupMessageReaction(messageId: string, userId: string, emoji: string): Promise<GroupMessageReaction[]> {
  const existing = await pool.query(
    'SELECT 1 FROM group_message_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3',
    [messageId, userId, emoji]
  );
  if ((existing.rowCount ?? 0) > 0) {
    await pool.query(
      'DELETE FROM group_message_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3',
      [messageId, userId, emoji]
    );
  } else {
    await pool.query(
      'INSERT INTO group_message_reactions (message_id, user_id, emoji) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [messageId, userId, emoji]
    );
  }
  return loadReactionsForMessage(messageId);
}

export function generateInviteCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let code = '';
  for (let i = 0; i < 12; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return `gc_${code}`;
}

const DEFAULT_GROUP_EVERYONE_PERMISSIONS = [
  'ViewChannel',
  'SendMessages',
  'AttachFiles',
  'AddReactions',
  'UseExternalEmojis',
  'ReadMessageHistory',
  'SendVoiceMessages',
  'SendVideoCircles',
  'CreatePolls'
];

export async function createGroup(ownerId: string, name: string, avatarData: string) {
  const id = randomUUID();
  const inviteCode = generateInviteCode();
  const ownerRoleId = randomUUID();
  const generalChannelId = randomUUID();

  const result = await pool.query<GroupRecord>(
    `
      INSERT INTO groups (id, name, avatar_data, owner_id, invite_code, everyone_permissions)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `,
    [id, name, avatarData, ownerId, inviteCode, JSON.stringify(DEFAULT_GROUP_EVERYONE_PERMISSIONS)]
  );

  await pool.query(
    `
      INSERT INTO group_roles (id, group_id, name, color, position, is_owner, permissions)
      VALUES ($1, $2, 'Owner', '#ffd700', 0, TRUE, $3)
    `,
    [ownerRoleId, id, JSON.stringify(['Administrator', 'ManageServer', 'ManageRoles', 'DeleteAnyMessage', 'ManageChannels', 'ManageInvites', 'KickMembers', 'BanMembers', 'TimeoutMembers', 'MuteMembers', 'MentionEveryone', 'SendVoiceMessages', 'SendVideoCircles', 'Connect', 'Speak'])]
  );

  await pool.query(
    `
      INSERT INTO group_members (group_id, user_id, role, role_id)
      VALUES ($1, $2, 'Owner', $3)
    `,
    [id, ownerId, ownerRoleId]
  );

  await pool.query(
    `
      INSERT INTO group_channels (id, group_id, name)
      VALUES ($1, $2, 'general')
    `,
    [generalChannelId, id]
  );

  return result.rows[0];
}

// ── Group CRUD ──

export async function getUserGroups(userId: string) {
  const result = await pool.query<GroupRecord>(
    `
      SELECT groups.*
      FROM groups
      JOIN group_members ON group_members.group_id = groups.id
      WHERE group_members.user_id = $1
      ORDER BY groups.created_at DESC
    `,
    [userId]
  );
  return result.rows;
}

const GROUP_IDENTITY_PERMISSIONS = ['ManageRoles', 'DeleteAnyMessage', 'ManageChannels', 'ManageInvites', 'KickMembers', 'ManageMessages'];

export async function listGroupIdentitiesForUser(userId: string) {
  const result = await pool.query<GroupIdentityRecord>(
    `
      WITH member_role_ids AS (
        SELECT gm.group_id, gm.user_id, gm.role_id
        FROM group_members gm
        WHERE gm.user_id = $1
        UNION
        SELECT gmr.group_id, gmr.user_id, gmr.role_id
        FROM group_member_roles gmr
        WHERE gmr.user_id = $1
      ),
      member_counts AS (
        SELECT group_id, COUNT(*)::int AS member_count
        FROM group_members
        GROUP BY group_id
      )
      SELECT groups.*, COALESCE(member_counts.member_count, 0) AS member_count
      FROM groups
      JOIN group_members self_member ON self_member.group_id = groups.id AND self_member.user_id = $1
      LEFT JOIN member_counts ON member_counts.group_id = groups.id
      WHERE groups.owner_id = $1
        OR EXISTS (
          SELECT 1
          FROM member_role_ids mri
          JOIN group_roles gr ON gr.id = mri.role_id AND gr.group_id = mri.group_id
          WHERE mri.group_id = groups.id
            AND (gr.is_owner = TRUE OR gr.permissions ?| $2::text[])
        )
      ORDER BY groups.created_at DESC
    `,
    [userId, GROUP_IDENTITY_PERMISSIONS]
  );
  return result.rows;
}

export async function getGroupIdentityForUser(userId: string, groupId: string) {
  const result = await pool.query<GroupIdentityRecord>(
    `
      WITH member_role_ids AS (
        SELECT gm.group_id, gm.user_id, gm.role_id
        FROM group_members gm
        WHERE gm.user_id = $1 AND gm.group_id = $2
        UNION
        SELECT gmr.group_id, gmr.user_id, gmr.role_id
        FROM group_member_roles gmr
        WHERE gmr.user_id = $1 AND gmr.group_id = $2
      ),
      member_counts AS (
        SELECT group_id, COUNT(*)::int AS member_count
        FROM group_members
        WHERE group_id = $2
        GROUP BY group_id
      )
      SELECT groups.*, COALESCE(member_counts.member_count, 0) AS member_count
      FROM groups
      JOIN group_members self_member ON self_member.group_id = groups.id AND self_member.user_id = $1
      LEFT JOIN member_counts ON member_counts.group_id = groups.id
      WHERE groups.id = $2
        AND (
          groups.owner_id = $1
          OR EXISTS (
            SELECT 1
            FROM member_role_ids mri
            JOIN group_roles gr ON gr.id = mri.role_id AND gr.group_id = mri.group_id
            WHERE mri.group_id = groups.id
              AND (gr.is_owner = TRUE OR gr.permissions ?| $3::text[])
          )
        )
      LIMIT 1
    `,
    [userId, groupId, GROUP_IDENTITY_PERMISSIONS]
  );
  return result.rows[0] ?? null;
}

// Groups that both users are members of (used by the profile card to show
// the "Mutual groups" list).
export async function getMutualGroups(userId: string, otherUserId: string) {
  const result = await pool.query<GroupRecord>(
    `
      SELECT groups.*
      FROM groups
      JOIN group_members gm1 ON gm1.group_id = groups.id AND gm1.user_id = $1
      JOIN group_members gm2 ON gm2.group_id = groups.id AND gm2.user_id = $2
      ORDER BY groups.created_at DESC
    `,
    [userId, otherUserId]
  );
  return result.rows;
}

export async function getGroupById(groupId: string) {
  const result = await pool.query<GroupRecord>('SELECT * FROM groups WHERE id = $1', [groupId]);
  return result.rows[0] ?? null;
}

export async function updateGroup(
  groupId: string,
  _userId: string,
  updates: { name?: string; avatarData?: string; nameplate?: NamePlate | null; description?: string; automodWords?: string[]; ownerId?: string }
) {
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let paramIdx = 1;

  if (updates.name !== undefined) {
    setClauses.push(`name = $${paramIdx++}`);
    values.push(updates.name);
  }
  if (updates.automodWords !== undefined) {
    setClauses.push(`automod_words = $${paramIdx++}::jsonb`);
    values.push(JSON.stringify(updates.automodWords));
  }
  if (updates.avatarData !== undefined) {
    setClauses.push(`avatar_data = $${paramIdx++}`);
    values.push(updates.avatarData);
  }
  if (updates.description !== undefined) {
    setClauses.push(`description = $${paramIdx++}`);
    values.push(updates.description);
  }
  // `nameplate` accepts an explicit null to clear the saved plate.
  if (Object.prototype.hasOwnProperty.call(updates, 'nameplate')) {
    setClauses.push(`nameplate = $${paramIdx++}::jsonb`);
    values.push(updates.nameplate == null ? null : JSON.stringify(updates.nameplate));
  }
  if (updates.ownerId !== undefined) {
    setClauses.push(`owner_id = $${paramIdx++}`);
    values.push(updates.ownerId);
  }

  if (setClauses.length === 0) return getGroupById(groupId);

  values.push(groupId);
  const result = await pool.query<GroupRecord>(
    `UPDATE groups SET ${setClauses.join(', ')} WHERE id = $${paramIdx} RETURNING *`,
    values
  );
  return result.rows[0] ?? null;
}

export async function deleteGroup(groupId: string, userId: string) {
  const result = await pool.query<GroupRecord>(
    "DELETE FROM groups WHERE id = $1 AND owner_id = $2 RETURNING *",
    [groupId, userId]
  );
  return result.rows[0] ?? null;
}

// ── Members ──

export async function addGroupMember(groupId: string, userId: string, roleId?: string) {
  const banned = await pool.query('SELECT 1 FROM group_bans WHERE group_id = $1 AND user_id = $2 LIMIT 1', [groupId, userId]);
  if ((banned.rowCount ?? 0) > 0) throw new Error('GROUP_BANNED');
  const role = roleId || (await getDefaultRole(groupId));
  const roleRecord = role ? await pool.query<GroupRoleRecord>('SELECT * FROM group_roles WHERE id = $1', [role]) : null;
  const roleName = roleRecord?.rows[0]?.name ?? 'Member';
  await pool.query(
    `
      INSERT INTO group_members (group_id, user_id, role, role_id)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (group_id, user_id) DO UPDATE SET role_id = $4, role = $3
    `,
    [groupId, userId, roleName, role]
  );
}

async function getDefaultRole(groupId: string) {
  // Prefer the explicitly configured default role (if it still exists and is
  // not the owner role); otherwise fall back to the lowest non-owner role.
  const configured = await pool.query<{ id: string }>(
    `
      SELECT gr.id
      FROM groups g
      JOIN group_roles gr ON gr.id = g.default_role_id
      WHERE g.id = $1 AND gr.group_id = $1 AND NOT gr.is_owner
    `,
    [groupId]
  );
  if (configured.rows[0]?.id) return configured.rows[0].id;

  const result = await pool.query<GroupRoleRecord>(
    'SELECT id FROM group_roles WHERE group_id = $1 AND NOT is_owner ORDER BY position ASC LIMIT 1',
    [groupId]
  );
  return result.rows[0]?.id ?? null;
}

// Configure (or clear with null) the role automatically assigned to members
// when they join the group. Validates that the role belongs to the group and
// is not the owner role.
export async function setGroupDefaultRole(groupId: string, roleId: string | null) {
  if (roleId) {
    const role = await pool.query(
      'SELECT id FROM group_roles WHERE id = $1 AND group_id = $2 AND NOT is_owner',
      [roleId, groupId]
    );
    if (!role.rows[0]) return null;
  }
  const result = await pool.query<GroupRecord>(
    'UPDATE groups SET default_role_id = $2 WHERE id = $1 RETURNING *',
    [groupId, roleId]
  );
  return result.rows[0] ?? null;
}

export async function removeGroupMember(groupId: string, userId: string, _requesterId?: string) {
  await pool.query('DELETE FROM group_member_roles WHERE group_id = $1 AND user_id = $2', [groupId, userId]);
  await pool.query('DELETE FROM group_onboarding_state WHERE group_id = $1 AND user_id = $2', [groupId, userId]);
  const result = await pool.query(
    'DELETE FROM group_members WHERE group_id = $1 AND user_id = $2 RETURNING user_id',
    [groupId, userId]
  );
  return (result.rowCount ?? 0) > 0;
}

// Lightweight member-id lookup for fan-out broadcasts. The full listGroupMembers
// query pulls every member's complete user row (avatar/wallpaper/pinned base64)
// plus a per-member role subquery — far too heavy to run just to learn which
// user rooms to emit a socket event to. This selects only the ids.
export async function listGroupMemberIds(groupId: string): Promise<string[]> {
  const result = await pool.query<{ user_id: string }>(
    'SELECT user_id FROM group_members WHERE group_id = $1',
    [groupId]
  );
  return result.rows.map((row) => row.user_id);
}

export async function listGroupMembers(groupId: string) {
  const result = await pool.query<GroupMemberRecord & UserRecord & { role_color: string; role_position: number; role_ids: string[]; account_role: string }>(
    `
      WITH extra_roles AS (
        SELECT group_id, user_id, array_agg(DISTINCT role_id) AS role_ids
        FROM group_member_roles
        WHERE group_id = $1
        GROUP BY group_id, user_id
      )
      SELECT ${liteUserColumns('users')}, gm.user_id, gm.role, gm.role_id, gm.joined_at,
        COALESCE(NULLIF(gm.nickname, ''), users.nickname) AS nickname,
        gm.nickname AS member_nickname,
        gm.timeout_until,
        -- gm.role (the group role) overwrites users.role in the result row, so
        -- expose the global account role separately for badges (e.g. 'dev').
        users.role AS account_role,
        COALESCE(gr.color, '#8a8a8a') AS role_color,
        COALESCE(gr.position, 999) AS role_position,
        -- All roles the member holds: the primary role_id plus every extra
        -- customization role from group_member_roles, de-duplicated.
        COALESCE(
          ARRAY(
            SELECT DISTINCT rid
            FROM unnest(ARRAY[gm.role_id]::uuid[] || COALESCE(er.role_ids, '{}'::uuid[])) AS rid
            WHERE rid IS NOT NULL
          ),
          '{}'
        ) AS role_ids
      FROM group_members gm
      JOIN users ON users.id = gm.user_id
      LEFT JOIN group_roles gr ON gr.id = gm.role_id
      LEFT JOIN extra_roles er ON er.group_id = gm.group_id AND er.user_id = gm.user_id
      WHERE gm.group_id = $1
      ORDER BY role_position ASC, gm.joined_at ASC
    `,
    [groupId]
  );
  return result.rows;
}

export async function isGroupMember(groupId: string, userId: string) {
  const result = await pool.query(
    "SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2 LIMIT 1",
    [groupId, userId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function getGroupByInviteCode(inviteCode: string) {
  const invite = await pool.query<GroupInviteRecord>('SELECT * FROM group_invites WHERE code = $1', [inviteCode]);
  if (invite.rows[0]) {
    const group = await pool.query<GroupRecord>('SELECT * FROM groups WHERE id = $1', [invite.rows[0].group_id]);
    return group.rows[0] ?? null;
  }
  const result = await pool.query<GroupRecord>('SELECT * FROM groups WHERE invite_code = $1', [inviteCode]);
  return result.rows[0] ?? null;
}

export async function getGroupInviteByCode(inviteCode: string) {
  const result = await pool.query<GroupInviteRecord>('SELECT * FROM group_invites WHERE code = $1', [inviteCode]);
  return result.rows[0] ?? null;
}

export async function listGroupInvites(groupId: string, channelId?: string | null) {
  const where = channelId === undefined
    ? { sql: 'group_id = $1', params: [groupId] as unknown[] }
    : channelId === null
      ? { sql: 'group_id = $1 AND channel_id IS NULL', params: [groupId] as unknown[] }
      : { sql: 'group_id = $1 AND channel_id = $2', params: [groupId, channelId] as unknown[] };
  const result = await pool.query<GroupInviteRecord>(
    `SELECT * FROM group_invites WHERE ${where.sql} ORDER BY created_at DESC`,
    where.params
  );
  return result.rows;
}

export async function createGroupInvite(
  groupId: string,
  creatorId: string,
  channelId: string | null = null,
  options?: { maxUses?: number | null; expiresAt?: Date | null }
) {
  const result = await pool.query<GroupInviteRecord>(
    `
      INSERT INTO group_invites (id, group_id, channel_id, code, creator_id, max_uses, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `,
    [randomUUID(), groupId, channelId, generateInviteCode(), creatorId, options?.maxUses ?? null, options?.expiresAt ?? null]
  );
  return result.rows[0];
}

export async function deleteGroupInvite(groupId: string, inviteId: string) {
  const result = await pool.query<GroupInviteRecord>(
    'DELETE FROM group_invites WHERE id = $1 AND group_id = $2 RETURNING *',
    [inviteId, groupId]
  );
  return result.rows[0] ?? null;
}

export async function incrementGroupInviteUse(inviteCode: string) {
  await pool.query('UPDATE group_invites SET uses_count = uses_count + 1 WHERE code = $1', [inviteCode]);
}

export function isInviteUsable(invite: GroupInviteRecord) {
  if (invite.expires_at && invite.expires_at.getTime() <= Date.now()) return false;
  if (invite.max_uses != null && invite.uses_count >= invite.max_uses) return false;
  return true;
}

export async function reorderGroupRoles(groupId: string, roleIds: string[]) {
  for (let index = 0; index < roleIds.length; index += 1) {
    await pool.query(
      'UPDATE group_roles SET position = $1 WHERE id = $2 AND group_id = $3 AND NOT is_owner',
      [index + 1, roleIds[index], groupId]
    );
  }
  return listGroupRoles(groupId);
}

export async function isGroupBanned(groupId: string, userId: string) {
  const result = await pool.query('SELECT 1 FROM group_bans WHERE group_id = $1 AND user_id = $2 LIMIT 1', [groupId, userId]);
  return (result.rowCount ?? 0) > 0;
}

export async function listGroupBans(groupId: string) {
  const result = await pool.query<GroupBanRecord>(
    'SELECT * FROM group_bans WHERE group_id = $1 ORDER BY created_at DESC',
    [groupId]
  );
  return result.rows;
}

export async function banGroupMember(groupId: string, userId: string, bannedBy: string, reason: string) {
  await pool.query(
    `
      INSERT INTO group_bans (group_id, user_id, banned_by, reason)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (group_id, user_id) DO UPDATE SET banned_by = $3, reason = $4, created_at = NOW()
    `,
    [groupId, userId, bannedBy, reason]
  );
  await removeGroupMember(groupId, userId);
}

export async function unbanGroupMember(groupId: string, userId: string) {
  const result = await pool.query('DELETE FROM group_bans WHERE group_id = $1 AND user_id = $2 RETURNING user_id', [groupId, userId]);
  return (result.rowCount ?? 0) > 0;
}

export async function setGroupMemberTimeout(groupId: string, userId: string, timeoutUntil: Date | null) {
  const result = await pool.query<GroupMemberRecord>(
    'UPDATE group_members SET timeout_until = $3 WHERE group_id = $1 AND user_id = $2 RETURNING *',
    [groupId, userId, timeoutUntil]
  );
  return result.rows[0] ?? null;
}

export async function setGroupMemberNickname(groupId: string, userId: string, nickname: string) {
  const result = await pool.query<GroupMemberRecord>(
    'UPDATE group_members SET nickname = $3 WHERE group_id = $1 AND user_id = $2 RETURNING *',
    [groupId, userId, nickname]
  );
  return result.rows[0] ?? null;
}

export async function getGroupMemberTimeout(groupId: string, userId: string) {
  const result = await pool.query<{ timeout_until: Date | null }>(
    'SELECT timeout_until FROM group_members WHERE group_id = $1 AND user_id = $2',
    [groupId, userId]
  );
  return result.rows[0]?.timeout_until ?? null;
}

export async function listChannelPermissionOverrides(channelId: string) {
  const result = await pool.query<GroupChannelPermissionOverrideRecord>(
    'SELECT channel_id, role_id, target_id, permission, value FROM group_channel_permission_overrides WHERE channel_id = $1 ORDER BY target_id, permission',
    [channelId]
  );
  return result.rows;
}

export async function upsertChannelPermissionOverride(
  channelId: string,
  roleId: string,
  permission: string,
  value: 'allow' | 'deny'
) {
  const storedRoleId = roleId === '@everyone' ? null : roleId;
  await pool.query(
    `
      INSERT INTO group_channel_permission_overrides (channel_id, role_id, target_id, permission, value)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (channel_id, target_id, permission)
      DO UPDATE SET value = EXCLUDED.value
    `,
    [channelId, storedRoleId, roleId, permission, value]
  );
}

export async function deleteChannelPermissionOverride(channelId: string, roleId: string, permission: string) {
  await pool.query(
    'DELETE FROM group_channel_permission_overrides WHERE channel_id = $1 AND target_id = $2 AND permission = $3',
    [channelId, roleId, permission]
  );
}

export async function cloneGroupChannel(channel: GroupChannelRecord, name: string) {
  const created = await createGroupChannel(
    channel.group_id,
    name,
    channel.type === 'voice' ? 'voice' : channel.type === 'feed' ? 'feed' : 'text',
    { folderId: channel.folder_id }
  );
  const updated = await updateGroupChannel(created.id, channel.group_id, {
    topic: channel.topic,
    slowmodeSeconds: channel.slowmode_seconds,
    nsfw: channel.nsfw,
    bitrate: channel.bitrate,
    userLimit: channel.user_limit,
    signPosts: channel.sign_posts,
    settings: parseChannelSettings(channel.settings)
  });
  const overrides = await listChannelPermissionOverrides(channel.id);
  if (overrides.length > 0) {
    await replaceChannelPermissionOverrides(
      created.id,
      overrides.map((override) => ({
        roleId: override.target_id,
        permission: override.permission,
        value: override.value
      }))
    );
  }
  return updated ?? created;
}

export async function replaceChannelPermissionOverrides(
  channelId: string,
  overrides: Array<{ roleId: string; permission: string; value: 'allow' | 'deny' }>
) {
  await pool.query('DELETE FROM group_channel_permission_overrides WHERE channel_id = $1', [channelId]);
  for (const override of overrides) {
    const targetId = override.roleId;
    const roleId = override.roleId === '@everyone' ? null : override.roleId;
    await pool.query(
      `
        INSERT INTO group_channel_permission_overrides (channel_id, role_id, target_id, permission, value)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (channel_id, target_id, permission)
        DO UPDATE SET value = EXCLUDED.value
      `,
      [channelId, roleId, targetId, override.permission, override.value]
    );
  }
}

export async function regenerateInviteCode(groupId: string) {
  const result = await pool.query<GroupRecord>(
    "UPDATE groups SET invite_code = $1 WHERE id = $2 RETURNING *",
    [generateInviteCode(), groupId]
  );
  return result.rows[0] ?? null;
}

// ── Roles ──

export async function listGroupRoles(groupId: string) {
  const result = await pool.query<GroupRoleRecord>(
    'SELECT * FROM group_roles WHERE group_id = $1 ORDER BY position ASC',
    [groupId]
  );
  return result.rows;
}

export async function createGroupRole(groupId: string, name: string, color: string, permissions: string[] = []) {
  const maxPos = await pool.query('SELECT COALESCE(MAX(position), -1) + 1 AS next_pos FROM group_roles WHERE group_id = $1', [groupId]);
  const position = maxPos.rows[0]?.next_pos ?? 0;
  const result = await pool.query<GroupRoleRecord>(
    `
      INSERT INTO group_roles (id, group_id, name, color, position, permissions)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `,
    [randomUUID(), groupId, name, color, position, JSON.stringify(permissions)]
  );
  return result.rows[0];
}

export async function deleteGroupRole(roleId: string, groupId: string) {
  const role = await pool.query('SELECT * FROM group_roles WHERE id = $1 AND group_id = $2', [roleId, groupId]);
  if (!role.rows[0] || role.rows[0].is_owner) return false;

  const defaultRole = await getDefaultRole(groupId);
  const fallbackRole = defaultRole && defaultRole !== roleId ? defaultRole : null;
  await pool.query('DELETE FROM group_member_roles WHERE group_id = $1 AND role_id = $2', [groupId, roleId]);
  await pool.query('UPDATE groups SET default_role_id = NULL WHERE id = $1 AND default_role_id = $2', [groupId, roleId]);
  if (fallbackRole) {
    await pool.query(
      'UPDATE group_members SET role_id = $1, role = (SELECT name FROM group_roles WHERE id = $1) WHERE role_id = $2',
      [fallbackRole, roleId]
    );
  } else {
    await pool.query(
      "UPDATE group_members SET role_id = NULL, role = 'member' WHERE group_id = $1 AND role_id = $2",
      [groupId, roleId]
    );
  }

  await pool.query('DELETE FROM group_roles WHERE id = $1', [roleId]);
  return true;
}

export async function updateGroupRole(roleId: string, groupId: string, updates: { name?: string; color?: string; position?: number; permissions?: string[]; hoist?: boolean }) {
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let paramIdx = 1;

  if (updates.name !== undefined) { setClauses.push(`name = $${paramIdx++}`); values.push(updates.name); }
  if (updates.color !== undefined) { setClauses.push(`color = $${paramIdx++}`); values.push(updates.color); }
  if (updates.position !== undefined) { setClauses.push(`position = $${paramIdx++}`); values.push(updates.position); }
  if (updates.permissions !== undefined) { setClauses.push(`permissions = $${paramIdx++}`); values.push(JSON.stringify(updates.permissions)); }
  if (updates.hoist !== undefined) { setClauses.push(`hoist = $${paramIdx++}`); values.push(updates.hoist); }
  if (setClauses.length === 0) return null;

  values.push(roleId, groupId);
  const result = await pool.query<GroupRoleRecord>(
    `UPDATE group_roles SET ${setClauses.join(', ')} WHERE id = $${paramIdx} AND group_id = $${paramIdx + 1} RETURNING *`,
    values
  );
  return result.rows[0] ?? null;
}

// ── Channels ──

export async function updateGroupEveryonePermissions(groupId: string, permissions: string[]) {
  const result = await pool.query<GroupRecord>(
    'UPDATE groups SET everyone_permissions = $1 WHERE id = $2 RETURNING *',
    [JSON.stringify(permissions), groupId]
  );
  return result.rows[0] ?? null;
}

export async function listGroupChannels(groupId: string) {
  const result = await pool.query<GroupChannelRecord>(
    'SELECT * FROM group_channels WHERE group_id = $1 ORDER BY position ASC, created_at ASC',
    [groupId]
  );
  return result.rows;
}

export async function getGroupChannelById(channelId: string) {
  const result = await pool.query<GroupChannelRecord>(
    'SELECT * FROM group_channels WHERE id = $1',
    [channelId]
  );
  return result.rows[0] ?? null;
}

export async function createGroupChannel(
  groupId: string,
  name: string,
  type: 'text' | 'voice' | 'feed' = 'text',
  options: { folderId?: string | null; feedChatChannelId?: string | null; feedParentChannelId?: string | null } = {}
) {
  const maxPos = await pool.query(
    'SELECT COALESCE(MAX(position), -1) + 1 AS next_pos FROM group_channels WHERE group_id = $1',
    [groupId]
  );
  const position = maxPos.rows[0]?.next_pos ?? 0;
  const result = await pool.query<GroupChannelRecord>(
    `
      INSERT INTO group_channels (id, group_id, name, position, type, folder_id, feed_chat_channel_id, feed_parent_channel_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `,
    [randomUUID(), groupId, name, position, type, options.folderId ?? null, options.feedChatChannelId ?? null, options.feedParentChannelId ?? null]
  );
  return result.rows[0];
}

export async function createGroupFeed(groupId: string, name: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const folderPos = await client.query(
      'SELECT COALESCE(MAX(position), -1) + 1 AS next_pos FROM group_folders WHERE group_id = $1',
      [groupId]
    );
    const folderId = randomUUID();
    const folder = await client.query<GroupFolderRecord>(
      `
        INSERT INTO group_folders (id, group_id, name, position)
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `,
      [folderId, groupId, name, folderPos.rows[0]?.next_pos ?? 0]
    );

    const channelPos = await client.query(
      'SELECT COALESCE(MAX(position), -1) + 1 AS next_pos FROM group_channels WHERE group_id = $1',
      [groupId]
    );
    const feedId = randomUUID();
    const chatId = randomUUID();
    const basePos = Number(channelPos.rows[0]?.next_pos ?? 0);
    const feed = await client.query<GroupChannelRecord>(
      `
        INSERT INTO group_channels (id, group_id, name, position, type, folder_id)
        VALUES ($1, $2, $3, $4, 'feed', $5)
        RETURNING *
      `,
      [feedId, groupId, name, basePos, folderId]
    );
    const chat = await client.query<GroupChannelRecord>(
      `
        INSERT INTO group_channels (id, group_id, name, position, type, folder_id, feed_parent_channel_id)
        VALUES ($1, $2, $3, $4, 'text', $5, $6)
        RETURNING *
      `,
      [chatId, groupId, 'chat', basePos + 1, folderId, feedId]
    );
    const updatedFeed = await client.query<GroupChannelRecord>(
      `
        UPDATE group_channels
        SET feed_chat_channel_id = $1
        WHERE id = $2
        RETURNING *
      `,
      [chatId, feedId]
    );
    await client.query('COMMIT');
    return { folder: folder.rows[0], feed: updatedFeed.rows[0] ?? feed.rows[0], chat: chat.rows[0] };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteGroupChannel(channelId: string, groupId: string) {
  const result = await pool.query(
    `
      DELETE FROM group_channels
      WHERE id = $1
        AND group_id = $2
        AND name <> 'general'
        AND type <> 'feed'
        AND feed_parent_channel_id IS NULL
      RETURNING id
    `,
    [channelId, groupId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function updateGroupChannel(
  channelId: string,
  groupId: string,
  updates: { name?: string; position?: number; folderId?: string | null; userLimit?: number | null; topic?: string; slowmodeSeconds?: number; nsfw?: boolean; bitrate?: number; signPosts?: boolean; settings?: ChannelExtraSettings }
) {
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let paramIdx = 1;

  if (updates.name !== undefined) { setClauses.push(`name = $${paramIdx++}`); values.push(updates.name); }
  if (updates.position !== undefined) { setClauses.push(`position = $${paramIdx++}`); values.push(updates.position); }
  if (updates.folderId !== undefined) { setClauses.push(`folder_id = $${paramIdx++}`); values.push(updates.folderId); }
  if (updates.userLimit !== undefined) { setClauses.push(`user_limit = $${paramIdx++}`); values.push(updates.userLimit); }
  if (updates.topic !== undefined) { setClauses.push(`topic = $${paramIdx++}`); values.push(updates.topic); }
  if (updates.slowmodeSeconds !== undefined) { setClauses.push(`slowmode_seconds = $${paramIdx++}`); values.push(updates.slowmodeSeconds); }
  if (updates.nsfw !== undefined) { setClauses.push(`nsfw = $${paramIdx++}`); values.push(updates.nsfw); }
  if (updates.bitrate !== undefined) { setClauses.push(`bitrate = $${paramIdx++}`); values.push(updates.bitrate); }
  if (updates.signPosts !== undefined) { setClauses.push(`sign_posts = $${paramIdx++}`); values.push(updates.signPosts); }
  if (updates.settings !== undefined) { setClauses.push(`settings = $${paramIdx++}::jsonb`); values.push(JSON.stringify(updates.settings)); }

  if (setClauses.length === 0) return null;

  values.push(channelId, groupId);
  const result = await pool.query<GroupChannelRecord>(
    `UPDATE group_channels SET ${setClauses.join(', ')} WHERE id = $${paramIdx} AND group_id = $${paramIdx + 1} RETURNING *`,
    values
  );
  return result.rows[0] ?? null;
}

export async function reorderGroupChannels(
  groupId: string,
  items: { id: string; position: number; folderId: string | null }[]
) {
  if (items.length > 0) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query<GroupChannelRecord>(
        'SELECT * FROM group_channels WHERE group_id = $1 ORDER BY position ASC, created_at ASC',
        [groupId]
      );
      const byId = new Map(existing.rows.map((channel) => [channel.id, channel]));
      const feedChildren = new Map<string, GroupChannelRecord[]>();
      for (const channel of existing.rows) {
        if (!channel.feed_parent_channel_id) continue;
        const children = feedChildren.get(channel.feed_parent_channel_id) ?? [];
        children.push(channel);
        feedChildren.set(channel.feed_parent_channel_id, children);
      }

      const orderedItems = [...items].sort((a, b) => a.position - b.position);
      const normalized: { id: string; folderId: string | null }[] = [];
      const seen = new Set<string>();

      const appendChannel = (item: { id: string; folderId: string | null }) => {
        const channel = byId.get(item.id);
        if (!channel || seen.has(channel.id) || channel.feed_parent_channel_id || channel.type === 'feed') return;
        normalized.push({ id: channel.id, folderId: item.folderId });
        seen.add(channel.id);
      };

      for (const item of orderedItems) appendChannel(item);
      for (const channel of existing.rows) {
        if (seen.has(channel.id)) continue;
        if (channel.type === 'feed') {
          normalized.push({ id: channel.id, folderId: channel.folder_id });
          seen.add(channel.id);
          for (const child of feedChildren.get(channel.id) ?? []) {
            if (seen.has(child.id)) continue;
            normalized.push({ id: child.id, folderId: channel.folder_id });
            seen.add(child.id);
          }
          continue;
        }
        appendChannel({ id: channel.id, folderId: channel.folder_id });
      }

      for (const [position, item] of normalized.entries()) {
        await client.query(
          'UPDATE group_channels SET position = $1, folder_id = $2 WHERE id = $3 AND group_id = $4',
          [position, item.folderId, item.id, groupId]
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  return listGroupChannels(groupId);
}

// ── Folders ──

export async function listGroupFolders(groupId: string) {
  const result = await pool.query<GroupFolderRecord>(
    'SELECT * FROM group_folders WHERE group_id = $1 ORDER BY position ASC, created_at ASC',
    [groupId]
  );
  return result.rows;
}

export async function createGroupFolder(groupId: string, name: string) {
  const maxPos = await pool.query(
    'SELECT COALESCE(MAX(position), -1) + 1 AS next_pos FROM group_folders WHERE group_id = $1',
    [groupId]
  );
  const position = maxPos.rows[0]?.next_pos ?? 0;
  const result = await pool.query<GroupFolderRecord>(
    `
      INSERT INTO group_folders (id, group_id, name, position)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `,
    [randomUUID(), groupId, name, position]
  );
  return result.rows[0];
}

export async function updateGroupFolder(
  folderId: string,
  groupId: string,
  updates: { name?: string; position?: number }
) {
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let paramIdx = 1;

  if (updates.name !== undefined) { setClauses.push(`name = $${paramIdx++}`); values.push(updates.name); }
  if (updates.position !== undefined) { setClauses.push(`position = $${paramIdx++}`); values.push(updates.position); }
  if (setClauses.length === 0) return null;

  values.push(folderId, groupId);
  const result = await pool.query<GroupFolderRecord>(
    `UPDATE group_folders SET ${setClauses.join(', ')} WHERE id = $${paramIdx} AND group_id = $${paramIdx + 1} RETURNING *`,
    values
  );
  return result.rows[0] ?? null;
}

export async function deleteGroupFolder(folderId: string, groupId: string) {
  const feedChannels = await pool.query<{ id: string }>(
    "SELECT id FROM group_channels WHERE folder_id = $1 AND group_id = $2 AND type = 'feed'",
    [folderId, groupId]
  );
  const feedIds = feedChannels.rows.map((channel) => channel.id);
  if (feedIds.length > 0) {
    await pool.query(
      `
        DELETE FROM group_channels
        WHERE group_id = $1
          AND (id = ANY($2::uuid[]) OR feed_parent_channel_id = ANY($2::uuid[]))
      `,
      [groupId, feedIds]
    );
  }
  await pool.query(
    `
      UPDATE group_channels
      SET folder_id = NULL
      WHERE folder_id = $1
        AND group_id = $2
    `,
    [folderId, groupId]
  );
  const result = await pool.query(
    'DELETE FROM group_folders WHERE id = $1 AND group_id = $2 RETURNING id',
    [folderId, groupId]
  );
  return (result.rowCount ?? 0) > 0;
}

// ── Messages ──

export async function listGroupConversationPreviews(userId: string, channelIds?: string[]) {
  if (channelIds && channelIds.length === 0) return [];
  const channelFilter = channelIds ? 'AND gm_messages.channel_id = ANY($2::uuid[])' : 'AND gm_messages.channel_id IS NOT NULL';
  const params = channelIds ? [userId, channelIds] : [userId];
  const messages = await pool.query<GroupMessageRecord & { unread_count: number }>(
    `
      WITH latest AS (
        SELECT DISTINCT ON (gm_messages.group_id)
          gm_messages.*
        FROM group_members gm
        JOIN group_messages gm_messages ON gm_messages.group_id = gm.group_id
        WHERE gm.user_id = $1
          ${channelFilter}
          AND gm_messages.deleted_at IS NULL
        ORDER BY gm_messages.group_id, gm_messages.created_at DESC, gm_messages.id DESC
      )
      SELECT latest.*, 0 AS unread_count
      FROM latest
      ORDER BY latest.created_at DESC, latest.id DESC
      LIMIT 50
    `,
    params
  );

  if (!messages.rows.length) return [];

  const groupIds = messages.rows.map((m) => m.group_id);
  const groupsResult = await pool.query<GroupRecord>('SELECT * FROM groups WHERE id = ANY($1::uuid[])', [groupIds]);
  const groupById = new Map(groupsResult.rows.map((g) => [g.id, g]));

  const previews: { group: GroupRecord; message: GroupMessageRecord; unreadCount: number }[] = [];

  for (const message of messages.rows) {
    const group = groupById.get(message.group_id);
    if (group) previews.push({ group, message, unreadCount: message.unread_count });
  }

  return previews.sort((a, b) => b.message.created_at.getTime() - a.message.created_at.getTime());
}

// Page size for a single channel fetch. The client loads the newest page first
// and pages backwards (older messages) as the user scrolls up.
export const GROUP_MESSAGE_PAGE_SIZE = 40;

export async function listGroupMessages(
  groupId: string,
  userId: string,
  channelId: string,
  options: { limit?: number; before?: string } = {}
): Promise<{ messages: GroupMessageRecord[]; hasMore: boolean }> {
  const member = await isGroupMember(groupId, userId);
  if (!member) return { messages: [], hasMore: false };

  const limit = options.limit ?? GROUP_MESSAGE_PAGE_SIZE;

  // Resolve the cursor message's timestamp for stable keyset pagination.
  let beforeCreatedAt: Date | null = null;
  if (options.before) {
    const cursor = await pool.query<{ created_at: Date }>(
      'SELECT created_at FROM group_messages WHERE id = $1',
      [options.before]
    );
    beforeCreatedAt = cursor.rows[0]?.created_at ?? null;
  }

  const params: unknown[] = [groupId, channelId];
  let cursorClause = '';
  if (beforeCreatedAt) {
    params.push(beforeCreatedAt, options.before);
    cursorClause = `AND (gm.created_at, gm.id) < ($${params.length - 1}, $${params.length})`;
  }
  // Fetch one extra row to detect whether an older page exists.
  params.push(limit + 1);
  const limitParam = `$${params.length}`;

  const result = await pool.query<GroupMessageRecord>(
    `
      SELECT gm.*,
        (
          SELECT COUNT(*)::int
          FROM group_message_views gmv
          WHERE gmv.message_id = COALESCE(gm.feed_source_id, gm.id)
        ) AS view_count,
        (
          SELECT COUNT(*)::int
          FROM group_messages tr
          WHERE tr.thread_root_id = gm.id AND tr.deleted_at IS NULL
        ) AS thread_count,
        (
          SELECT COUNT(*)::int
          FROM group_messages c
          JOIN group_messages mirror ON c.reply_to = mirror.id
          WHERE mirror.feed_source_id = gm.id AND c.deleted_at IS NULL
        ) AS comment_count
      FROM group_messages gm
      WHERE gm.group_id = $1
        AND gm.channel_id = $2
        AND gm.deleted_at IS NULL
        AND gm.thread_root_id IS NULL
        AND gm.scheduled_at IS NULL
        ${cursorClause}
      ORDER BY gm.created_at DESC, gm.id DESC
      LIMIT ${limitParam}
    `,
    params
  );

  const hasMore = result.rows.length > limit;
  const page = hasMore ? result.rows.slice(0, limit) : result.rows;
  // Return in chronological (ascending) order for rendering.
  return { messages: page.reverse(), hasMore };
}

export async function listGroupPinnedMessages(groupId: string, userId: string, channelId: string, limit = 50): Promise<GroupMessageRecord[]> {
  const member = await isGroupMember(groupId, userId);
  if (!member) return [];

  const result = await pool.query<GroupMessageRecord>(
    `
      SELECT gm.*,
        (
          SELECT COUNT(*)::int
          FROM group_message_views gmv
          WHERE gmv.message_id = COALESCE(gm.feed_source_id, gm.id)
        ) AS view_count
      FROM group_messages gm
      WHERE gm.group_id = $1
        AND gm.channel_id = $2
        AND gm.deleted_at IS NULL
        AND gm.pinned_at IS NOT NULL
      ORDER BY gm.pinned_at DESC, gm.created_at DESC
      LIMIT $3
    `,
    [groupId, channelId, Math.max(1, Math.min(limit, 100))]
  );

  return result.rows;
}

export async function listGroupMediaMessages(groupId: string, userId: string, channelId: string, limit = 300): Promise<GroupMessageRecord[]> {
  const member = await isGroupMember(groupId, userId);
  if (!member) return [];

  const result = await pool.query<GroupMessageRecord>(
    `
      SELECT gm.*,
        (
          SELECT COUNT(*)::int
          FROM group_message_views gmv
          WHERE gmv.message_id = COALESCE(gm.feed_source_id, gm.id)
        ) AS view_count
      FROM group_messages gm
      WHERE gm.group_id = $1
        AND gm.channel_id = $2
        AND gm.deleted_at IS NULL
        AND (
          gm.image_data IS NOT NULL
          OR jsonb_array_length(COALESCE(gm.media_items, '[]'::jsonb)) > 0
        )
      ORDER BY gm.created_at ASC, gm.id ASC
      LIMIT $3
    `,
    [groupId, channelId, Math.max(1, Math.min(limit, 500))]
  );

  return result.rows;
}

export async function markGroupMessagesViewed(messageIds: string[], userId: string): Promise<string[]> {
  const ids = [...new Set(messageIds.filter(Boolean))];
  if (ids.length === 0) return [];
  const result = await pool.query<{ message_id: string }>(
    `
      INSERT INTO group_message_views (message_id, user_id)
      SELECT id, $2
      FROM unnest($1::uuid[]) AS id
      ON CONFLICT DO NOTHING
      RETURNING message_id
    `,
    [ids, userId]
  );
  return result.rows.map((row) => row.message_id);
}

export async function createGroupMessage(
  senderId: string,
  groupId: string,
  channelId: string,
  body: string,
  image?: { dataUrl: string; name?: string; spoiler?: boolean },
  replyTo?: string | null,
  senderGroup?: { id: string; name: string; avatarData: string } | null,
  mediaItems?: Array<{ dataUrl: string; name?: string | null; spoiler?: boolean }>,
  feed?: { sourceId?: string | null; mirror?: boolean },
  threadRootId?: string | null,
  scheduledAt?: Date | null,
  ai?: { generated?: boolean; name?: string | null; avatarData?: string | null }
) {
  const member = await isGroupMember(groupId, senderId);
  if (!member) return null;

  const items = (mediaItems && mediaItems.length > 0 ? mediaItems : image ? [image] : [])
    .map((item) => ({ dataUrl: item.dataUrl, name: item.name ?? null, spoiler: Boolean(item.spoiler) }));
  const first = items[0];
  const result = await pool.query<GroupMessageRecord>(
    `
      INSERT INTO group_messages (
        id, group_id, channel_id, sender_id,
        sender_group_id, sender_group_name, sender_group_avatar_data,
        body, image_data, image_name, image_spoiler, media_items, reply_to, feed_source_id, feed_mirror, thread_root_id, scheduled_at,
        ai_generated, ai_name, ai_avatar_data
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15, $16, $17, $18, $19, $20)
      RETURNING *
    `,
    [
      randomUUID(),
      groupId,
      channelId,
      senderId,
      senderGroup?.id ?? null,
      senderGroup?.name ?? null,
      senderGroup?.avatarData ?? null,
      body,
      first?.dataUrl ?? null,
      first?.name ?? null,
      first?.spoiler ?? false,
      items.length > 0 ? JSON.stringify(items) : null,
      replyTo ?? null,
      feed?.sourceId ?? null,
      Boolean(feed?.mirror),
      threadRootId ?? null,
      scheduledAt ?? null,
      Boolean(ai?.generated),
      ai?.name ?? null,
      ai?.avatarData ?? null
    ]
  );

  return result.rows[0];
}

// ---- Scheduled feed posts ----
export async function listScheduledGroupPosts(groupId: string): Promise<GroupMessageRecord[]> {
  const result = await pool.query<GroupMessageRecord>(
    `
      SELECT * FROM group_messages
      WHERE group_id = $1 AND scheduled_at IS NOT NULL AND deleted_at IS NULL
      ORDER BY scheduled_at ASC
      LIMIT 100
    `,
    [groupId]
  );
  return result.rows;
}

export async function cancelScheduledGroupPost(messageId: string, groupId: string) {
  const result = await pool.query<GroupMessageRecord>(
    'DELETE FROM group_messages WHERE id = $1 AND group_id = $2 AND scheduled_at IS NOT NULL RETURNING *',
    [messageId, groupId]
  );
  return result.rows[0] ?? null;
}

// Releases due scheduled posts so they become live messages.
export async function sweepDueGroupPosts(): Promise<GroupMessageRecord[]> {
  const result = await pool.query<GroupMessageRecord>(
    `
      UPDATE group_messages
      SET scheduled_at = NULL, created_at = NOW()
      WHERE scheduled_at IS NOT NULL AND scheduled_at <= NOW() AND deleted_at IS NULL
      RETURNING *
    `
  );
  return result.rows;
}

// ---- Feed analytics for admins ----
export async function getFeedChannelStats(groupId: string, channelId: string) {
  const totals = await pool.query<{ posts: number; views: number; reactions: number; comments: number }>(
    `
      SELECT
        COUNT(*)::int AS posts,
        COALESCE(SUM((SELECT COUNT(*) FROM group_message_views v WHERE v.message_id = gm.id)), 0)::int AS views,
        COALESCE(SUM((SELECT COUNT(*) FROM group_message_reactions r WHERE r.message_id = gm.id)), 0)::int AS reactions,
        COALESCE(SUM((
          SELECT COUNT(*) FROM group_messages c
          JOIN group_messages mirror ON c.reply_to = mirror.id
          WHERE mirror.feed_source_id = gm.id AND c.deleted_at IS NULL
        )), 0)::int AS comments
      FROM group_messages gm
      WHERE gm.group_id = $1 AND gm.channel_id = $2 AND gm.deleted_at IS NULL AND gm.scheduled_at IS NULL
    `,
    [groupId, channelId]
  );
  const top = await pool.query<GroupMessageRecord & { views: number }>(
    `
      SELECT gm.*,
        (SELECT COUNT(*)::int FROM group_message_views v WHERE v.message_id = gm.id) AS views
      FROM group_messages gm
      WHERE gm.group_id = $1 AND gm.channel_id = $2 AND gm.deleted_at IS NULL AND gm.scheduled_at IS NULL
      ORDER BY views DESC, gm.created_at DESC
      LIMIT 5
    `,
    [groupId, channelId]
  );
  return { totals: totals.rows[0], top: top.rows };
}

// Who saw a specific post (admin-facing).
export async function listMessageViewers(messageId: string): Promise<UserRecord[]> {
  const result = await pool.query<UserRecord>(
    `
      SELECT ${liteUserColumns('users')}
      FROM group_message_views v
      JOIN users ON users.id = v.user_id
      WHERE v.message_id = $1
      ORDER BY v.created_at DESC
      LIMIT 200
    `,
    [messageId]
  );
  return result.rows;
}

// All replies of a thread, oldest first.
export async function listThreadMessages(groupId: string, rootId: string): Promise<GroupMessageRecord[]> {
  const result = await pool.query<GroupMessageRecord>(
    `
      SELECT gm.*
      FROM group_messages gm
      WHERE gm.group_id = $1
        AND gm.thread_root_id = $2
        AND gm.deleted_at IS NULL
      ORDER BY gm.created_at ASC, gm.id ASC
      LIMIT 500
    `,
    [groupId, rootId]
  );
  return result.rows;
}

export async function updateGroupMessage(
  messageId: string,
  senderId: string,
  body: string,
  mediaItems?: Array<{ dataUrl: string; name?: string | null; spoiler?: boolean }>
) {
  const items = mediaItems?.map((item) => ({ dataUrl: item.dataUrl, name: item.name ?? null, spoiler: Boolean(item.spoiler) }));
  const first = items?.[0];
  const result = await pool.query<GroupMessageRecord>(
    `
      UPDATE group_messages
      SET body = $1,
          image_data = CASE WHEN $4::jsonb IS NULL THEN image_data ELSE $5 END,
          image_name = CASE WHEN $4::jsonb IS NULL THEN image_name ELSE $6 END,
          image_spoiler = CASE WHEN $4::jsonb IS NULL THEN image_spoiler ELSE $7 END,
          media_items = CASE WHEN $4::jsonb IS NULL THEN media_items ELSE $4::jsonb END,
          edited_at = NOW()
      WHERE id = $2 AND sender_id = $3 AND deleted_at IS NULL
        AND created_at > NOW() - INTERVAL '10 minutes'
      RETURNING *
    `,
    [body, messageId, senderId, items ? JSON.stringify(items) : null, first?.dataUrl ?? null, first?.name ?? null, first?.spoiler ?? false]
  );

  return result.rows[0] ?? null;
}

export function toPublicGroupRole(role: GroupRoleRecord): PublicGroupRole {
  return {
    id: role.id,
    groupId: role.group_id,
    name: role.name,
    color: role.color,
    position: role.position,
    isOwner: role.is_owner,
    permissions: role.permissions ?? [],
    hoist: role.hoist ?? false
  };
}

export function toPublicGroupChannel(channel: GroupChannelRecord, requiredRoleIds: string[] = []): PublicGroupChannel {
  return {
    id: channel.id,
    groupId: channel.group_id,
    name: channel.name,
    position: channel.position,
    folderId: channel.folder_id,
    type: channel.type === 'voice' ? 'voice' : channel.type === 'feed' ? 'feed' : 'text',
    userLimit: channel.user_limit ?? null,
    topic: channel.topic ?? '',
    slowmodeSeconds: channel.slowmode_seconds ?? 0,
    nsfw: channel.nsfw ?? false,
    bitrate: channel.bitrate ?? 64000,
    feedChatChannelId: channel.feed_chat_channel_id ?? null,
    feedParentChannelId: channel.feed_parent_channel_id ?? null,
    signPosts: Boolean(channel.sign_posts),
    requiredRoleIds,
    settings: parseChannelSettings(channel.settings)
  };
}

export function toPublicGroupFolder(folder: GroupFolderRecord): PublicGroupFolder {
  return {
    id: folder.id,
    groupId: folder.group_id,
    name: folder.name,
    position: folder.position,
    requiredRoleId: folder.required_role_id ?? null
  };
}

export async function deleteGroupMessage(messageId: string, senderId: string) {
  const result = await pool.query<GroupMessageRecord>(
    `
      UPDATE group_messages
      SET body = '', image_data = NULL, image_name = NULL, image_spoiler = FALSE, media_items = NULL, deleted_at = NOW()
      WHERE id = $1 AND sender_id = $2 AND deleted_at IS NULL
      RETURNING *
    `,
    [messageId, senderId]
  );

  return result.rows[0] ?? null;
}

// Toggle pin state on a group message. Permission checks happen in the route.
export async function setGroupMessagePin(messageId: string, pinned: boolean) {
  const result = await pool.query<GroupMessageRecord>(
    `
      UPDATE group_messages
      SET pinned_at = ${pinned ? 'NOW()' : 'NULL'}
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING *
    `,
    [messageId]
  );
  return result.rows[0] ?? null;
}

// ---- Reaction roles ----
export type ReactionRoleBinding = { emoji: string; roleId: string };

export async function listMessageReactionRoles(messageId: string): Promise<ReactionRoleBinding[]> {
  const result = await pool.query<{ emoji: string; role_id: string }>(
    'SELECT emoji, role_id FROM group_reaction_roles WHERE message_id = $1 ORDER BY created_at ASC',
    [messageId]
  );
  return result.rows.map((row) => ({ emoji: row.emoji, roleId: row.role_id }));
}

// Replace-all semantics keep the admin dialog dead simple: what you see in
// the list is exactly what is stored.
export async function setMessageReactionRoles(messageId: string, groupId: string, bindings: ReactionRoleBinding[]) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM group_reaction_roles WHERE message_id = $1', [messageId]);
    for (const binding of bindings) {
      await client.query(
        'INSERT INTO group_reaction_roles (message_id, group_id, emoji, role_id) VALUES ($1, $2, $3, $4) ON CONFLICT (message_id, emoji) DO UPDATE SET role_id = EXCLUDED.role_id',
        [messageId, groupId, binding.emoji, binding.roleId]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function findReactionRole(messageId: string, emoji: string): Promise<{ roleId: string } | null> {
  const result = await pool.query<{ role_id: string }>(
    'SELECT role_id FROM group_reaction_roles WHERE message_id = $1 AND emoji = $2',
    [messageId, emoji]
  );
  return result.rows[0] ? { roleId: result.rows[0].role_id } : null;
}

// ---- Audit log ----
export async function logGroupAction(
  groupId: string,
  actorId: string | null,
  action: string,
  target = '',
  details: Record<string, unknown> = {}
) {
  try {
    await pool.query(
      'INSERT INTO group_audit_log (id, group_id, actor_id, action, target, details) VALUES ($1, $2, $3, $4, $5, $6::jsonb)',
      [randomUUID(), groupId, actorId, action, target.slice(0, 200), JSON.stringify(details)]
    );
  } catch (error) {
    console.error('Audit log write failed', error);
  }
}

export type AuditEntryRecord = {
  id: string;
  group_id: string;
  actor_id: string | null;
  action: string;
  target: string;
  details: Record<string, unknown>;
  created_at: Date;
};

export async function listGroupAudit(groupId: string, limit = 100): Promise<AuditEntryRecord[]> {
  const result = await pool.query<AuditEntryRecord>(
    'SELECT * FROM group_audit_log WHERE group_id = $1 ORDER BY created_at DESC LIMIT $2',
    [groupId, Math.min(limit, 200)]
  );
  return result.rows;
}
