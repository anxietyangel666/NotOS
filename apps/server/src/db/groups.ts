import { randomUUID } from 'node:crypto';
import { pool } from './pool.js';
import { type NamePlate, type UserRecord } from './users.js';

export type GroupRecord = {
  id: string;
  name: string;
  avatar_data: string;
  owner_id: string;
  invite_code: string;
  nameplate: NamePlate | null;
  description: string;
  created_at: Date;
};

export type GroupMemberRecord = {
  group_id: string;
  user_id: string;
  role: string;
  role_id: string | null;
  joined_at: Date;
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
  created_at: Date;
};

export type GroupFolderRecord = {
  id: string;
  group_id: string;
  name: string;
  position: number;
  created_at: Date;
};

export type GroupMessageRecord = {
  id: string;
  group_id: string;
  channel_id: string | null;
  sender_id: string;
  body: string;
  image_data: string | null;
  image_name: string | null;
  image_spoiler: boolean;
  edited_at: Date | null;
  deleted_at: Date | null;
  pinned_at: Date | null;
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
  createdAt: string;
};

export type PublicGroupMember = {
  user: UserRecord;
  role: string;
  roleId: string | null;
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
  type: 'text' | 'voice';
  userLimit: number | null;
};

export type PublicGroupFolder = {
  id: string;
  groupId: string;
  name: string;
  position: number;
};

export type PublicGroupMessage = {
  id: string;
  groupId: string;
  channelId: string | null;
  senderId: string;
  body: string;
  imageData: string | null;
  imageName: string | null;
  imageSpoiler: boolean;
  editedAt: string | null;
  deletedAt: string | null;
  pinnedAt: string | null;
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
    createdAt: group.created_at.toISOString()
  };
}

export function toPublicGroupMessage(message: GroupMessageRecord): PublicGroupMessage {
  return {
    id: message.id,
    groupId: message.group_id,
    channelId: message.channel_id,
    senderId: message.sender_id,
    body: message.deleted_at ? '' : message.body,
    imageData: message.deleted_at ? null : message.image_data,
    imageName: message.deleted_at ? null : message.image_name,
    imageSpoiler: message.deleted_at ? false : message.image_spoiler,
    editedAt: message.edited_at?.toISOString() ?? null,
    deletedAt: message.deleted_at?.toISOString() ?? null,
    pinnedAt: message.deleted_at ? null : (message.pinned_at?.toISOString() ?? null),
    createdAt: message.created_at.toISOString()
  };
}

function generateInviteCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let code = '';
  for (let i = 0; i < 12; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return `gc_${code}`;
}

export async function createGroup(ownerId: string, name: string, avatarData: string) {
  const id = randomUUID();
  const inviteCode = generateInviteCode();
  const ownerRoleId = randomUUID();
  const generalChannelId = randomUUID();

  const result = await pool.query<GroupRecord>(
    `
      INSERT INTO groups (id, name, avatar_data, owner_id, invite_code)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `,
    [id, name, avatarData, ownerId, inviteCode]
  );

  await pool.query(
    `
      INSERT INTO group_roles (id, group_id, name, color, position, is_owner, permissions)
      VALUES ($1, $2, 'Owner', '#ffd700', 0, TRUE, $3)
    `,
    [ownerRoleId, id, JSON.stringify(['ManageRoles', 'DeleteAnyMessage', 'ManageChannels', 'ManageInvites', 'KickMembers'])]
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
  userId: string,
  updates: { name?: string; avatarData?: string; nameplate?: NamePlate | null; description?: string }
) {
  const member = await pool.query(
    "SELECT gm.role_id, COALESCE(gr.is_owner, FALSE) AS is_owner FROM group_members gm LEFT JOIN group_roles gr ON gr.id = gm.role_id WHERE gm.group_id = $1 AND gm.user_id = $2",
    [groupId, userId]
  );
  if (!member.rows[0]?.is_owner) return null;

  const setClauses: string[] = [];
  const values: unknown[] = [];
  let paramIdx = 1;

  if (updates.name !== undefined) {
    setClauses.push(`name = $${paramIdx++}`);
    values.push(updates.name);
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
  const result = await pool.query<GroupRoleRecord>(
    'SELECT id FROM group_roles WHERE group_id = $1 AND NOT is_owner ORDER BY position ASC LIMIT 1',
    [groupId]
  );
  return result.rows[0]?.id ?? null;
}

export async function removeGroupMember(groupId: string, userId: string, requesterId: string) {
  const requester = await pool.query(
    "SELECT COALESCE(gr.is_owner, FALSE) AS is_owner, gr.permissions FROM group_members gm LEFT JOIN group_roles gr ON gr.id = gm.role_id WHERE gm.group_id = $1 AND gm.user_id = $2",
    [groupId, requesterId]
  );
  if (!requester.rows[0]) return false;

  const canKick = requester.rows[0].is_owner || requester.rows[0].permissions?.includes('KickMembers');

  if (canKick || requesterId === userId) {
    const result = await pool.query(
      "DELETE FROM group_members WHERE group_id = $1 AND user_id = $2 RETURNING user_id",
      [groupId, userId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  return false;
}

export async function listGroupMembers(groupId: string) {
  const result = await pool.query<GroupMemberRecord & UserRecord & { role_color: string; role_position: number }>(
    `
      SELECT users.*, gm.user_id, gm.role, gm.role_id, gm.joined_at,
        COALESCE(gr.color, '#8a8a8a') AS role_color,
        COALESCE(gr.position, 999) AS role_position
      FROM group_members gm
      JOIN users ON users.id = gm.user_id
      LEFT JOIN group_roles gr ON gr.id = gm.role_id
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
  const result = await pool.query<GroupRecord>('SELECT * FROM groups WHERE invite_code = $1', [inviteCode]);
  return result.rows[0] ?? null;
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
  if (defaultRole) {
    await pool.query(
      'UPDATE group_members SET role_id = $1, role = (SELECT name FROM group_roles WHERE id = $1) WHERE role_id = $2',
      [defaultRole, roleId]
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

export async function createGroupChannel(groupId: string, name: string, type: 'text' | 'voice' = 'text') {
  const maxPos = await pool.query(
    'SELECT COALESCE(MAX(position), -1) + 1 AS next_pos FROM group_channels WHERE group_id = $1',
    [groupId]
  );
  const position = maxPos.rows[0]?.next_pos ?? 0;
  const result = await pool.query<GroupChannelRecord>(
    `
      INSERT INTO group_channels (id, group_id, name, position, type)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `,
    [randomUUID(), groupId, name, position, type]
  );
  return result.rows[0];
}

export async function deleteGroupChannel(channelId: string, groupId: string) {
  const result = await pool.query(
    "DELETE FROM group_channels WHERE id = $1 AND group_id = $2 AND name <> 'general' RETURNING id",
    [channelId, groupId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function updateGroupChannel(
  channelId: string,
  groupId: string,
  updates: { name?: string; position?: number; folderId?: string | null; userLimit?: number | null }
) {
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let paramIdx = 1;

  if (updates.name !== undefined) { setClauses.push(`name = $${paramIdx++}`); values.push(updates.name); }
  if (updates.position !== undefined) { setClauses.push(`position = $${paramIdx++}`); values.push(updates.position); }
  if (updates.folderId !== undefined) { setClauses.push(`folder_id = $${paramIdx++}`); values.push(updates.folderId); }
  if (updates.userLimit !== undefined) { setClauses.push(`user_limit = $${paramIdx++}`); values.push(updates.userLimit); }

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
      for (const item of items) {
        await client.query(
          'UPDATE group_channels SET position = $1, folder_id = $2 WHERE id = $3 AND group_id = $4',
          [item.position, item.folderId, item.id, groupId]
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
  await pool.query('UPDATE group_channels SET folder_id = NULL WHERE folder_id = $1 AND group_id = $2', [folderId, groupId]);
  const result = await pool.query(
    'DELETE FROM group_folders WHERE id = $1 AND group_id = $2 RETURNING id',
    [folderId, groupId]
  );
  return (result.rowCount ?? 0) > 0;
}

// ── Messages ──

export async function listGroupConversationPreviews(userId: string) {
  const messages = await pool.query<GroupMessageRecord & { unread_count: number }>(
    `
      WITH latest AS (
        SELECT DISTINCT ON (gm.group_id)
          gm.group_id, gm_messages.*
        FROM group_members gm
        JOIN group_messages gm_messages ON gm_messages.id = (
          SELECT m2.id FROM group_messages m2
          WHERE m2.group_id = gm.group_id
          ORDER BY m2.created_at DESC
          LIMIT 1
        )
        WHERE gm.user_id = $1
        ORDER BY gm.group_id, gm_messages.created_at DESC
      )
      SELECT latest.*, 0 AS unread_count
      FROM latest
      ORDER BY latest.created_at DESC
      LIMIT 50
    `,
    [userId]
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

export async function listGroupMessages(groupId: string, userId: string, channelId?: string) {
  const member = await isGroupMember(groupId, userId);
  if (!member) return [];

  if (channelId) {
    const result = await pool.query<GroupMessageRecord>(
      `
        SELECT * FROM group_messages
        WHERE group_id = $1 AND channel_id = $2
        ORDER BY created_at ASC
        LIMIT 200
      `,
      [groupId, channelId]
    );
    return result.rows;
  }

  const result = await pool.query<GroupMessageRecord>(
    `
      SELECT * FROM group_messages
      WHERE group_id = $1
      ORDER BY created_at ASC
      LIMIT 200
    `,
    [groupId]
  );
  return result.rows;
}

export async function createGroupMessage(senderId: string, groupId: string, channelId: string | null, body: string, image?: { dataUrl: string; name?: string; spoiler?: boolean }) {
  const member = await isGroupMember(groupId, senderId);
  if (!member) return null;

  const result = await pool.query<GroupMessageRecord>(
    `
      INSERT INTO group_messages (id, group_id, channel_id, sender_id, body, image_data, image_name, image_spoiler)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `,
    [randomUUID(), groupId, channelId, senderId, body, image?.dataUrl ?? null, image?.name ?? null, image?.spoiler ?? false]
  );

  return result.rows[0];
}

export async function updateGroupMessage(messageId: string, senderId: string, body: string) {
  const result = await pool.query<GroupMessageRecord>(
    `
      UPDATE group_messages
      SET body = $1, edited_at = NOW()
      WHERE id = $2 AND sender_id = $3 AND deleted_at IS NULL
        AND created_at > NOW() - INTERVAL '10 minutes'
      RETURNING *
    `,
    [body, messageId, senderId]
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

export function toPublicGroupChannel(channel: GroupChannelRecord): PublicGroupChannel {
  return {
    id: channel.id,
    groupId: channel.group_id,
    name: channel.name,
    position: channel.position,
    folderId: channel.folder_id,
    type: channel.type === 'voice' ? 'voice' : 'text',
    userLimit: channel.user_limit ?? null
  };
}

export function toPublicGroupFolder(folder: GroupFolderRecord): PublicGroupFolder {
  return {
    id: folder.id,
    groupId: folder.group_id,
    name: folder.name,
    position: folder.position
  };
}

export async function deleteGroupMessage(messageId: string, senderId: string) {
  const result = await pool.query<GroupMessageRecord>(
    `
      UPDATE group_messages
      SET body = '', image_data = NULL, image_name = NULL, image_spoiler = FALSE, deleted_at = NOW()
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
