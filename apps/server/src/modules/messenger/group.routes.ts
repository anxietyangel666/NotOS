import { Router } from 'express';
import type { Server } from 'socket.io';
import { z } from 'zod';
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
  isGroupMember,
  getGroupByInviteCode,
  regenerateInviteCode,
  listGroupConversationPreviews,
  listGroupMessages,
  createGroupMessage,
  updateGroupMessage,
  setGroupMessagePin,
  toPublicGroup,
  toPublicGroupMessage,
  toPublicGroupRole,
  toPublicGroupChannel,
  toPublicGroupFolder,
  listGroupRoles,
  createGroupRole,
  deleteGroupRole,
  updateGroupRole,
  listGroupChannels,
  createGroupChannel,
  deleteGroupChannel,
  updateGroupChannel,
  reorderGroupChannels,
  listGroupFolders,
  createGroupFolder,
  updateGroupFolder,
  deleteGroupFolder
} from '../../db/groups.js';
import { findUserById, toPublicUser } from '../../db/users.js';
import { asyncHandler } from '../../http/async-handler.js';
import { HttpError } from '../../http/errors.js';
import { type AuthenticatedRequest, requireAuth } from '../../middleware/require-auth.js';

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

async function getMemberPermissions(groupId: string, userId: string) {
  const member = (await listGroupMembers(groupId)).find((m) => m.user_id === userId);
  if (!member) return null;
  if (member.role === 'Owner') return { isOwner: true, permissions: ['ManageRoles', 'DeleteAnyMessage', 'ManageChannels', 'ManageInvites', 'KickMembers'] };
  if (!member.role_id) return { isOwner: false, permissions: [] };
  const roleRow = (await pool.query('SELECT gr.is_owner, gr.permissions FROM group_roles gr WHERE gr.id = $1', [member.role_id])).rows[0];
  if (!roleRow) return { isOwner: false, permissions: [] };
  return { isOwner: roleRow.is_owner, permissions: roleRow.permissions ?? [] };
}

const groupMessageSchema = z.object({
  body: z.preprocess((value) => (typeof value === 'string' ? value : ''), z.string().trim().max(2000)),
  channelId: z.string().uuid().optional(),
  image: z.preprocess((value) => (value === null ? undefined : value), z.object({
    dataUrl: z.string().startsWith('data:image/').max(24_000_000),
    name: z.string().trim().max(240).optional(),
    spoiler: z.boolean().optional()
  }).optional())
}).refine((value) => value.body.length > 0 || Boolean(value.image), {
  message: 'Message body or image is required'
});

const editGroupMessageSchema = z.object({
  body: z.string().trim().min(1).max(2000)
});

export function createGroupRouter(io: Server) {
  const router = Router();

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
      const raw = await listGroupConversationPreviews(req.auth.userId);
      res.json({
        conversations: raw.map((p) => ({
          group: toPublicGroup(p.group),
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
      res.json({
        members: members.map((m) => ({
          user: toPublicUser(m),
          role: m.role,
          roleId: m.role_id,
          joinedAt: m.joined_at.toISOString()
        }))
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
      res.json({
        members: members.map((m) => ({
          user: toPublicUser(m),
          role: m.role,
          roleId: m.role_id,
          joinedAt: m.joined_at.toISOString()
        }))
      });
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
      const input = z.object({ roleId: z.string().uuid().nullable() }).parse(req.body);

      const requester = (await listGroupMembers(groupId)).find((m) => m.user_id === req.auth.userId);
      const perms = await getMemberPermissions(groupId, req.auth.userId);
      const canManageRoles = perms?.isOwner || perms?.permissions?.includes('ManageRoles');
      if (!canManageRoles) throw new HttpError(403, 'Not allowed to manage roles', 'ROLE_FORBIDDEN');

      if (input.roleId) {
        const role = await pool.query('SELECT is_owner FROM group_roles WHERE id = $1 AND group_id = $2', [input.roleId, groupId]);
        if (!role.rows[0]) throw new HttpError(404, 'Role not found', 'ROLE_NOT_FOUND');
        if (role.rows[0].is_owner) throw new HttpError(403, 'Cannot assign owner role', 'ROLE_ASSIGN_OWNER');

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

      const members = await listGroupMembers(groupId);
      const membersList = members.map((m) => ({
        user: toPublicUser(m),
        role: m.role,
        roleId: m.role_id,
        joinedAt: m.joined_at.toISOString()
      }));

      await Promise.all(members.map((m) => io.to(m.user_id).emit('messenger:groupMemberRoleChanged', {
        groupId,
        userId: targetUserId,
        roleId: input.roleId,
        members: membersList
      })));

      res.json({ members: membersList });
    })
  );

  router.post(
    '/groups/:groupId/invite',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const groupId = z.string().uuid().parse(req.params.groupId);
      const perms = await getMemberPermissions(groupId, req.auth.userId);
      const canManageInvites = perms?.isOwner || perms?.permissions?.includes('ManageInvites');
      if (!canManageInvites) throw new HttpError(403, 'Not allowed to manage invites', 'INVITE_FORBIDDEN');
      const updated = await regenerateInviteCode(groupId);
      if (!updated) throw new HttpError(403, 'Could not regenerate invite', 'INVITE_GEN_FAILED');
      res.json({ inviteCode: updated.invite_code });
    })
  );

  router.get(
    '/groups/invite/:inviteCode',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const inviteCode = z.string().parse(req.params.inviteCode);
      const group = await getGroupByInviteCode(inviteCode);
      if (!group) throw new HttpError(404, 'Invite link is invalid or expired', 'INVITE_INVALID');
      const memberCount = (await pool.query('SELECT COUNT(*) FROM group_members WHERE group_id = $1', [group.id])).rows[0].count;
      res.json({ group: toPublicGroup(group), memberCount: Number(memberCount) });
    })
  );

  router.post(
    '/groups/join/:inviteCode',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const inviteCode = z.string().parse(req.params.inviteCode);
      const group = await getGroupByInviteCode(inviteCode);

      if (!group) throw new HttpError(404, 'Invite link is invalid or expired', 'INVITE_INVALID');

      await addGroupMember(group.id, req.auth.userId);
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

  router.get(
    '/groups/:groupId/channels',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const groupId = z.string().uuid().parse(req.params.groupId);
      if (!(await isGroupMember(groupId, req.auth.userId))) throw new HttpError(403, 'Not a member', 'NOT_GROUP_MEMBER');
      const channels = await listGroupChannels(groupId);
      res.json({ channels: channels.map(toPublicGroupChannel) });
    })
  );

  router.post(
    '/groups/:groupId/channels',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const groupId = z.string().uuid().parse(req.params.groupId);
      const input = z.object({ name: z.string().trim().min(1).max(50), type: z.enum(['text', 'voice']).optional() }).parse(req.body);
      if (!(await isGroupMember(groupId, req.auth.userId))) throw new HttpError(403, 'Not a member', 'NOT_GROUP_MEMBER');
      const perms = await getMemberPermissions(groupId, req.auth.userId);
      const canManageChannels = perms?.isOwner || perms?.permissions?.includes('ManageChannels');
      if (!canManageChannels) throw new HttpError(403, 'Not allowed to manage channels', 'CHANNEL_CREATE_FORBIDDEN');
      const channel = toPublicGroupChannel(await createGroupChannel(groupId, input.name, input.type ?? 'text'));
      const members = await listGroupMembers(groupId);
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
      const perms = await getMemberPermissions(groupId, req.auth.userId);
      const canManageChannels = perms?.isOwner || perms?.permissions?.includes('ManageChannels');
      if (!canManageChannels) throw new HttpError(403, 'Not allowed to manage channels', 'CHANNEL_DELETE_FORBIDDEN');
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
        userLimit: z.number().int().min(1).max(99).nullable().optional()
      }).parse(req.body);
      if (!(await isGroupMember(groupId, req.auth.userId))) throw new HttpError(403, 'Not a member', 'NOT_GROUP_MEMBER');
      const perms = await getMemberPermissions(groupId, req.auth.userId);
      const canManageChannels = perms?.isOwner || perms?.permissions?.includes('ManageChannels');
      if (!canManageChannels) throw new HttpError(403, 'Not allowed to manage channels', 'CHANNEL_UPDATE_FORBIDDEN');
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
      const channels = (await reorderGroupChannels(groupId, input.items)).map(toPublicGroupChannel);
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
      const folders = await listGroupFolders(groupId);
      res.json({ folders: folders.map(toPublicGroupFolder) });
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
      const channels = (await listGroupChannels(groupId)).map(toPublicGroupChannel);
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

  // ── Messages ──

  router.get(
    '/groups/:groupId/messages',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const groupId = z.string().uuid().parse(req.params.groupId);
      const channelId = req.query.channelId ? z.string().uuid().parse(req.query.channelId) : undefined;
      const messages = await listGroupMessages(groupId, req.auth.userId, channelId);
      res.json({ messages: messages.map(toPublicGroupMessage) });
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

      const message = await createGroupMessage(req.auth.userId, groupId, input.channelId ?? null, input.body, input.image);
      if (!message) throw new HttpError(403, 'Cannot send message', 'GROUP_SEND_FORBIDDEN');

      const publicMessage = toPublicGroupMessage(message);

      const members = await listGroupMembers(groupId);
      await Promise.all(members.map((m) => io.to(m.user_id).emit('messenger:groupMessage', { message: publicMessage })));

      res.json({ message: publicMessage });
    })
  );

  router.patch(
    '/groups/messages/:messageId',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const messageId = z.string().uuid().parse(req.params.messageId);
      const input = editGroupMessageSchema.parse(req.body);
      const updated = await updateGroupMessage(messageId, req.auth.userId, input.body);

      if (!updated) throw new HttpError(403, 'Message can no longer be edited', 'GROUP_MESSAGE_EDIT_FORBIDDEN');

      const message = toPublicGroupMessage(updated);

      const members = await listGroupMembers(updated.group_id);
      await Promise.all(members.map((m) => io.to(m.user_id).emit('messenger:groupMessageUpdated', { message })));

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

      let canDelete = groupMessage.sender_id === req.auth.userId;

      if (!canDelete) {
        const perms = await getMemberPermissions(groupMessage.group_id, req.auth.userId);
        if (perms?.isOwner || perms?.permissions?.includes('DeleteAnyMessage')) canDelete = true;
      }

      if (!canDelete) throw new HttpError(403, 'Cannot delete this message', 'GROUP_MESSAGE_DELETE_FORBIDDEN');

      await pool.query(
        'UPDATE group_messages SET body = \'\', image_data = NULL, image_name = NULL, image_spoiler = FALSE, deleted_at = NOW() WHERE id = $1',
        [messageId]
      );
      const deleted = await pool.query('SELECT * FROM group_messages WHERE id = $1', [messageId]);

      const publicMessage = toPublicGroupMessage({ ...deleted.rows[0] });

      const members = await listGroupMembers(deleted.rows[0].group_id);
      await Promise.all(members.map((m) => io.to(m.user_id).emit('messenger:groupMessageDeleted', { message: publicMessage })));

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

      if (!(await isGroupMember(groupMessage.group_id, req.auth.userId))) {
        throw new HttpError(403, 'Not a member', 'NOT_GROUP_MEMBER');
      }

      const pinned = !groupMessage.pinned_at;
      const updated = await setGroupMessagePin(messageId, pinned);
      if (!updated) throw new HttpError(404, 'Message not found', 'GROUP_MESSAGE_NOT_FOUND');

      const message = toPublicGroupMessage(updated);
      const members = await listGroupMembers(updated.group_id);
      await Promise.all(members.map((m) => io.to(m.user_id).emit('messenger:groupMessageUpdated', { message })));

      res.json({ message });
    })
  );

  return router;
}
