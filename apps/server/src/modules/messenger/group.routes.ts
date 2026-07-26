import { Router } from 'express';
import type { Server } from 'socket.io';
import { z } from 'zod';
import { chatImageSchema, chatMediaItemsSchema } from './media.js';
import { getLinkPreviewForBody } from './link-preview.js';
import { callGroq } from '../ai/groq.js';
import { transcribeAudioDataUrl } from '../ai/transcribe.js';
import { consumeAiQuota } from '../../db/ai-quota.js';
import { config } from '../../config.js';
import { pool } from '../../db/pool.js';
import {
  createGroup,
  getUserGroups,
  getGroupById,
  updateGroup,
  deleteGroup,
  addGroupMember,
  removeGroupMember,
  listGroupMembers,
  listGroupMemberIds,
  isGroupMember,
  getGroupByInviteCode,
  getGroupInviteByCode,
  listGroupInvites,
  createGroupInvite,
  deleteGroupInvite,
  incrementGroupInviteUse,
  listGroupConversationPreviews,
  listGroupMessages,
  listThreadMessages,
  listGroupPinnedMessages,
  listGroupMediaMessages,
  markGroupMessagesViewed,
  createGroupMessage,
  updateGroupMessage,
  setGroupMessagePin,
  toggleGroupMessageReaction,
  toPublicGroupMessagesWithReactions,
  toPublicGroupMessageEnriched,
  toPublicGroup,
  toPublicGroupMessage,
  toPublicGroupRole,
  toPublicGroupChannel,
  toPublicGroupFolder,
  listGroupRoles,
  createGroupRole,
  deleteGroupRole,
  updateGroupRole,
  updateGroupEveryonePermissions,
  setGroupDefaultRole,
  listGroupChannels,
  getGroupChannelById,
  createGroupChannel,
  createGroupFeed,
  deleteGroupChannel,
  updateGroupChannel,
  reorderGroupChannels,
  listGroupFolders,
  createGroupFolder,
  updateGroupFolder,
  deleteGroupFolder,
  listChannelPermissionOverrides,
  replaceChannelPermissionOverrides
} from '../../db/groups.js';
import type { GroupMessageRecord, PublicGroupMessage } from '../../db/groups.js';
import {
  listCustomCategories,
  createCustomCategory,
  updateCustomCategory,
  deleteCustomCategory,
  createCustomOption,
  updateCustomOption,
  deleteCustomOption,
  toggleCustomOption,
  attachRole,
  detachRole,
  getSelectedOptionIds,
  getMemberRoleIds,
  getChannelRoleGates,
  getFolderRoleGates,
  setChannelRoleGates,
  needsOnboarding,
  markOnboardingComplete
} from '../../db/customization.js';
import { findUserById, toPublicUser, toPublicUserLite } from '../../db/users.js';
import { asyncHandler } from '../../http/async-handler.js';
import { HttpError } from '../../http/errors.js';
import { type AuthenticatedRequest, requireAuth } from '../../middleware/require-auth.js';
import { extractMentionTokens, mentionedUserIdsFromBody, mentionToken } from './mentions.js';

const createGroupSchema = z.object({
  name: z.string().trim().min(1).max(100),
  avatarData: z.string().max(1_000_000).optional()
});

const updateGroupSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  avatarData: z.string().max(1_000_000).optional(),
  description: z.string().trim().max(200).optional(),
  nameplate: z
    .object({
      type: z.enum(['none', 'color', 'gradient', 'image']),
      color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
      gradientFrom: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
      gradientTo: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
      image: z
        .string()
        .max(8_000_000)
        .refine((value) => value === '' || value.startsWith('data:image/'), {
          message: 'Nameplate image must be an image data URL'
        })
    })
    .nullable()
    .optional()
});

// Owner-tier permission set, granted to the group creator and the Owner role.
const OWNER_PERMISSIONS = [
  'ManageRoles', 'DeleteAnyMessage', 'ManageChannels', 'ManageInvites', 'KickMembers',
  'MentionEveryone', 'ViewChannel', 'ManageChannel', 'ManagePermissions', 'ManageWebhooks',
  'CreateInvite', 'SendMessages', 'AttachFiles', 'AddReactions', 'UseExternalEmojis',
  'ManageMessages', 'PinMessages', 'BypassSlowmode', 'ReadMessageHistory',
  'SendVoiceMessages', 'SendVideoCircles', 'CreatePolls'
];
const FEED_PUBLISH_PERMISSIONS = ['ManageRoles', 'DeleteAnyMessage', 'ManageChannels', 'ManageInvites', 'KickMembers', 'ManageMessages'];

const CUSTOM_EMOJI_TOKEN_RE = /<ce:[^:>]+:(?:https?:\/\/|data:image\/(?:png|gif|jpe?g|webp);base64,)[^\s<>]+>/i;

function isVoiceMessageMedia(media: { dataUrl: string; name?: string | null } | null | undefined) {
  return Boolean(media && (media.dataUrl.startsWith('data:audio/') || media.name?.startsWith('voice-message-')));
}

function isVideoCircleMedia(media: { dataUrl: string; name?: string | null } | null | undefined) {
  return Boolean(media && (media.dataUrl.startsWith('data:video/') || media.name?.startsWith('video-circle-')));
}

async function getMemberPermissions(groupId: string, userId: string) {
  const result = await pool.query<{
    owner_id: string;
    everyone_permissions: string[];
    role: string;
    role_id: string | null;
    role_ids: string[] | null;
  }>(
    `
      SELECT
        g.owner_id,
        g.everyone_permissions,
        gm.role,
        gm.role_id,
        extra_roles.role_ids
      FROM group_members gm
      JOIN groups g ON g.id = gm.group_id
      LEFT JOIN LATERAL (
        SELECT array_agg(DISTINCT role_id) AS role_ids
        FROM group_member_roles
        WHERE group_id = gm.group_id
          AND user_id = gm.user_id
      ) extra_roles ON TRUE
      WHERE gm.group_id = $1
        AND gm.user_id = $2
      LIMIT 1
    `,
    [groupId, userId]
  );
  const member = result.rows[0];
  if (!member) return null;
  // The group creator is always an owner/admin, even if they hold no role or a
  // non-admin custom role.
  if (member.owner_id === userId) return { isOwner: true, permissions: OWNER_PERMISSIONS };
  if (member.role === 'Owner') return { isOwner: true, permissions: OWNER_PERMISSIONS };
  const basePermissions = new Set<string>(member.everyone_permissions ?? []);
  const roleIds = Array.from(new Set((member.role_ids?.length ? member.role_ids : member.role_id ? [member.role_id] : []).filter(Boolean)));
  if (roleIds.length === 0) return { isOwner: false, permissions: [...basePermissions] };
  const roleRows = await pool.query<{ is_owner: boolean; permissions: string[] }>(
    'SELECT gr.is_owner, gr.permissions FROM group_roles gr WHERE gr.group_id = $1 AND gr.id = ANY($2::uuid[])',
    [groupId, roleIds]
  );
  const permissions = new Set<string>(basePermissions);
  for (const row of roleRows.rows) {
    for (const permission of row.permissions ?? []) permissions.add(permission);
  }
  return { isOwner: roleRows.rows.some((row) => row.is_owner), permissions: [...permissions] };
}

// Shared mapper so every endpoint returns members with the same shape,
// including the full role list (primary + customization roles).
function mapMember(m: Awaited<ReturnType<typeof listGroupMembers>>[number]) {
  // The query's `m.role` is the group role; pass the global account role to
  // toPublicUser so account-level badges (e.g. the 'dev' badge) still render.
  // Lite user: the member list only needs identity, avatar and name/nameplate
  // styling. Dropping the heavy wallpaper/pinned base64 keeps a big group's
  // member payload small. The full profile is fetched when a card is opened.
  return {
    user: toPublicUserLite({ ...m, role: m.account_role ?? m.role }),
    role: m.role,
    roleId: m.role_id,
    roleIds: m.role_ids ?? [],
    joinedAt: m.joined_at.toISOString()
  };
}

async function mapInvite(invite: Awaited<ReturnType<typeof listGroupInvites>>[number]) {
  const creator = await findUserById(invite.creator_id);
  return {
    id: invite.id,
    groupId: invite.group_id,
    channelId: invite.channel_id,
    code: invite.code,
    creator: creator ? toPublicUserLite(creator) : null,
    usesCount: invite.uses_count,
    createdAt: invite.created_at.toISOString()
  };
}

function mapChannelPermissionOverride(row: Awaited<ReturnType<typeof listChannelPermissionOverrides>>[number]) {
  return {
    channelId: row.channel_id,
    roleId: row.target_id,
    permission: row.permission,
    value: row.value
  };
}

function toCompactGroup(group: Parameters<typeof toPublicGroup>[0]) {
  return toPublicGroup(group);
}

// Returns channels visible to a member: public channels plus role-gated ones
// the member can access. Staff (owner / ManageChannels) always see everything
// so they can manage hidden channels.
export async function visibleChannels(groupId: string, userId: string) {
  const [channels, gates, perms, permissionRows] = await Promise.all([
    listGroupChannels(groupId),
    getChannelRoleGates(groupId),
    getMemberPermissions(groupId, userId),
    pool.query<{ channel_id: string; target_id: string; value: 'allow' | 'deny' }>(
      `
        SELECT gcpo.channel_id, gcpo.target_id, gcpo.value
        FROM group_channel_permission_overrides gcpo
        JOIN group_channels gc ON gc.id = gcpo.channel_id
        WHERE gc.group_id = $1 AND gcpo.permission = 'ViewChannel'
      `,
      [groupId]
    )
  ]);
  const isStaff = Boolean(perms?.isOwner || perms?.permissions?.includes('ManageChannels'));
  const memberRoles = isStaff ? null : await getMemberRoleIds(groupId, userId);
  const viewOverrides = new Map<string, { allow: Set<string>; deny: Set<string> }>();
  for (const row of permissionRows.rows) {
    const entry = viewOverrides.get(row.channel_id) ?? { allow: new Set<string>(), deny: new Set<string>() };
    entry[row.value].add(row.target_id);
    viewOverrides.set(row.channel_id, entry);
  }

  return channels
    .filter((channel) => {
      const override = viewOverrides.get(channel.id);
      if (!isStaff && override) {
        for (const roleId of override.deny) if (roleId !== '@everyone' && memberRoles!.has(roleId)) return false;
        for (const roleId of override.allow) if (roleId !== '@everyone' && memberRoles!.has(roleId)) return true;
        if (override.deny.has('@everyone')) return false;
        if (override.allow.size > 0 && !override.allow.has('@everyone')) return false;
      }
      const required = gates.get(channel.id);
      if (!required || required.size === 0) return true;
      if (isStaff) return true;
      for (const roleId of required) if (memberRoles!.has(roleId)) return true;
      return false;
    })
    .map((channel) => toPublicGroupChannel(channel, Array.from(gates.get(channel.id) ?? [])));
}

export async function visibleGroupConversationPreviews(userId: string) {
  const groups = await getUserGroups(userId);
  const channelIds: string[] = [];
  for (const group of groups) {
    const visible = await visibleChannels(group.id, userId);
    for (const channel of visible) {
      if (channel.type === 'text' || channel.type === 'feed') channelIds.push(channel.id);
    }
  }
  return listGroupConversationPreviews(userId, channelIds);
}

async function visibleMemberIdsForChannel(groupId: string, channelId: string) {
  const memberIds = await listGroupMemberIds(groupId);
  const checks = await Promise.all(memberIds.map(async (userId) => {
    const visible = await visibleChannels(groupId, userId);
    return visible.some((channel) => channel.id === channelId) ? userId : null;
  }));
  return checks.filter((userId): userId is string => Boolean(userId));
}

async function validateGroupReplyTarget(groupId: string, channelId: string, replyTo: string | undefined) {
  if (!replyTo) return;
  const result = await pool.query<{ id: string }>(
    `SELECT id FROM group_messages WHERE id = $1 AND group_id = $2 AND deleted_at IS NULL`,
    [replyTo, groupId]
  );
  if (!result.rows[0]) throw new HttpError(400, 'Invalid reply target', 'INVALID_REPLY_TARGET');
}

// Returns folders visible to a member, honouring required_role_id on hidden
// (auto-created) folders. Staff always see everything.
async function visibleFolders(groupId: string, userId: string) {
  const [folders, gates, perms] = await Promise.all([
    listGroupFolders(groupId),
    getFolderRoleGates(groupId),
    getMemberPermissions(groupId, userId)
  ]);
  const isStaff = Boolean(perms?.isOwner || perms?.permissions?.includes('ManageChannels'));
  const memberRoles = isStaff ? null : await getMemberRoleIds(groupId, userId);

  return folders
    .filter((folder) => {
      const required = gates.get(folder.id);
      if (!required) return true;
      if (isStaff) return true;
      return memberRoles!.has(required);
    })
    .map(toPublicGroupFolder);
}

function channelPermissionAlias(permission: string) {
  if (permission === 'ManageChannel') return ['ManageChannels'];
  if (permission === 'ManagePermissions') return ['ManageRoles', 'ManageChannels'];
  if (permission === 'CreateInvite') return ['ManageInvites'];
  if (permission === 'ManageMessages') return ['DeleteAnyMessage'];
  return [];
}

async function getChannelPermissionSet(groupId: string, channelId: string, userId: string) {
  const [memberPerms, roleIds, overrides] = await Promise.all([
    getMemberPermissions(groupId, userId),
    getMemberRoleIds(groupId, userId),
    listChannelPermissionOverrides(channelId)
  ]);
  if (!memberPerms) return null;
  if (memberPerms.isOwner) return { isOwner: true, permissions: new Set(OWNER_PERMISSIONS) };

  const permissions = new Set<string>();
  for (const permission of memberPerms.permissions ?? []) permissions.add(permission);

  for (const override of overrides) {
    if (override.target_id !== '@everyone') continue;
    if (override.value === 'allow') permissions.add(override.permission);
    else permissions.delete(override.permission);
  }

  const roleAllow = new Set<string>();
  const roleDeny = new Set<string>();
  for (const override of overrides) {
    if (override.target_id === '@everyone' || !roleIds.has(override.target_id)) continue;
    if (override.value === 'allow') roleAllow.add(override.permission);
    else roleDeny.add(override.permission);
  }
  for (const permission of roleAllow) {
    if (!roleDeny.has(permission)) permissions.add(permission);
  }
  for (const permission of roleDeny) permissions.delete(permission);

  return { isOwner: false, permissions };
}

function hasChannelPermission(
  effective: Awaited<ReturnType<typeof getChannelPermissionSet>>,
  permission: string
) {
  if (!effective) return false;
  if (effective.isOwner) return true;
  if (effective.permissions.has(permission)) return true;
  return channelPermissionAlias(permission).some((alias) => effective.permissions.has(alias));
}

async function requireChannelPermission(groupId: string, channelId: string, userId: string, permission: string, code: string) {
  const channel = await getGroupChannelById(channelId);
  if (!channel || channel.group_id !== groupId) throw new HttpError(404, 'Channel not found', 'CHANNEL_NOT_FOUND');
  if (permission === 'ViewChannel') {
    const visible = await visibleChannels(groupId, userId);
    if (!visible.some((item) => item.id === channelId)) throw new HttpError(403, 'Missing channel permission', code);
  }
  const effective = await getChannelPermissionSet(groupId, channelId, userId);
  if (!hasChannelPermission(effective, permission)) throw new HttpError(403, 'Missing channel permission', code);
  return { channel, effective };
}

const groupMessageSchema = z.object({
  body: z.preprocess((value) => (typeof value === 'string' ? value : ''), z.string().trim().max(2000)),
  channelId: z.string().uuid(),
  image: z.preprocess((value) => (value === null ? undefined : value), chatImageSchema.optional()),
  mediaItems: z.preprocess((value) => (value === null ? undefined : value), chatMediaItemsSchema.optional()),
  replyTo: z.string().uuid().optional(),
  senderGroupId: z.string().uuid().optional()
}).refine((value) => value.body.length > 0 || Boolean(value.image) || Boolean(value.mediaItems?.length), {
  message: 'Message body or image is required'
});

const editGroupMessageSchema = z.object({
  body: z.preprocess((value) => (typeof value === 'string' ? value : ''), z.string().trim().max(2000)),
  mediaItems: z.preprocess((value) => (value === null ? undefined : value), chatMediaItemsSchema.optional())
}).refine((value) => value.body.length > 0 || Boolean(value.mediaItems?.length), {
  message: 'Message body or media is required'
});

// A reaction emoji is either a short unicode emoji or a custom-emoji token
// (e.g. ":name~https://.../emoji.png:"), so cap the length generously.
const reactionSchema = z.object({
  emoji: z.string().trim().min(1).max(4096)
});

export function createGroupRouter(io: Server) {
  const router = Router();

  async function feedLinkedMessageRows(groupId: string, canonicalMessageId: string) {
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
          AND (gm.id = $2 OR gm.feed_source_id = $2)
        ORDER BY gm.created_at ASC
      `,
      [groupId, canonicalMessageId]
    );
    return result.rows;
  }

  async function emitGroupMessageToVisibleMembers(eventName: 'messenger:groupMessageUpdated' | 'messenger:groupMessageDeleted', message: PublicGroupMessage) {
    if (!message.channelId) return;
    const memberIds = await visibleMemberIdsForChannel(message.groupId, message.channelId);
    for (const id of memberIds) io.to(id).emit(eventName, { message });
  }

  async function emitFeedLinkedMessages(eventName: 'messenger:groupMessageUpdated' | 'messenger:groupMessageDeleted', groupId: string, canonicalMessageId: string) {
    const rows = await feedLinkedMessageRows(groupId, canonicalMessageId);
    const messages = await toPublicGroupMessagesWithReactions(rows);
    for (const message of messages) await emitGroupMessageToVisibleMembers(eventName, message);
    return messages;
  }

  router.get(
    '/groups',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const groups = await getUserGroups(req.auth.userId);
      res.json({ groups: groups.map(toPublicGroup) });
    })
  );

  router.post(
    '/groups',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const input = createGroupSchema.parse(req.body);
      const group = toPublicGroup(await createGroup(req.auth.userId, input.name, input.avatarData ?? ''));
      io.to(req.auth.userId).emit('messenger:groupCreated', { group });
      res.json({ group });
    })
  );

  router.get(
    '/groups/conversations',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const raw = await visibleGroupConversationPreviews(req.auth.userId);
      res.json({
        conversations: raw.map((p) => ({
          group: toCompactGroup(p.group),
          message: toPublicGroupMessage(p.message),
          unreadCount: p.unreadCount
        }))
      });
    })
  );

  router.get(
    '/groups/:groupId',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const groupId = z.string().uuid().parse(req.params.groupId);
      const group = await getGroupById(groupId);

      if (!group) throw new HttpError(404, 'Group not found', 'GROUP_NOT_FOUND');
      if (!(await isGroupMember(groupId, req.auth.userId))) throw new HttpError(403, 'Not a member', 'NOT_GROUP_MEMBER');

      res.json({ group: toPublicGroup(group) });
    })
  );

  router.get(
    '/groups/:groupId/public-profile',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const groupId = z.string().uuid().parse(req.params.groupId);
      const preview = await pool.query(
        `
          SELECT
            groups.*,
            COUNT(group_members.user_id)::int AS member_count,
            EXISTS (
              SELECT 1
              FROM group_members self_member
              WHERE self_member.group_id = groups.id AND self_member.user_id = $2
            ) AS is_member
          FROM groups
          LEFT JOIN group_members ON group_members.group_id = groups.id
          WHERE groups.id = $1
          GROUP BY groups.id
          LIMIT 1
        `,
        [groupId, req.auth.userId]
      );
      const group = preview.rows[0];
      if (!group) throw new HttpError(404, 'Group not found', 'GROUP_NOT_FOUND');
      res.json({
        group: toCompactGroup(group),
        memberCount: Number(group.member_count ?? 0),
        isMember: Boolean(group.is_member)
      });
    })
  );

  router.patch(
    '/groups/:groupId',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const groupId = z.string().uuid().parse(req.params.groupId);
      const input = updateGroupSchema.parse(req.body);
      const updated = await updateGroup(groupId, req.auth.userId, input);

      if (!updated) throw new HttpError(403, 'Only admins can update the group', 'GROUP_UPDATE_FORBIDDEN');

      const group = toPublicGroup(updated);

      const members = await listGroupMembers(groupId);
      await Promise.all(members.map((m) => io.to(m.user_id).emit('messenger:groupUpdated', { group })));

      res.json({ group });
    })
  );

  router.delete(
    '/groups/:groupId',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const groupId = z.string().uuid().parse(req.params.groupId);

      // Capture members BEFORE deletion: deleting the group cascades and removes
      // group_members rows, so listing them afterwards returns an empty set and
      // nobody (not even the owner) would receive the groupDeleted event.
      const members = await listGroupMembers(groupId);

      const deleted = await deleteGroup(groupId, req.auth.userId);
      if (!deleted) throw new HttpError(403, 'Only the owner can delete the group', 'GROUP_DELETE_FORBIDDEN');

      await Promise.all(members.map((m) => io.to(m.user_id).emit('messenger:groupDeleted', { groupId })));

      res.json({ groupId });
    })
  );

  router.get(
    '/groups/:groupId/members',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const groupId = z.string().uuid().parse(req.params.groupId);
      if (!(await isGroupMember(groupId, req.auth.userId))) throw new HttpError(403, 'Not a member', 'NOT_GROUP_MEMBER');

      const members = await listGroupMembers(groupId);
      res.json({ members: members.map(mapMember) });
    })
  );

  router.get(
    '/groups/:groupId/bootstrap',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const groupId = z.string().uuid().parse(req.params.groupId);
      const [
        group,
        channels,
        channelGates,
        roles,
        members,
        folders,
        categories,
        selectedOptionIds,
        onboardingRequired
      ] = await Promise.all([
        getGroupById(groupId),
        listGroupChannels(groupId),
        getChannelRoleGates(groupId),
        listGroupRoles(groupId),
        listGroupMembers(groupId),
        listGroupFolders(groupId),
        listCustomCategories(groupId),
        getSelectedOptionIds(groupId, req.auth.userId),
        needsOnboarding(groupId, req.auth.userId)
      ]);

      if (!group) throw new HttpError(404, 'Group not found', 'GROUP_NOT_FOUND');
      const self = members.find((member) => member.user_id === req.auth.userId);
      if (!self) throw new HttpError(403, 'Not a member', 'NOT_GROUP_MEMBER');

      const selfRoleIds = new Set<string>(self.role_ids ?? []);
      const selfRoles = roles.filter((role) => selfRoleIds.has(role.id));
      const selfIsOwner = group.owner_id === req.auth.userId || self.role === 'Owner' || selfRoles.some((role) => role.is_owner);
      const selfPermissions = new Set<string>();
      for (const role of selfRoles) {
        for (const permission of role.permissions ?? []) selfPermissions.add(permission);
      }
      const canManageChannels = selfIsOwner || selfPermissions.has('ManageChannels');
      const visibleChannelRows = channels.filter((channel) => {
        const required = channelGates.get(channel.id);
        if (!required || required.size === 0 || canManageChannels) return true;
        for (const roleId of required) if (selfRoleIds.has(roleId)) return true;
        return false;
      });
      const visibleFolderRows = folders.filter((folder) => {
        if (!folder.required_role_id || canManageChannels) return true;
        return selfRoleIds.has(folder.required_role_id);
      });

      res.json({
        channels: visibleChannelRows.map((channel) => toPublicGroupChannel(channel, Array.from(channelGates.get(channel.id) ?? []))),
        roles: roles.map(toPublicGroupRole),
        members: members.map(mapMember),
        folders: visibleFolderRows.map(toPublicGroupFolder),
        customization: { categories, selectedOptionIds, onboardingRequired }
      });
    })
  );

  router.post(
    '/groups/:groupId/members',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const groupId = z.string().uuid().parse(req.params.groupId);
      const input = z.object({ userId: z.string().uuid() }).parse(req.body);

      const group = await getGroupById(groupId);
      if (!group) throw new HttpError(404, 'Group not found', 'GROUP_NOT_FOUND');

      const perms = await getMemberPermissions(groupId, req.auth.userId);
      if (!perms?.isOwner && !perms?.permissions?.includes('ManageRoles') && !perms?.permissions?.includes('KickMembers'))
        throw new HttpError(403, 'Only admins can add members', 'GROUP_ADD_FORBIDDEN');

      const user = await findUserById(input.userId);
      if (!user) throw new HttpError(404, 'User not found', 'USER_NOT_FOUND');

      await addGroupMember(groupId, input.userId);
      io.to(input.userId).emit('messenger:groupInvited', { group: toPublicGroup(group) });

      const members = await listGroupMembers(groupId);
      res.json({ members: members.map(mapMember) });
    })
  );

  router.delete(
    '/groups/:groupId/members/:userId',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const groupId = z.string().uuid().parse(req.params.groupId);
      const targetUserId = z.string().uuid().parse(req.params.userId);

      if (req.auth.userId !== targetUserId) {
        const perms = await getMemberPermissions(groupId, req.auth.userId);
        if (!perms?.isOwner && !perms?.permissions?.includes('KickMembers'))
          throw new HttpError(403, 'Cannot remove member', 'GROUP_REMOVE_FORBIDDEN');
      }

      const removed = await removeGroupMember(groupId, targetUserId, req.auth.userId);
      if (!removed) throw new HttpError(403, 'Cannot remove member', 'GROUP_REMOVE_FORBIDDEN');

      io.to(targetUserId).emit('messenger:groupRemoved', { groupId });

      res.json({ success: true });
    })
  );

  router.patch(
    '/groups/:groupId/members/:userId/role',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const groupId = z.string().uuid().parse(req.params.groupId);
      const targetUserId = z.string().uuid().parse(req.params.userId);
      const input = z.object({
        roleId: z.string().uuid().nullable().optional(),
        addRoleId: z.string().uuid().optional(),
        removeRoleId: z.string().uuid().optional()
      }).parse(req.body);

      const [perms, targetIsMember] = await Promise.all([
        getMemberPermissions(groupId, req.auth.userId),
        isGroupMember(groupId, targetUserId)
      ]);
      if (!perms || !targetIsMember) throw new HttpError(404, 'Member not found', 'GROUP_MEMBER_NOT_FOUND');
      const canManageRoles = perms?.isOwner || perms?.permissions?.includes('ManageRoles');
      if (!canManageRoles) throw new HttpError(403, 'Not allowed to manage roles', 'ROLE_FORBIDDEN');

      const roleIdToValidate = input.roleId ?? input.addRoleId ?? input.removeRoleId ?? null;
      if (roleIdToValidate) {
        const role = await pool.query('SELECT is_owner FROM group_roles WHERE id = $1 AND group_id = $2', [roleIdToValidate, groupId]);
        if (!role.rows[0]) throw new HttpError(404, 'Role not found', 'ROLE_NOT_FOUND');
        if (role.rows[0].is_owner) throw new HttpError(403, 'Cannot manage owner role', 'ROLE_ASSIGN_OWNER');
      }

      if (input.roleId !== undefined) {
        if (input.roleId) {
          const roleName = await pool.query('SELECT name FROM group_roles WHERE id = $1', [input.roleId]);
          await pool.query(
            'UPDATE group_members SET role_id = $1, role = $2 WHERE group_id = $3 AND user_id = $4',
            [input.roleId, roleName.rows[0].name, groupId, targetUserId]
          );
        } else {
          await pool.query(
            "UPDATE group_members SET role_id = NULL, role = 'member' WHERE group_id = $1 AND user_id = $2",
            [groupId, targetUserId]
          );
        }
      } else if (input.addRoleId) {
        await attachRole(groupId, targetUserId, input.addRoleId);
      } else if (input.removeRoleId) {
        await detachRole(groupId, targetUserId, input.removeRoleId);
      }

      const members = await listGroupMembers(groupId);
      const membersList = members.map(mapMember);

      members.forEach((m) => io.to(m.user_id).emit('messenger:groupMemberRoleChanged', {
        groupId,
        userId: targetUserId,
        roleId: input.roleId ?? input.addRoleId ?? input.removeRoleId ?? null,
        members: membersList
      }));

      res.json({ members: membersList });
    })
  );

  router.patch(
    '/groups/:groupId/members/roles',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const groupId = z.string().uuid().parse(req.params.groupId);
      const input = z.object({
        userIds: z.array(z.string().uuid()).min(1).max(100),
        addRoleId: z.string().uuid().optional(),
        removeRoleId: z.string().uuid().optional()
      }).refine((value) => Boolean(value.addRoleId) !== Boolean(value.removeRoleId), {
        message: 'Provide exactly one role action'
      }).parse(req.body);

      const uniqueUserIds = [...new Set(input.userIds)];
      const [perms, currentMembers] = await Promise.all([
        getMemberPermissions(groupId, req.auth.userId),
        listGroupMembers(groupId)
      ]);
      const canManageRoles = perms?.isOwner || perms?.permissions?.includes('ManageRoles');
      if (!canManageRoles) throw new HttpError(403, 'Not allowed to manage roles', 'ROLE_FORBIDDEN');

      const currentMemberIds = new Set(currentMembers.map((member) => member.user_id));
      if (uniqueUserIds.some((userId) => !currentMemberIds.has(userId))) {
        throw new HttpError(404, 'Member not found', 'GROUP_MEMBER_NOT_FOUND');
      }

      const roleId = input.addRoleId ?? input.removeRoleId!;
      const role = await pool.query('SELECT is_owner FROM group_roles WHERE id = $1 AND group_id = $2', [roleId, groupId]);
      if (!role.rows[0]) throw new HttpError(404, 'Role not found', 'ROLE_NOT_FOUND');
      if (role.rows[0].is_owner) throw new HttpError(403, 'Cannot manage owner role', 'ROLE_ASSIGN_OWNER');

      await Promise.all(uniqueUserIds.map((userId) => (
        input.addRoleId ? attachRole(groupId, userId, input.addRoleId) : detachRole(groupId, userId, input.removeRoleId!)
      )));

      const members = await listGroupMembers(groupId);
      const membersList = members.map(mapMember);
      const memberIds = await listGroupMemberIds(groupId);
      await Promise.all(memberIds.map((userId) => io.to(userId).emit('messenger:groupMemberRoleChanged', {
        groupId,
        userIds: uniqueUserIds,
        roleId,
        members: membersList
      })));

      res.json({ members: membersList });
    })
  );

  router.get(
    '/groups/:groupId/invites',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const groupId = z.string().uuid().parse(req.params.groupId);
      const channelId = req.query.channelId === undefined ? undefined : z.string().uuid().nullable().parse(req.query.channelId || null);
      const perms = await getMemberPermissions(groupId, req.auth.userId);
      const canManageInvites = perms?.isOwner || perms?.permissions?.includes('ManageInvites');
      if (!canManageInvites) throw new HttpError(403, 'Not allowed to manage invites', 'INVITE_FORBIDDEN');
      const invites = await listGroupInvites(groupId, channelId);
      res.json({ invites: await Promise.all(invites.map(mapInvite)) });
    })
  );

  router.post(
    '/groups/:groupId/invite',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const groupId = z.string().uuid().parse(req.params.groupId);
      const input = z.object({ channelId: z.string().uuid().nullable().optional() }).parse(req.body ?? {});
      const perms = await getMemberPermissions(groupId, req.auth.userId);
      const canManageInvites = perms?.isOwner || perms?.permissions?.includes('ManageInvites');
      if (input.channelId) {
        const { effective } = await requireChannelPermission(groupId, input.channelId, req.auth.userId, 'CreateInvite', 'INVITE_FORBIDDEN');
        if (!canManageInvites && !hasChannelPermission(effective, 'CreateInvite')) throw new HttpError(403, 'Not allowed to manage invites', 'INVITE_FORBIDDEN');
      } else if (!canManageInvites) {
        throw new HttpError(403, 'Not allowed to manage invites', 'INVITE_FORBIDDEN');
      }
      const invite = await createGroupInvite(groupId, req.auth.userId, input.channelId ?? null);
      res.json({ inviteCode: invite.code, invite: await mapInvite(invite) });
    })
  );

  router.delete(
    '/groups/:groupId/invites/:inviteId',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const groupId = z.string().uuid().parse(req.params.groupId);
      const inviteId = z.string().uuid().parse(req.params.inviteId);
      const perms = await getMemberPermissions(groupId, req.auth.userId);
      const canManageInvites = perms?.isOwner || perms?.permissions?.includes('ManageInvites');
      if (!canManageInvites) throw new HttpError(403, 'Not allowed to manage invites', 'INVITE_FORBIDDEN');
      const deleted = await deleteGroupInvite(groupId, inviteId);
      if (!deleted) throw new HttpError(404, 'Invite not found', 'INVITE_NOT_FOUND');
      res.json({ success: true });
    })
  );

  router.get(
    '/groups/invite/:inviteCode',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const inviteCode = z.string().parse(req.params.inviteCode);
      const preview = await pool.query(
        `
          SELECT groups.*, COUNT(group_members.user_id)::int AS member_count
          FROM groups
          LEFT JOIN group_invites ON group_invites.group_id = groups.id AND group_invites.code = $1
          LEFT JOIN group_members ON group_members.group_id = groups.id
          WHERE groups.invite_code = $1 OR group_invites.code = $1
          GROUP BY groups.id
          LIMIT 1
        `,
        [inviteCode]
      );
      const group = preview.rows[0];
      if (!group) throw new HttpError(404, 'Invite link is invalid or expired', 'INVITE_INVALID');
      res.json({ group: toCompactGroup(group), memberCount: Number(group.member_count ?? 0) });
    })
  );

  router.post(
    '/groups/join/:inviteCode',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const inviteCode = z.string().parse(req.params.inviteCode);
      const group = await getGroupByInviteCode(inviteCode);
      const trackedInvite = await getGroupInviteByCode(inviteCode);

      if (!group) throw new HttpError(404, 'Invite link is invalid or expired', 'INVITE_INVALID');

      await addGroupMember(group.id, req.auth.userId);
      if (trackedInvite) await incrementGroupInviteUse(inviteCode);
      io.to(req.auth.userId).emit('messenger:groupInvited', { group: toPublicGroup(group) });

      const members = await listGroupMembers(group.id);
      const publicUser = toPublicUser(await findUserById(req.auth.userId));
      await Promise.all(members.map(async (m) => io.to(m.user_id).emit('messenger:groupMemberJoined', {
        groupId: group.id,
        user: publicUser
      })));

      res.json({ group: toPublicGroup(group) });
    })
  );

  // ── Channels ──

  router.post(
    '/groups/:groupId/join',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const groupId = z.string().uuid().parse(req.params.groupId);
      const group = await getGroupById(groupId);
      if (!group) throw new HttpError(404, 'Group not found', 'GROUP_NOT_FOUND');

      const wasMember = await isGroupMember(group.id, req.auth.userId);
      await addGroupMember(group.id, req.auth.userId);
      if (!wasMember) io.to(req.auth.userId).emit('messenger:groupInvited', { group: toPublicGroup(group) });

      const members = await listGroupMembers(group.id);
      if (!wasMember) {
        const publicUser = toPublicUser(await findUserById(req.auth.userId));
        await Promise.all(members.map(async (m) => io.to(m.user_id).emit('messenger:groupMemberJoined', {
          groupId: group.id,
          user: publicUser
        })));
      }

      res.json({ group: toPublicGroup(group), memberCount: members.length, isMember: true });
    })
  );

  router.get(
    '/groups/:groupId/channels',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const groupId = z.string().uuid().parse(req.params.groupId);
      if (!(await isGroupMember(groupId, req.auth.userId))) throw new HttpError(403, 'Not a member', 'NOT_GROUP_MEMBER');
      const channels = await visibleChannels(groupId, req.auth.userId);
      res.json({ channels });
    })
  );

  router.post(
    '/groups/:groupId/channels',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const groupId = z.string().uuid().parse(req.params.groupId);
      const input = z.object({ name: z.string().trim().min(1).max(50), type: z.enum(['text', 'voice', 'feed']).optional() }).parse(req.body);
      if (!(await isGroupMember(groupId, req.auth.userId))) throw new HttpError(403, 'Not a member', 'NOT_GROUP_MEMBER');
      const perms = await getMemberPermissions(groupId, req.auth.userId);
      const canManageChannels = perms?.isOwner || perms?.permissions?.includes('ManageChannels');
      if (!canManageChannels) throw new HttpError(403, 'Not allowed to manage channels', 'CHANNEL_CREATE_FORBIDDEN');
      const members = await listGroupMembers(groupId);
      if (input.type === 'feed') {
        const created = await createGroupFeed(groupId, input.name);
        const folder = toPublicGroupFolder(created.folder);
        const channels = [toPublicGroupChannel(created.feed), toPublicGroupChannel(created.chat)];
        await Promise.all(members.flatMap((m) => [
          io.to(m.user_id).emit('messenger:groupFolderCreated', { folder }),
          ...channels.map((channel) => io.to(m.user_id).emit('messenger:groupChannelCreated', { channel }))
        ]));
        res.json({ channel: channels[0], channels, folder });
        return;
      }
      const channel = toPublicGroupChannel(await createGroupChannel(groupId, input.name, input.type ?? 'text'));
      await Promise.all(members.map((m) => io.to(m.user_id).emit('messenger:groupChannelCreated', { channel })));
      res.json({ channel });
    })
  );

  router.delete(
    '/groups/:groupId/channels/:channelId',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const groupId = z.string().uuid().parse(req.params.groupId);
      const channelId = z.string().uuid().parse(req.params.channelId);
      if (!(await isGroupMember(groupId, req.auth.userId))) throw new HttpError(403, 'Not a member', 'NOT_GROUP_MEMBER');
      await requireChannelPermission(groupId, channelId, req.auth.userId, 'ManageChannel', 'CHANNEL_DELETE_FORBIDDEN');
      const deleted = await deleteGroupChannel(channelId, groupId);
      if (!deleted) throw new HttpError(403, 'Cannot delete general channel', 'CHANNEL_DELETE_FORBIDDEN');
      const members = await listGroupMembers(groupId);
      await Promise.all(members.map((m) => io.to(m.user_id).emit('messenger:groupChannelDeleted', { channelId, groupId })));
      res.json({ success: true });
    })
  );

  router.patch(
    '/groups/:groupId/channels/:channelId',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const groupId = z.string().uuid().parse(req.params.groupId);
      const channelId = z.string().uuid().parse(req.params.channelId);
      const input = z.object({
        name: z.string().trim().min(1).max(50).optional(),
        position: z.number().int().optional(),
        folderId: z.string().uuid().nullable().optional(),
        userLimit: z.number().int().min(1).max(99).nullable().optional(),
        topic: z.string().trim().max(1024).optional(),
        slowmodeSeconds: z.number().int().min(0).max(21600).optional(),
        nsfw: z.boolean().optional(),
        bitrate: z.number().int().min(8000).max(384000).optional()
      }).parse(req.body);
      if (!(await isGroupMember(groupId, req.auth.userId))) throw new HttpError(403, 'Not a member', 'NOT_GROUP_MEMBER');
      await requireChannelPermission(groupId, channelId, req.auth.userId, 'ManageChannel', 'CHANNEL_UPDATE_FORBIDDEN');
      const updated = await updateGroupChannel(channelId, groupId, input);
      if (!updated) throw new HttpError(404, 'Channel not found', 'CHANNEL_NOT_FOUND');
      const channel = toPublicGroupChannel(updated);
      const members = await listGroupMembers(groupId);
      await Promise.all(members.map((m) => io.to(m.user_id).emit('messenger:groupChannelUpdated', { channel })));
      res.json({ channel });
    })
  );

  router.post(
    '/groups/:groupId/channels/reorder',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const groupId = z.string().uuid().parse(req.params.groupId);
      const input = z.object({
        items: z.array(z.object({
          id: z.string().uuid(),
          position: z.number().int(),
          folderId: z.string().uuid().nullable()
        }))
      }).parse(req.body);
      if (!(await isGroupMember(groupId, req.auth.userId))) throw new HttpError(403, 'Not a member', 'NOT_GROUP_MEMBER');
      const perms = await getMemberPermissions(groupId, req.auth.userId);
      const canManageChannels = perms?.isOwner || perms?.permissions?.includes('ManageChannels');
      if (!canManageChannels) throw new HttpError(403, 'Not allowed to manage channels', 'CHANNEL_REORDER_FORBIDDEN');
      const channels = (await reorderGroupChannels(groupId, input.items)).map((c) => toPublicGroupChannel(c));
      const members = await listGroupMembers(groupId);
      await Promise.all(members.map((m) => io.to(m.user_id).emit('messenger:groupChannelsReordered', { groupId, channels })));
      res.json({ channels });
    })
  );

  // ── Folders ──

  router.get(
    '/groups/:groupId/folders',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const groupId = z.string().uuid().parse(req.params.groupId);
      if (!(await isGroupMember(groupId, req.auth.userId))) throw new HttpError(403, 'Not a member', 'NOT_GROUP_MEMBER');
      const folders = await visibleFolders(groupId, req.auth.userId);
      res.json({ folders });
    })
  );

  router.post(
    '/groups/:groupId/folders',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const groupId = z.string().uuid().parse(req.params.groupId);
      const input = z.object({ name: z.string().trim().min(1).max(50) }).parse(req.body);
      if (!(await isGroupMember(groupId, req.auth.userId))) throw new HttpError(403, 'Not a member', 'NOT_GROUP_MEMBER');
      const perms = await getMemberPermissions(groupId, req.auth.userId);
      const canManageChannels = perms?.isOwner || perms?.permissions?.includes('ManageChannels');
      if (!canManageChannels) throw new HttpError(403, 'Not allowed to manage channels', 'FOLDER_CREATE_FORBIDDEN');
      const folder = toPublicGroupFolder(await createGroupFolder(groupId, input.name));
      const members = await listGroupMembers(groupId);
      await Promise.all(members.map((m) => io.to(m.user_id).emit('messenger:groupFolderCreated', { folder })));
      res.json({ folder });
    })
  );

  router.patch(
    '/groups/:groupId/folders/:folderId',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const groupId = z.string().uuid().parse(req.params.groupId);
      const folderId = z.string().uuid().parse(req.params.folderId);
      const input = z.object({
        name: z.string().trim().min(1).max(50).optional(),
        position: z.number().int().optional()
      }).parse(req.body);
      if (!(await isGroupMember(groupId, req.auth.userId))) throw new HttpError(403, 'Not a member', 'NOT_GROUP_MEMBER');
      const perms = await getMemberPermissions(groupId, req.auth.userId);
      const canManageChannels = perms?.isOwner || perms?.permissions?.includes('ManageChannels');
      if (!canManageChannels) throw new HttpError(403, 'Not allowed to manage channels', 'FOLDER_UPDATE_FORBIDDEN');
      const updated = await updateGroupFolder(folderId, groupId, input);
      if (!updated) throw new HttpError(404, 'Folder not found', 'FOLDER_NOT_FOUND');
      const folder = toPublicGroupFolder(updated);
      const members = await listGroupMembers(groupId);
      await Promise.all(members.map((m) => io.to(m.user_id).emit('messenger:groupFolderUpdated', { folder })));
      res.json({ folder });
    })
  );

  router.delete(
    '/groups/:groupId/folders/:folderId',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const groupId = z.string().uuid().parse(req.params.groupId);
      const folderId = z.string().uuid().parse(req.params.folderId);
      if (!(await isGroupMember(groupId, req.auth.userId))) throw new HttpError(403, 'Not a member', 'NOT_GROUP_MEMBER');
      const perms = await getMemberPermissions(groupId, req.auth.userId);
      const canManageChannels = perms?.isOwner || perms?.permissions?.includes('ManageChannels');
      if (!canManageChannels) throw new HttpError(403, 'Not allowed to manage channels', 'FOLDER_DELETE_FORBIDDEN');
      const deleted = await deleteGroupFolder(folderId, groupId);
      if (!deleted) throw new HttpError(404, 'Folder not found', 'FOLDER_NOT_FOUND');
      // channels detached from this folder need a refresh on clients
      const channels = (await listGroupChannels(groupId)).map((c) => toPublicGroupChannel(c));
      const members = await listGroupMembers(groupId);
      await Promise.all(members.map((m) => io.to(m.user_id).emit('messenger:groupFolderDeleted', { folderId, groupId, channels })));
      res.json({ success: true });
    })
  );

  // ── Roles ──

  router.get(
    '/groups/:groupId/roles',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const groupId = z.string().uuid().parse(req.params.groupId);
      if (!(await isGroupMember(groupId, req.auth.userId))) throw new HttpError(403, 'Not a member', 'NOT_GROUP_MEMBER');
      const roles = await listGroupRoles(groupId);
      res.json({ roles: roles.map(toPublicGroupRole) });
    })
  );

  // Configure the role automatically granted when a member joins the server.
  router.patch(
    '/groups/:groupId/default-role',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const groupId = z.string().uuid().parse(req.params.groupId);
      const input = z.object({ roleId: z.string().uuid().nullable() }).parse(req.body);

      const requester = (await listGroupMembers(groupId)).find((m) => m.user_id === req.auth.userId);
      if (!requester) throw new HttpError(403, 'Not a member', 'NOT_GROUP_MEMBER');

      const perms = await getMemberPermissions(groupId, req.auth.userId);
      const canManageRoles = perms?.isOwner || perms?.permissions?.includes('ManageRoles');
      if (!canManageRoles) throw new HttpError(403, 'Not allowed to manage roles', 'ROLE_FORBIDDEN');

      const updated = await setGroupDefaultRole(groupId, input.roleId);
      if (!updated) throw new HttpError(400, 'Invalid role', 'ROLE_INVALID');

      const group = toPublicGroup(updated);
      const members = await listGroupMembers(groupId);
      await Promise.all(members.map((m) => io.to(m.user_id).emit('messenger:groupUpdated', { group })));
      res.json({ group });
    })
  );

  router.post(
    '/groups/:groupId/roles',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const groupId = z.string().uuid().parse(req.params.groupId);
      const input = z.object({ name: z.string().trim().min(1).max(50), color: z.string().max(20).optional(), permissions: z.array(z.string()).optional() }).parse(req.body);
      const requester = (await listGroupMembers(groupId)).find((m) => m.user_id === req.auth.userId);
      if (!requester) throw new HttpError(403, 'Not a member', 'NOT_GROUP_MEMBER');

      const perms = await getMemberPermissions(groupId, req.auth.userId);
      const canManageRoles = perms?.isOwner || perms?.permissions?.includes('ManageRoles');
      if (!canManageRoles) throw new HttpError(403, 'Not allowed to manage roles', 'ROLE_FORBIDDEN');

      const role = toPublicGroupRole(await createGroupRole(groupId, input.name, input.color ?? '#8a8a8a', input.permissions ?? []));
      const members = await listGroupMembers(groupId);
      await Promise.all(members.map((m) => io.to(m.user_id).emit('messenger:groupRolesChanged', { groupId })));
      res.json({ role });
    })
  );

  router.patch(
    '/groups/:groupId/roles/everyone',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const groupId = z.string().uuid().parse(req.params.groupId);
      const input = z.object({ permissions: z.array(z.string()) }).parse(req.body);
      const perms = await getMemberPermissions(groupId, req.auth.userId);
      const canManageRoles = perms?.isOwner || perms?.permissions?.includes('ManageRoles');
      if (!canManageRoles) throw new HttpError(403, 'Not allowed to manage roles', 'ROLE_FORBIDDEN');
      const group = await updateGroupEveryonePermissions(groupId, input.permissions);
      if (!group) throw new HttpError(404, 'Group not found', 'GROUP_NOT_FOUND');
      const members = await listGroupMembers(groupId);
      await Promise.all(members.map((m) => io.to(m.user_id).emit('messenger:groupRolesChanged', { groupId })));
      res.json({ group: toPublicGroup(group) });
    })
  );

  router.patch(
    '/groups/:groupId/roles/:roleId',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const groupId = z.string().uuid().parse(req.params.groupId);
      const roleId = z.string().uuid().parse(req.params.roleId);
      const input = z.object({ name: z.string().trim().min(1).max(50).optional(), color: z.string().max(20).optional(), permissions: z.array(z.string()).optional(), hoist: z.boolean().optional() }).parse(req.body);
      const requester = (await listGroupMembers(groupId)).find((m) => m.user_id === req.auth.userId);
      if (!requester) throw new HttpError(403, 'Not a member', 'NOT_GROUP_MEMBER');

      const perms = await getMemberPermissions(groupId, req.auth.userId);
      const canManageRoles = perms?.isOwner || perms?.permissions?.includes('ManageRoles');
      if (!canManageRoles) throw new HttpError(403, 'Not allowed to manage roles', 'ROLE_FORBIDDEN');

      const targetRole = await pool.query('SELECT is_owner FROM group_roles WHERE id = $1 AND group_id = $2', [roleId, groupId]);
      if (!targetRole.rows[0]) throw new HttpError(404, 'Role not found', 'ROLE_NOT_FOUND');
      if (targetRole.rows[0].is_owner) throw new HttpError(403, 'Cannot modify owner role', 'ROLE_MODIFY_OWNER');

      const role = await updateGroupRole(roleId, groupId, input);
      if (!role) throw new HttpError(404, 'Role not found', 'ROLE_NOT_FOUND');

      const members = await listGroupMembers(groupId);
      await Promise.all(members.map((m) => io.to(m.user_id).emit('messenger:groupRolesChanged', { groupId })));
      res.json({ role: toPublicGroupRole(role) });
    })
  );

  router.delete(
    '/groups/:groupId/roles/:roleId',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const groupId = z.string().uuid().parse(req.params.groupId);
      const roleId = z.string().uuid().parse(req.params.roleId);
      const requester = (await listGroupMembers(groupId)).find((m) => m.user_id === req.auth.userId);
      if (!requester) throw new HttpError(403, 'Not a member', 'NOT_GROUP_MEMBER');

      const perms = await getMemberPermissions(groupId, req.auth.userId);
      const canManageRoles = perms?.isOwner || perms?.permissions?.includes('ManageRoles');
      if (!canManageRoles) throw new HttpError(403, 'Not allowed to manage roles', 'ROLE_FORBIDDEN');

      const deleted = await deleteGroupRole(roleId, groupId);
      if (!deleted) throw new HttpError(403, 'Cannot delete owner role', 'ROLE_DELETE_FORBIDDEN');
      const members = await listGroupMembers(groupId);
      await Promise.all(members.map((m) => io.to(m.user_id).emit('messenger:groupRolesChanged', { groupId })));
      res.json({ success: true });
    })
  );

  // ── Server profile customization ──

  // Helper: only owners or members with ManageRoles may edit the constructor.
  async function requireCustomizationAdmin(groupId: string, userId: string) {
    const perms = await getMemberPermissions(groupId, userId);
    if (!perms?.isOwner && !perms?.permissions?.includes('ManageRoles')) {
      throw new HttpError(403, 'Not allowed to manage customization', 'CUSTOMIZATION_FORBIDDEN');
    }
  }

  // Member-facing: list categories + which options the caller has selected, and
  // whether they still need to complete a required onboarding flow.
  router.get(
    '/groups/:groupId/customization',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const groupId = z.string().uuid().parse(req.params.groupId);
      if (!(await isGroupMember(groupId, req.auth.userId))) throw new HttpError(403, 'Not a member', 'NOT_GROUP_MEMBER');
      const [categories, selectedOptionIds, onboardingRequired] = await Promise.all([
        listCustomCategories(groupId),
        getSelectedOptionIds(groupId, req.auth.userId),
        needsOnboarding(groupId, req.auth.userId)
      ]);
      res.json({ categories, selectedOptionIds, onboardingRequired });
    })
  );

  router.post(
    '/groups/:groupId/customization/categories',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const groupId = z.string().uuid().parse(req.params.groupId);
      await requireCustomizationAdmin(groupId, req.auth.userId);
      const input = z.object({
        name: z.string().trim().min(1).max(60),
        selectionType: z.enum(['multi', 'single']).optional(),
        hideChannels: z.boolean().optional(),
        required: z.boolean().optional()
      }).parse(req.body);

      await createCustomCategory(groupId, {
        name: input.name,
        selectionType: input.selectionType ?? 'multi',
        hideChannels: input.hideChannels ?? false,
        required: input.required ?? false
      });

      await broadcastCustomization(groupId);
      res.json({ categories: await listCustomCategories(groupId) });
    })
  );

  router.patch(
    '/groups/:groupId/customization/categories/:categoryId',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const groupId = z.string().uuid().parse(req.params.groupId);
      const categoryId = z.string().uuid().parse(req.params.categoryId);
      await requireCustomizationAdmin(groupId, req.auth.userId);
      const input = z.object({
        name: z.string().trim().min(1).max(60).optional(),
        selectionType: z.enum(['multi', 'single']).optional(),
        hideChannels: z.boolean().optional(),
        required: z.boolean().optional(),
        position: z.number().int().optional()
      }).parse(req.body);

      const updated = await updateCustomCategory(categoryId, groupId, input);
      if (!updated) throw new HttpError(404, 'Category not found', 'CATEGORY_NOT_FOUND');

      await broadcastCustomization(groupId);
      res.json({ categories: await listCustomCategories(groupId) });
    })
  );

  router.delete(
    '/groups/:groupId/customization/categories/:categoryId',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const groupId = z.string().uuid().parse(req.params.groupId);
      const categoryId = z.string().uuid().parse(req.params.categoryId);
      await requireCustomizationAdmin(groupId, req.auth.userId);

      const deleted = await deleteCustomCategory(categoryId, groupId);
      if (!deleted) throw new HttpError(404, 'Category not found', 'CATEGORY_NOT_FOUND');

      await broadcastCustomization(groupId);
      // Deleting a category removes generated roles -> tell clients to refresh.
      const members = await listGroupMembers(groupId);
      await Promise.all(members.map((m) => io.to(m.user_id).emit('messenger:groupRolesChanged', { groupId })));
      res.json({ categories: await listCustomCategories(groupId) });
    })
  );

  router.post(
    '/groups/:groupId/customization/categories/:categoryId/options',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const groupId = z.string().uuid().parse(req.params.groupId);
      const categoryId = z.string().uuid().parse(req.params.categoryId);
      await requireCustomizationAdmin(groupId, req.auth.userId);
      const input = z.object({
        label: z.string().trim().min(1).max(60),
        emoji: z.string().trim().max(16).optional(),
        color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional()
      }).parse(req.body);

      const option = await createCustomOption(categoryId, groupId, input);
      if (!option) throw new HttpError(404, 'Category not found', 'CATEGORY_NOT_FOUND');

      await broadcastCustomization(groupId);
      const members = await listGroupMembers(groupId);
      await Promise.all(members.map((m) => io.to(m.user_id).emit('messenger:groupRolesChanged', { groupId })));
      res.json({ categories: await listCustomCategories(groupId) });
    })
  );

  router.patch(
    '/groups/:groupId/customization/options/:optionId',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const groupId = z.string().uuid().parse(req.params.groupId);
      const optionId = z.string().uuid().parse(req.params.optionId);
      await requireCustomizationAdmin(groupId, req.auth.userId);
      const input = z.object({
        label: z.string().trim().min(1).max(60).optional(),
        emoji: z.string().trim().max(16).optional(),
        color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional()
      }).parse(req.body);

      const updated = await updateCustomOption(optionId, groupId, input);
      if (!updated) throw new HttpError(404, 'Option not found', 'OPTION_NOT_FOUND');

      await broadcastCustomization(groupId);
      const members = await listGroupMembers(groupId);
      await Promise.all(members.map((m) => io.to(m.user_id).emit('messenger:groupRolesChanged', { groupId })));
      res.json({ categories: await listCustomCategories(groupId) });
    })
  );

  router.delete(
    '/groups/:groupId/customization/options/:optionId',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const groupId = z.string().uuid().parse(req.params.groupId);
      const optionId = z.string().uuid().parse(req.params.optionId);
      await requireCustomizationAdmin(groupId, req.auth.userId);

      const deleted = await deleteCustomOption(optionId, groupId);
      if (!deleted) throw new HttpError(404, 'Option not found', 'OPTION_NOT_FOUND');

      await broadcastCustomization(groupId);
      const members = await listGroupMembers(groupId);
      await Promise.all(members.map((m) => io.to(m.user_id).emit('messenger:groupRolesChanged', { groupId })));
      res.json({ categories: await listCustomCategories(groupId) });
    })
  );

  // Set which roles gate visibility of a channel (used to wire channels into
  // hidden customization folders, or any role-based private channel).
  router.put(
    '/groups/:groupId/channels/:channelId/permissions',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const groupId = z.string().uuid().parse(req.params.groupId);
      const channelId = z.string().uuid().parse(req.params.channelId);
      const input = z.object({
        overrides: z.array(z.object({
          roleId: z.union([z.string().uuid(), z.literal('@everyone')]),
          permission: z.string().min(1).max(80),
          value: z.enum(['allow', 'deny'])
        })).max(500)
      }).parse(req.body);

      await requireChannelPermission(groupId, channelId, req.auth.userId, 'ManagePermissions', 'CHANNEL_PERMISSION_FORBIDDEN');

      const [channel, roles] = await Promise.all([
        listGroupChannels(groupId).then((items) => items.find((item) => item.id === channelId) ?? null),
        listGroupRoles(groupId)
      ]);
      if (!channel) throw new HttpError(404, 'Channel not found', 'CHANNEL_NOT_FOUND');
      const roleIds = new Set(roles.map((role) => role.id));
      const overrides = input.overrides.filter((override) => override.roleId === '@everyone' || roleIds.has(override.roleId));
      await replaceChannelPermissionOverrides(channelId, overrides);

      const viewAllowRoleIds = overrides
        .filter((override) => override.roleId !== '@everyone' && override.permission === 'ViewChannel' && override.value === 'allow')
        .map((override) => override.roleId);
      await setChannelRoleGates(channelId, viewAllowRoleIds);

      const members = await listGroupMembers(groupId);
      await Promise.all(members.map((m) => io.to(m.user_id).emit('messenger:groupChannelsReordered', { groupId, channels: [] })));
      const saved = await listChannelPermissionOverrides(channelId);
      res.json({ overrides: saved.map(mapChannelPermissionOverride) });
    })
  );

  router.get(
    '/groups/:groupId/channels/:channelId/permissions',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const groupId = z.string().uuid().parse(req.params.groupId);
      const channelId = z.string().uuid().parse(req.params.channelId);
      await requireChannelPermission(groupId, channelId, req.auth.userId, 'ManagePermissions', 'CHANNEL_PERMISSION_FORBIDDEN');
      const channel = (await listGroupChannels(groupId)).find((item) => item.id === channelId);
      if (!channel) throw new HttpError(404, 'Channel not found', 'CHANNEL_NOT_FOUND');
      const overrides = await listChannelPermissionOverrides(channelId);
      res.json({ overrides: overrides.map(mapChannelPermissionOverride) });
    })
  );

  router.put(
    '/groups/:groupId/channels/:channelId/roles',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const groupId = z.string().uuid().parse(req.params.groupId);
      const channelId = z.string().uuid().parse(req.params.channelId);
      await requireCustomizationAdmin(groupId, req.auth.userId);
      const input = z.object({ roleIds: z.array(z.string().uuid()) }).parse(req.body);

      await setChannelRoleGates(channelId, input.roleIds);
      const members = await listGroupMembers(groupId);
      await Promise.all(members.map((m) => io.to(m.user_id).emit('messenger:groupChannelsReordered', { groupId, channels: [] })));
      res.json({ success: true });
    })
  );

  // Member-facing: toggle an option's role on/off (radio logic for 'single').
  router.post(
    '/groups/:groupId/customization/options/:optionId/toggle',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const groupId = z.string().uuid().parse(req.params.groupId);
      const optionId = z.string().uuid().parse(req.params.optionId);
      if (!(await isGroupMember(groupId, req.auth.userId))) throw new HttpError(403, 'Not a member', 'NOT_GROUP_MEMBER');

      const selectedOptionIds = await toggleCustomOption(groupId, req.auth.userId, optionId);
      if (selectedOptionIds === null) throw new HttpError(404, 'Option not found', 'OPTION_NOT_FOUND');

      // The caller's channel/folder visibility may have changed.
      const [channels, folders] = await Promise.all([
        visibleChannels(groupId, req.auth.userId),
        visibleFolders(groupId, req.auth.userId)
      ]);
      io.to(req.auth.userId).emit('messenger:groupCustomizationApplied', { groupId, channels, folders });

      // Toggling also updates the member's displayed role, so tell everyone in
      // the group to refresh the member list (name colour / role grouping).
      const groupMembers = await listGroupMembers(groupId);
      await Promise.all(
        groupMembers.map((m) => io.to(m.user_id).emit('messenger:groupRolesChanged', { groupId }))
      );

      res.json({ selectedOptionIds, channels, folders });
    })
  );

  // Member-facing: finish the required onboarding flow.
  router.post(
    '/groups/:groupId/customization/complete',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const groupId = z.string().uuid().parse(req.params.groupId);
      if (!(await isGroupMember(groupId, req.auth.userId))) throw new HttpError(403, 'Not a member', 'NOT_GROUP_MEMBER');
      await markOnboardingComplete(groupId, req.auth.userId);
      res.json({ success: true });
    })
  );

  async function broadcastCustomization(groupId: string) {
    const categories = await listCustomCategories(groupId);
    const members = await listGroupMembers(groupId);
    await Promise.all(members.map((m) => io.to(m.user_id).emit('messenger:groupCustomizationChanged', { groupId, categories })));
  }

  // ── Messages ──

  router.get(
    '/groups/:groupId/messages',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const groupId = z.string().uuid().parse(req.params.groupId);
      const channelId = z.string().uuid().parse(req.query.channelId);
      // `before` is an optional message-id cursor for loading older pages on
      // scroll-up. `limit` lets the client tune the page size within bounds.
      const query = z
        .object({
          before: z.string().uuid().optional(),
          limit: z.coerce.number().int().min(1).max(100).optional()
        })
        .parse(req.query);
      await requireChannelPermission(groupId, channelId, req.auth.userId, 'ViewChannel', 'CHANNEL_VIEW_FORBIDDEN');
      await requireChannelPermission(groupId, channelId, req.auth.userId, 'ReadMessageHistory', 'CHANNEL_HISTORY_FORBIDDEN');
      const { messages, hasMore } = await listGroupMessages(groupId, req.auth.userId, channelId, {
        before: query.before,
        limit: query.limit
      });
      const newlyViewedIds = new Set(await markGroupMessagesViewed(
        messages.filter((message) => !message.deleted_at).map((message) => message.feed_source_id ?? message.id),
        req.auth.userId
      ));
      const messagesWithCurrentViewCounts = messages.map((message) => (
        newlyViewedIds.has(message.feed_source_id ?? message.id)
          ? { ...message, view_count: Number(message.view_count ?? 0) + 1 }
          : message
      ));
      res.json({ messages: await toPublicGroupMessagesWithReactions(messagesWithCurrentViewCounts), hasMore });
    })
  );

  router.get(
    '/groups/:groupId/messages/pinned',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const groupId = z.string().uuid().parse(req.params.groupId);
      const query = z
        .object({
          channelId: z.string().uuid(),
          limit: z.coerce.number().int().min(1).max(100).optional()
        })
        .parse(req.query);
      await requireChannelPermission(groupId, query.channelId, req.auth.userId, 'ViewChannel', 'CHANNEL_VIEW_FORBIDDEN');
      await requireChannelPermission(groupId, query.channelId, req.auth.userId, 'ReadMessageHistory', 'CHANNEL_HISTORY_FORBIDDEN');
      const messages = await listGroupPinnedMessages(groupId, req.auth.userId, query.channelId, query.limit);
      res.json({ messages: await toPublicGroupMessagesWithReactions(messages) });
    })
  );

  router.get(
    '/groups/:groupId/messages/media',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const groupId = z.string().uuid().parse(req.params.groupId);
      const query = z
        .object({
          channelId: z.string().uuid(),
          limit: z.coerce.number().int().min(1).max(500).optional()
        })
        .parse(req.query);
      await requireChannelPermission(groupId, query.channelId, req.auth.userId, 'ViewChannel', 'CHANNEL_VIEW_FORBIDDEN');
      await requireChannelPermission(groupId, query.channelId, req.auth.userId, 'ReadMessageHistory', 'CHANNEL_HISTORY_FORBIDDEN');
      const messages = await listGroupMediaMessages(groupId, req.auth.userId, query.channelId, query.limit);
      res.json({ messages: await toPublicGroupMessagesWithReactions(messages) });
    })
  );

  router.post(
    '/groups/:groupId/messages',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const groupId = z.string().uuid().parse(req.params.groupId);
      const input = groupMessageSchema.parse(req.body);

      const group = await getGroupById(groupId);
      if (!group) throw new HttpError(404, 'Group not found', 'GROUP_NOT_FOUND');
      if (!(await isGroupMember(groupId, req.auth.userId))) throw new HttpError(403, 'Not a member', 'NOT_GROUP_MEMBER');
      let senderGroup: { id: string; name: string; avatarData: string } | null = null;
      if (input.senderGroupId) {
        if (input.senderGroupId !== groupId) throw new HttpError(403, 'Cannot send as this group', 'GROUP_IDENTITY_FORBIDDEN');
        const perms = await getMemberPermissions(groupId, req.auth.userId);
        const canUseGroupIdentity = Boolean(
          perms?.isOwner ||
          perms?.permissions?.some((permission) => FEED_PUBLISH_PERMISSIONS.includes(permission))
        );
        if (!canUseGroupIdentity) throw new HttpError(403, 'Cannot send as this group', 'GROUP_IDENTITY_FORBIDDEN');
        senderGroup = { id: group.id, name: group.name, avatarData: group.avatar_data };
      }
      let senderCanMentionEveryoneInChannel = false;
      const { channel, effective } = await requireChannelPermission(groupId, input.channelId, req.auth.userId, 'SendMessages', 'GROUP_SEND_FORBIDDEN');
      await requireChannelPermission(groupId, input.channelId, req.auth.userId, 'ViewChannel', 'CHANNEL_VIEW_FORBIDDEN');
      if (channel.type !== 'text' && channel.type !== 'feed') throw new HttpError(403, 'Cannot send text messages in this channel', 'GROUP_SEND_FORBIDDEN');
      if (channel.type === 'feed') {
        const perms = await getMemberPermissions(groupId, req.auth.userId);
        const canPublishFeed = Boolean(perms?.isOwner || perms?.permissions?.some((permission) => FEED_PUBLISH_PERMISSIONS.includes(permission)));
        if (!canPublishFeed) throw new HttpError(403, 'Only group admins can publish feed posts', 'FEED_PUBLISH_FORBIDDEN');
        senderGroup = { id: group.id, name: group.name, avatarData: group.avatar_data };
      }
      const isVoiceMessage = isVoiceMessageMedia(input.image);
      const isVideoCircleMessage = isVideoCircleMedia(input.image);
      if (input.image && isVoiceMessage && !hasChannelPermission(effective, 'SendVoiceMessages')) {
        throw new HttpError(403, 'Missing voice message permission', 'SEND_VOICE_MESSAGES_FORBIDDEN');
      }
      if (input.image && isVideoCircleMessage && !hasChannelPermission(effective, 'SendVideoCircles')) {
        throw new HttpError(403, 'Missing video circle permission', 'SEND_VIDEO_CIRCLES_FORBIDDEN');
      }
      if (input.image && !isVoiceMessage && !isVideoCircleMessage && !hasChannelPermission(effective, 'AttachFiles')) throw new HttpError(403, 'Missing attachment permission', 'ATTACH_FILES_FORBIDDEN');
      if (input.mediaItems?.length && !hasChannelPermission(effective, 'AttachFiles')) throw new HttpError(403, 'Missing attachment permission', 'ATTACH_FILES_FORBIDDEN');
      if (CUSTOM_EMOJI_TOKEN_RE.test(input.body) && !hasChannelPermission(effective, 'UseExternalEmojis')) {
        throw new HttpError(403, 'Missing external emoji permission', 'EXTERNAL_EMOJI_FORBIDDEN');
      }
      senderCanMentionEveryoneInChannel = hasChannelPermission(effective, 'MentionEveryone');
      if (extractMentionTokens(input.body).has('everyone') && !senderCanMentionEveryoneInChannel) {
        throw new HttpError(403, 'Missing mention everyone permission', 'MENTION_EVERYONE_FORBIDDEN');
      }
      await validateGroupReplyTarget(groupId, input.channelId, input.replyTo);
      const slowmodeSeconds = channel.slowmode_seconds ?? 0;
      if (slowmodeSeconds > 0 && !hasChannelPermission(effective, 'BypassSlowmode')) {
        const last = await pool.query<{ created_at: Date }>(
          `
            SELECT created_at
            FROM group_messages
            WHERE group_id = $1
              AND sender_id = $2
              AND channel_id = $3
              AND deleted_at IS NULL
            ORDER BY created_at DESC
            LIMIT 1
          `,
          [groupId, req.auth.userId, input.channelId]
        );
        const lastCreated = last.rows[0]?.created_at?.getTime();
        if (lastCreated) {
          const retryAfterMs = lastCreated + slowmodeSeconds * 1000 - Date.now();
          if (retryAfterMs > 0) {
            res.status(429).json({
              code: 'SLOWMODE_ACTIVE',
              message: 'Slowmode is active',
              retryAfterMs,
              retryAfterSeconds: Math.ceil(retryAfterMs / 1000)
            });
            return;
          }
        }
      }

      const message = await createGroupMessage(req.auth.userId, groupId, input.channelId, input.body, input.image, input.replyTo, senderGroup, input.mediaItems);
      if (!message) throw new HttpError(403, 'Cannot send message', 'GROUP_SEND_FORBIDDEN');

      const publicMessage = input.replyTo ? await toPublicGroupMessageEnriched(message) : toPublicGroupMessage(message);

      const memberIds = await visibleMemberIdsForChannel(groupId, input.channelId);
      for (const id of memberIds) io.to(id).emit('messenger:groupMessage', { message: publicMessage });

      // Best-effort OpenGraph preview for the first URL in the body, attached
      // asynchronously (and mirrored to feed-linked copies of the message).
      void (async () => {
        const preview = await getLinkPreviewForBody(input.body);
        if (!preview) return;
        await pool.query(
          `
            UPDATE group_messages SET link_preview = $2::jsonb
            WHERE deleted_at IS NULL AND (id = $1 OR feed_source_id = $1)
          `,
          [message.id, JSON.stringify(preview)]
        );
        await emitFeedLinkedMessages('messenger:groupMessageUpdated', groupId, message.id);
      })().catch(() => undefined);

      let feedChatChannelId = channel.feed_chat_channel_id;
      if (channel.type === 'feed' && !feedChatChannelId) {
        const chatChannel = await pool.query<{ id: string }>(
          'SELECT id FROM group_channels WHERE group_id = $1 AND feed_parent_channel_id = $2 ORDER BY position ASC, created_at ASC LIMIT 1',
          [groupId, channel.id]
        );
        feedChatChannelId = chatChannel.rows[0]?.id ?? null;
      }
      if (channel.type === 'feed' && feedChatChannelId) {
        const mirror = await createGroupMessage(
          req.auth.userId,
          groupId,
          feedChatChannelId,
          input.body,
          input.image,
          null,
          senderGroup,
          input.mediaItems,
          { sourceId: message.id, mirror: true }
        );
        if (mirror) {
          const publicMirror = toPublicGroupMessage(mirror);
          const chatMemberIds = await visibleMemberIdsForChannel(groupId, feedChatChannelId);
          for (const id of chatMemberIds) io.to(id).emit('messenger:groupMessage', { message: publicMirror });
        }
      }
      const mentionTokens = extractMentionTokens(input.body);
      if (mentionTokens.size === 0) {
        res.json({ message: publicMessage });
        return;
      }
      const members = await listGroupMembers(groupId);
      const mentionedIdSet = new Set(mentionedUserIdsFromBody(
        input.body,
        members.map((member) => ({ id: member.user_id, nickname: member.nickname })),
        req.auth.userId
      ));
      const roles = await listGroupRoles(groupId);
      const roleById = new Map(roles.map((role) => [role.id, role]));
      const mentionedRoles = roles.filter((role) => (role.is_owner || role.permissions?.includes('Mentionable')) && mentionTokens.has(mentionToken(role.name)));
      for (const role of mentionedRoles) {
        for (const member of members) {
          if (member.user_id !== req.auth.userId && (member.role_ids ?? []).includes(role.id)) mentionedIdSet.add(member.user_id);
        }
      }

      if (mentionTokens.has('everyone')) {
        const senderMember = members.find((member) => member.user_id === req.auth.userId);
        const senderRoleIds = senderMember?.role_ids ?? [];
        const senderRoles = senderRoleIds.map((id) => roleById.get(id)).filter(Boolean) as Awaited<ReturnType<typeof listGroupRoles>>;
        const senderCanMentionEveryone = senderCanMentionEveryoneInChannel || group.owner_id === req.auth.userId || senderRoles.some((role) => role.is_owner || role.permissions?.includes('MentionEveryone'));
        if (senderCanMentionEveryone) {
          for (const member of members) {
            if (member.user_id === req.auth.userId) continue;
            mentionedIdSet.add(member.user_id);
          }
        }
      }
      const mentionedIds = [...mentionedIdSet];
      if (mentionedIds.length > 0) {
        const sender = await findUserById(req.auth.userId);
        const publicGroup = toPublicGroup(group);
        const publicSender = sender ? toPublicUserLite(sender) : null;
        if (publicSender) {
          for (const id of mentionedIds) {
            io.to(id).emit('messenger:mention', {
              kind: 'group',
              message: publicMessage,
              sender: publicSender,
              group: publicGroup
            });
          }
        }
      }

      res.json({ message: publicMessage });
    })
  );

  router.patch(
    '/groups/messages/:messageId',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const messageId = z.string().uuid().parse(req.params.messageId);
      const input = editGroupMessageSchema.parse(req.body);
      const existing = await pool.query<{ group_id: string; channel_id: string | null }>('SELECT group_id, channel_id FROM group_messages WHERE id = $1 AND deleted_at IS NULL', [messageId]);
      const existingMessage = existing.rows[0];
      if (!existingMessage?.channel_id) throw new HttpError(404, 'Message not found', 'GROUP_MESSAGE_NOT_FOUND');
      await requireChannelPermission(existingMessage.group_id, existingMessage.channel_id, req.auth.userId, 'ViewChannel', 'CHANNEL_VIEW_FORBIDDEN');
      const updated = await updateGroupMessage(messageId, req.auth.userId, input.body, input.mediaItems);

      if (!updated) throw new HttpError(403, 'Message can no longer be edited', 'GROUP_MESSAGE_EDIT_FORBIDDEN');

      const canonicalMessageId = updated.feed_source_id ?? updated.id;
      await pool.query(
        `
          UPDATE group_messages
          SET body = $1,
              image_data = $2,
              image_name = $3,
              image_spoiler = $4,
              media_items = $5::jsonb,
              edited_at = $6
          WHERE group_id = $7
            AND (id = $8 OR feed_source_id = $8)
            AND deleted_at IS NULL
        `,
        [
          updated.body,
          updated.image_data,
          updated.image_name,
          updated.image_spoiler,
          updated.media_items ? JSON.stringify(updated.media_items) : null,
          updated.edited_at,
          updated.group_id,
          canonicalMessageId
        ]
      );
      const messages = await emitFeedLinkedMessages('messenger:groupMessageUpdated', updated.group_id, canonicalMessageId);
      const message = messages.find((item) => item.id === messageId) ?? messages.find((item) => item.id === canonicalMessageId) ?? await toPublicGroupMessageEnriched(updated);

      res.json({ message });
    })
  );

  router.delete(
    '/groups/messages/:messageId',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const messageId = z.string().uuid().parse(req.params.messageId);
      const message = await pool.query('SELECT * FROM group_messages WHERE id = $1 AND deleted_at IS NULL', [messageId]);
      if (!message.rows[0]) throw new HttpError(404, 'Message not found', 'GROUP_MESSAGE_NOT_FOUND');
      const groupMessage = message.rows[0];
      if (!groupMessage.channel_id) throw new HttpError(404, 'Message not found', 'GROUP_MESSAGE_NOT_FOUND');

      let canDelete = groupMessage.sender_id === req.auth.userId;

      if (!canDelete) {
        const perms = await getMemberPermissions(groupMessage.group_id, req.auth.userId);
        if (perms?.isOwner || perms?.permissions?.includes('DeleteAnyMessage')) canDelete = true;
        await requireChannelPermission(groupMessage.group_id, groupMessage.channel_id, req.auth.userId, 'ViewChannel', 'CHANNEL_VIEW_FORBIDDEN');
        const effective = await getChannelPermissionSet(groupMessage.group_id, groupMessage.channel_id, req.auth.userId);
        if (hasChannelPermission(effective, 'ManageMessages')) canDelete = true;
      }

      if (!canDelete) throw new HttpError(403, 'Cannot delete this message', 'GROUP_MESSAGE_DELETE_FORBIDDEN');

      const canonicalMessageId = groupMessage.feed_source_id ?? groupMessage.id;
      await pool.query(
        `
          UPDATE group_messages
          SET body = '',
              image_data = NULL,
              image_name = NULL,
              image_spoiler = FALSE,
              media_items = NULL,
              deleted_at = NOW()
          WHERE group_id = $1
            AND (id = $2 OR feed_source_id = $2)
        `,
        [groupMessage.group_id, canonicalMessageId]
      );
      const messages = await emitFeedLinkedMessages('messenger:groupMessageDeleted', groupMessage.group_id, canonicalMessageId);
      const publicMessage = messages.find((item) => item.id === messageId) ?? messages[0] ?? toPublicGroupMessage(groupMessage);

      res.json({ message: publicMessage });
    })
  );

  // Pin or unpin a group message. Any member may pin; staff (owner or
  // DeleteAnyMessage permission) may pin/unpin regardless of authorship.
  router.post(
    '/groups/messages/:messageId/pin',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const messageId = z.string().uuid().parse(req.params.messageId);
      const existing = await pool.query('SELECT * FROM group_messages WHERE id = $1 AND deleted_at IS NULL', [messageId]);
      if (!existing.rows[0]) throw new HttpError(404, 'Message not found', 'GROUP_MESSAGE_NOT_FOUND');
      const groupMessage = existing.rows[0];
      if (!groupMessage.channel_id) throw new HttpError(404, 'Message not found', 'GROUP_MESSAGE_NOT_FOUND');

      if (!(await isGroupMember(groupMessage.group_id, req.auth.userId))) {
        throw new HttpError(403, 'Not a member', 'NOT_GROUP_MEMBER');
      }
      await requireChannelPermission(groupMessage.group_id, groupMessage.channel_id, req.auth.userId, 'ViewChannel', 'CHANNEL_VIEW_FORBIDDEN');
      await requireChannelPermission(groupMessage.group_id, groupMessage.channel_id, req.auth.userId, 'PinMessages', 'GROUP_MESSAGE_PIN_FORBIDDEN');

      const pinned = !groupMessage.pinned_at;
      const updated = await setGroupMessagePin(messageId, pinned);
      if (!updated) throw new HttpError(404, 'Message not found', 'GROUP_MESSAGE_NOT_FOUND');

      const message = await toPublicGroupMessageEnriched(updated);
      const memberIds = await visibleMemberIdsForChannel(updated.group_id, groupMessage.channel_id);
      for (const id of memberIds) io.to(id).emit('messenger:groupMessageUpdated', { message });

      res.json({ message });
    })
  );

  // Toggle an emoji reaction on a group message. Any member may react; reacting
  // again with the same emoji removes the reaction (Discord-style).
  router.post(
    '/groups/messages/:messageId/reactions/toggle',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const messageId = z.string().uuid().parse(req.params.messageId);
      const { emoji } = reactionSchema.parse(req.body);

      const existing = await pool.query('SELECT * FROM group_messages WHERE id = $1 AND deleted_at IS NULL', [messageId]);
      if (!existing.rows[0]) throw new HttpError(404, 'Message not found', 'GROUP_MESSAGE_NOT_FOUND');
      const groupMessage = existing.rows[0];
      if (!groupMessage.channel_id) throw new HttpError(404, 'Message not found', 'GROUP_MESSAGE_NOT_FOUND');

      if (!(await isGroupMember(groupMessage.group_id, req.auth.userId))) {
        throw new HttpError(403, 'Not a member', 'NOT_GROUP_MEMBER');
      }
      await requireChannelPermission(groupMessage.group_id, groupMessage.channel_id, req.auth.userId, 'ViewChannel', 'CHANNEL_VIEW_FORBIDDEN');
      await requireChannelPermission(groupMessage.group_id, groupMessage.channel_id, req.auth.userId, 'AddReactions', 'GROUP_REACTION_FORBIDDEN');
      if (CUSTOM_EMOJI_TOKEN_RE.test(emoji)) {
        await requireChannelPermission(groupMessage.group_id, groupMessage.channel_id, req.auth.userId, 'UseExternalEmojis', 'EXTERNAL_EMOJI_FORBIDDEN');
      }

      const canonicalMessageId = groupMessage.feed_source_id ?? groupMessage.id;
      await toggleGroupMessageReaction(canonicalMessageId, req.auth.userId, emoji);
      const messages = await emitFeedLinkedMessages('messenger:groupMessageUpdated', groupMessage.group_id, canonicalMessageId);
      const message = messages.find((item) => item.id === messageId) ?? messages.find((item) => item.id === canonicalMessageId) ?? await toPublicGroupMessageEnriched(groupMessage);

      res.json({ message });
    })
  );

  // ── Threads ───────────────────────────────────────────────────────────────
  // Replies posted "in thread" hang off a root channel message and stay out
  // of the main channel flow.
  router.get(
    '/groups/:groupId/messages/:messageId/thread',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const groupId = z.string().uuid().parse(req.params.groupId);
      const messageId = z.string().uuid().parse(req.params.messageId);
      const rootResult = await pool.query<GroupMessageRecord>(
        'SELECT * FROM group_messages WHERE id = $1 AND group_id = $2 AND deleted_at IS NULL',
        [messageId, groupId]
      );
      const root = rootResult.rows[0];
      if (!root || !root.channel_id) throw new HttpError(404, 'Message not found', 'MESSAGE_NOT_FOUND');
      if (root.thread_root_id) throw new HttpError(400, 'Threads cannot be nested', 'THREAD_NESTED');
      await requireChannelPermission(groupId, root.channel_id, req.auth.userId, 'ViewChannel', 'CHANNEL_VIEW_FORBIDDEN');

      const rows = await listThreadMessages(groupId, messageId);
      const messages = await toPublicGroupMessagesWithReactions(rows);
      res.json({ root: toPublicGroupMessage(root), messages });
    })
  );

  router.post(
    '/groups/:groupId/messages/:messageId/thread',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const groupId = z.string().uuid().parse(req.params.groupId);
      const messageId = z.string().uuid().parse(req.params.messageId);
      const input = z.object({
        body: z.string().trim().min(1).max(2000)
      }).parse(req.body ?? {});

      const rootResult = await pool.query<GroupMessageRecord>(
        'SELECT * FROM group_messages WHERE id = $1 AND group_id = $2 AND deleted_at IS NULL',
        [messageId, groupId]
      );
      const root = rootResult.rows[0];
      if (!root || !root.channel_id) throw new HttpError(404, 'Message not found', 'MESSAGE_NOT_FOUND');
      if (root.thread_root_id) throw new HttpError(400, 'Threads cannot be nested', 'THREAD_NESTED');
      await requireChannelPermission(groupId, root.channel_id, req.auth.userId, 'ViewChannel', 'CHANNEL_VIEW_FORBIDDEN');
      await requireChannelPermission(groupId, root.channel_id, req.auth.userId, 'SendMessages', 'GROUP_SEND_FORBIDDEN');

      const message = await createGroupMessage(
        req.auth.userId, groupId, root.channel_id, input.body,
        undefined, null, null, undefined, undefined, messageId
      );
      if (!message) throw new HttpError(403, 'Cannot send message', 'GROUP_SEND_FORBIDDEN');

      const publicMessage = toPublicGroupMessage(message);
      const memberIds = await visibleMemberIdsForChannel(groupId, root.channel_id);
      for (const id of memberIds) io.to(id).emit('messenger:groupThreadMessage', { message: publicMessage });
      res.json({ message: publicMessage });
    })
  );

  // Transcribe a group voice message with Whisper (cached on the row).
  router.post(
    '/groups/:groupId/messages/:messageId/transcribe',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const groupId = z.string().uuid().parse(req.params.groupId);
      const messageId = z.string().uuid().parse(req.params.messageId);
      const result = await pool.query<GroupMessageRecord & { transcript: string | null }>(
        'SELECT * FROM group_messages WHERE id = $1 AND group_id = $2 AND deleted_at IS NULL',
        [messageId, groupId]
      );
      const message = result.rows[0];
      if (!message) throw new HttpError(404, 'Message not found', 'MESSAGE_NOT_FOUND');
      if (!message.channel_id) throw new HttpError(404, 'Message not found', 'MESSAGE_NOT_FOUND');
      await requireChannelPermission(groupId, message.channel_id, req.auth.userId, 'ViewChannel', 'CHANNEL_VIEW_FORBIDDEN');
      if (message.transcript) {
        res.json({ transcript: message.transcript });
        return;
      }

      const user = await findUserById(req.auth.userId);
      const quota = await consumeAiQuota(req.auth.userId, user?.role === 'dev');
      if (!quota.unlimited && quota.limit !== null && quota.used > quota.limit) {
        throw new HttpError(429, 'Daily AI limit reached', 'AI_QUOTA_EXCEEDED');
      }

      const transcript = await transcribeAudioDataUrl(message.image_data ?? '');
      await pool.query('UPDATE group_messages SET transcript = $2 WHERE id = $1', [messageId, transcript]);
      res.json({ transcript });
    })
  );

  // ── AI channel summary ("what did I miss?") ───────────────────────────────
  // Summarizes the last N text messages of a channel with Groq. Counts against
  // the caller's daily AI quota (dev accounts are unlimited).
  router.post(
    '/groups/:groupId/channels/:channelId/summarize',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const groupId = z.string().uuid().parse(req.params.groupId);
      const channelId = z.string().uuid().parse(req.params.channelId);
      const input = z.object({ count: z.number().int().min(5).max(200).optional() }).parse(req.body ?? {});

      await requireChannelPermission(groupId, channelId, req.auth.userId, 'ViewChannel', 'CHANNEL_VIEW_FORBIDDEN');
      await requireChannelPermission(groupId, channelId, req.auth.userId, 'ReadMessageHistory', 'READ_HISTORY_FORBIDDEN');

      const user = await findUserById(req.auth.userId);
      if (!user) throw new HttpError(404, 'User not found', 'USER_NOT_FOUND');
      const quota = await consumeAiQuota(req.auth.userId, user.role === 'dev');
      if (!quota.unlimited && quota.limit !== null && quota.used > quota.limit) {
        throw new HttpError(429, 'Daily AI limit reached', 'AI_QUOTA_EXCEEDED');
      }

      const count = input.count ?? 100;
      const rows = await pool.query<{ nickname: string; body: string; created_at: Date }>(
        `
          SELECT users.nickname, group_messages.body, group_messages.created_at
          FROM group_messages
          JOIN users ON users.id = group_messages.sender_id
          WHERE group_messages.group_id = $1
            AND group_messages.channel_id = $2
            AND group_messages.deleted_at IS NULL
            AND group_messages.body <> ''
          ORDER BY group_messages.created_at DESC
          LIMIT $3
        `,
        [groupId, channelId, count]
      );
      if (rows.rows.length === 0) {
        res.json({ summary: '', messageCount: 0 });
        return;
      }

      const transcript = rows.rows
        .reverse()
        .map((row) => `[${row.created_at.toISOString().slice(5, 16).replace('T', ' ')}] ${row.nickname}: ${row.body.slice(0, 400)}`)
        .join('\n');

      const languageName = user.language_code === 'ru' ? 'Russian' : user.language_code === 'uk' ? 'Ukrainian' : 'English';
      const summary = await callGroq(
        [
          'You summarize a group chat transcript for a member who was away.',
          'Write at most 6 short bullet points: key topics, decisions and who said what.',
          'Skip greetings, spam and media-only messages. Do not invent anything.',
          `Answer in ${languageName}.`
        ].join('\n'),
        [{ role: 'user', content: transcript.slice(0, 24_000) }],
        { model: config.groqTranslateModel, temperature: 0.3 }
      );

      res.json({ summary, messageCount: rows.rows.length });
    })
  );

  return router;
}
