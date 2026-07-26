import { Router } from 'express';
import type { Server } from 'socket.io';
import { z } from 'zod';
import { chatImageSchema, chatMediaItemsSchema } from './media.js';
import { pool } from '../../db/pool.js';
import type { FriendRequestUserRecord, MessageRecord } from '../../db/messenger.js';
import {
  acceptFriendRequest,
  clearConversation,
  createMessage,
  deleteFriendRequest,
  deleteMessage,
  getConversationSettings,
  getFriendshipDate,
  listConversation,
  listConversationAround,
  listConversationImages,
  listConversationLinks,
  listConversationPinned,
  listConversationPreviews,
  listFriendRequests,
  listFriends,
  listMutualFriends,
  markConversationRead,
  pinMessage,
  removeFriend,
  requestFriendship,
  searchConversation,
  setConversationBackground,
  unpinMessage,
  updateMessage,
  toPublicMessage,
  toPublicConversationSettings,
  toPublicMessageEnriched,
  toPublicMessagesEnriched,
  loadReplySnippets,
  toggleMessageReaction,
  blockUser,
  unblockUser,
  blockState,
  blockExistsBetween,
  listBlockedIds
} from '../../db/messenger.js';
import { findUserById, toPublicUser, toPublicUserLite, userExistsById } from '../../db/users.js';
import {
  getMutualGroups,
  getUserGroups,
  getGroupIdentityForUser,
  listGroupIdentitiesForUser,
  toPublicGroup,
  toPublicGroupMessage
} from '../../db/groups.js';
import { visibleGroupConversationPreviews } from './group.routes.js';
import { asyncHandler } from '../../http/async-handler.js';
import { HttpError } from '../../http/errors.js';
import { type AuthenticatedRequest, requireAuth } from '../../middleware/require-auth.js';
import { mentionedUserIdsFromBody } from './mentions.js';
import { saveChatImageDataUrl } from './upload-storage.js';
import { config } from '../../config.js';

const friendSchema = z.object({
  userId: z.string().uuid()
});

// Accept either an inline image data URL (uploaded/pasted images) or a remote
// GIF URL from a trusted provider (Tenor / Giphy) so animated GIFs picked from
// the in-app GIF browser can be shared without re-uploading the bytes.
const messageImageSchema = chatImageSchema;

const messageSchema = z.object({
  recipientId: z.string().uuid(),
  body: z.preprocess((value) => (typeof value === 'string' ? value : ''), z.string().trim().max(2000)),
  image: z.preprocess((value) => (value === null ? undefined : value), messageImageSchema.optional()),
  mediaItems: z.preprocess((value) => (value === null ? undefined : value), chatMediaItemsSchema.optional()),
  replyTo: z.string().uuid().optional(),
  senderGroupId: z.string().uuid().optional()
}).refine((value) => value.body.length > 0 || Boolean(value.image) || Boolean(value.mediaItems?.length), {
  message: 'Message body or image is required'
});

const editMessageSchema = z.object({
  body: z.preprocess((value) => (typeof value === 'string' ? value : ''), z.string().trim().max(2000)),
  mediaItems: z.preprocess((value) => (value === null ? undefined : value), chatMediaItemsSchema.optional())
}).refine((value) => value.body.length > 0 || Boolean(value.mediaItems?.length), {
  message: 'Message body or media is required'
});

const reactionSchema = z.object({
  emoji: z.string().trim().min(1).max(4096)
});

const conversationBackgroundSchema = z.object({
  backgroundData: z.string().max(24_000_000).refine((value) => value === '' || value.startsWith('data:image/'), {
    message: 'Background must be an image data URL'
  })
});

const uploadMediaSchema = z.object({
  dataUrl: z.string().max(24_000_000),
  name: z.string().trim().max(240).optional()
});

function publicUrl(_req: AuthenticatedRequest, urlPath: string) {
  return `${config.publicApiUrl}${urlPath}`;
}

const CHAT_BACKGROUND_SET_MARKER = '[chat-background:set]';
const CHAT_BACKGROUND_CLEAR_MARKER = '[chat-background:clear]';

async function friendPayload(userId: string) {
  const [friends, requests] = await Promise.all([listFriends(userId), listFriendRequests(userId)]);
  return {
    friends: friends.map(toPublicUserLite),
    requests: {
      incoming: requests.incoming.map(toPublicFriendRequest),
      outgoing: requests.outgoing.map(toPublicFriendRequest)
    }
  };
}

function toPublicFriendRequest(user: FriendRequestUserRecord) {
  return {
    ...toPublicUserLite(user),
    requestCreatedAt: user.request_created_at.toISOString()
  };
}

async function emitFriendUpdates(io: Server, ...userIds: string[]) {
  await Promise.all(
    userIds.map(async (userId) => {
      io.to(userId).emit('messenger:friendsChanged', await friendPayload(userId));
    })
  );
}

function toCompactGroup(group: Parameters<typeof toPublicGroup>[0]) {
  const publicGroup = toPublicGroup(group);
  return {
    ...publicGroup,
    nameplate: publicGroup.nameplate?.type === 'image' ? null : publicGroup.nameplate
  };
}

export function createMessengerRouter(io: Server) {
  const router = Router();

  router.post(
    '/media',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const input = uploadMediaSchema.parse(req.body);
      try {
        const saved = await saveChatImageDataUrl(input.dataUrl, input.name);
        res.json({
          media: {
            dataUrl: publicUrl(req, saved.urlPath),
            name: saved.name,
            spoiler: false,
            mimeType: saved.mimeType,
            size: saved.size
          }
        });
      } catch (error) {
        if ((error as Error & { code?: string }).code === 'UNSUPPORTED_MEDIA') {
          throw new HttpError(400, 'Unsupported image media', 'UNSUPPORTED_MEDIA');
        }
        throw error;
      }
    })
  );

  router.get(
    '/bootstrap',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const [friendData, conversations, blockedIds, groups, groupConversationRows] = await Promise.all([
        friendPayload(req.auth.userId),
        listConversationPreviews(req.auth.userId),
        listBlockedIds(req.auth.userId),
        getUserGroups(req.auth.userId),
        visibleGroupConversationPreviews(req.auth.userId)
      ]);
      const blocked = new Set(blockedIds);

      res.json({
        friends: friendData.friends,
        requests: friendData.requests,
        conversations: conversations
          .filter((conversation) => !blocked.has(conversation.user.id))
          .map((conversation) => ({
            user: toPublicUserLite(conversation.user),
            message: toPublicMessage(conversation.message),
            unreadCount: conversation.unreadCount
          })),
        groups: groups.map(toCompactGroup),
        groupConversations: groupConversationRows.map((preview) => ({
          group: toCompactGroup(preview.group),
          message: toPublicGroupMessage(preview.message),
          unreadCount: preview.unreadCount
        }))
      });
    })
  );

  router.get(
    '/friends',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const friends = await listFriends(req.auth.userId);
      res.json({ friends: friends.map(toPublicUserLite) });
    })
  );

  router.get(
    '/friendship/:friendId',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const friendId = z.string().uuid().parse(req.params.friendId);
      const createdAt = await getFriendshipDate(req.auth.userId, friendId);
      res.json({ createdAt: createdAt ? createdAt.toISOString() : null });
    })
  );

  router.get(
    '/mutual-friends/:userId',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const userId = z.string().uuid().parse(req.params.userId);
      const friends = await listMutualFriends(req.auth.userId, userId);
      res.json({ friends: friends.map(toPublicUserLite) });
    })
  );

  router.get(
    '/mutual-groups/:userId',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const userId = z.string().uuid().parse(req.params.userId);
      const groups = await getMutualGroups(req.auth.userId, userId);
      res.json({ groups: groups.map(toCompactGroup) });
    })
  );

  router.get(
    '/requests',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      res.json({ requests: (await friendPayload(req.auth.userId)).requests });
    })
  );

  router.post(
    '/friends',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const input = friendSchema.parse(req.body);

      if (input.userId === req.auth.userId) {
        throw new HttpError(400, 'Cannot add yourself as a friend', 'INVALID_FRIEND');
      }

      const friend = await findUserById(input.userId);
      if (!friend) {
        throw new HttpError(404, 'User not found', 'USER_NOT_FOUND');
      }

      const status = await requestFriendship(req.auth.userId, input.userId);
      await emitFriendUpdates(io, req.auth.userId, input.userId);
      res.json({ status, friend: toPublicUser(friend), ...(await friendPayload(req.auth.userId)) });
    })
  );

  router.post(
    '/friends/requests/:userId/accept',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const requesterId = z.string().uuid().parse(req.params.userId);
      const requester = await findUserById(requesterId);

      if (!requester) {
        throw new HttpError(404, 'User not found', 'USER_NOT_FOUND');
      }

      const accepted = await acceptFriendRequest(req.auth.userId, requesterId);
      if (!accepted) {
        throw new HttpError(404, 'Friend request not found', 'FRIEND_REQUEST_NOT_FOUND');
      }

      await emitFriendUpdates(io, req.auth.userId, requesterId);
      res.json({ friend: toPublicUser(requester), ...(await friendPayload(req.auth.userId)) });
    })
  );

  router.delete(
    '/friends/requests/:userId',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const otherUserId = z.string().uuid().parse(req.params.userId);
      const otherUser = await findUserById(otherUserId);

      if (!otherUser) {
        throw new HttpError(404, 'User not found', 'USER_NOT_FOUND');
      }

      const deleted = await deleteFriendRequest(req.auth.userId, otherUserId);
      if (!deleted) {
        throw new HttpError(404, 'Friend request not found', 'FRIEND_REQUEST_NOT_FOUND');
      }

      await emitFriendUpdates(io, req.auth.userId, otherUserId);
      res.json({ ...(await friendPayload(req.auth.userId)) });
    })
  );

  router.delete(
    '/friends/:userId',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const friendId = z.string().uuid().parse(req.params.userId);

      // Removing a friendship only needs to delete the relationship rows, so
      // we don't require the other account to still exist. This lets a user
      // clean up a friendship even if the other account was deleted.
      await removeFriend(req.auth.userId, friendId);
      await emitFriendUpdates(io, req.auth.userId, friendId);
      res.json({ ...(await friendPayload(req.auth.userId)) });
    })
  );

  router.get(
    '/messages/:userId',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const userId = z.string().uuid().parse(req.params.userId);
      // `before` is an optional message-id cursor for loading older pages on
      // scroll-up. `limit` lets the client tune the page size within bounds.
      const query = z
        .object({
          before: z.string().uuid().optional(),
          limit: z.coerce.number().int().min(1).max(100).optional()
        })
        .parse(req.query);
      const targetExists = await userExistsById(userId);

      if (!targetExists) {
        throw new HttpError(404, 'User not found', 'USER_NOT_FOUND');
      }

      const readReceipt = query.before
        ? null
        : await markConversationRead(req.auth.userId, userId);
      if (readReceipt?.messageIds.length && readReceipt.readAt) {
        io.to(userId).emit('messenger:messagesRead', {
          readerId: req.auth.userId,
          messageIds: readReceipt.messageIds,
          readAt: readReceipt.readAt
        });
      }
      const conversation = await listConversation(req.auth.userId, userId, {
        before: query.before,
        limit: query.limit
      });
      const { messages, hasMore } = conversation;
      res.json({ messages: await toPublicMessagesEnriched(messages), hasMore });
    })
  );

  router.post(
    '/messages/:userId/read',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const userId = z.string().uuid().parse(req.params.userId);
      const targetExists = await userExistsById(userId);

      if (!targetExists) {
        throw new HttpError(404, 'User not found', 'USER_NOT_FOUND');
      }

      const readReceipt = await markConversationRead(req.auth.userId, userId);
      if (readReceipt.messageIds.length && readReceipt.readAt) {
        io.to(userId).emit('messenger:messagesRead', {
          readerId: req.auth.userId,
          messageIds: readReceipt.messageIds,
          readAt: readReceipt.readAt
        });
      }
      res.json(readReceipt);
    })
  );

  router.get(
    '/conversations',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const conversations = await listConversationPreviews(req.auth.userId);
      // Hide conversations with users blocked in either direction.
      const blockedIds = new Set(await listBlockedIds(req.auth.userId));
      res.json({
        conversations: conversations
          .filter((conversation) => !blockedIds.has(conversation.user.id))
          .map((conversation) => ({
            user: toPublicUserLite(conversation.user),
            message: toPublicMessage(conversation.message),
            unreadCount: conversation.unreadCount
          }))
      });
    })
  );

  router.get(
    '/group-identities',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const groups = await listGroupIdentitiesForUser(req.auth.userId);
      res.json({
        groups: groups.map((group) => ({
          group: toPublicGroup(group),
          memberCount: group.member_count
        }))
      });
    })
  );

  // ── Blocking ──────────────────────────────────────────────────────────────
  // Direct conversation settings.
  router.get(
    '/conversations/:userId/settings',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const userId = z.string().uuid().parse(req.params.userId);
      if (!(await userExistsById(userId))) throw new HttpError(404, 'User not found', 'USER_NOT_FOUND');
      const settings = await getConversationSettings(req.auth.userId, userId);
      res.json({ settings: toPublicConversationSettings(settings) });
    })
  );

  router.patch(
    '/conversations/:userId/background',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const userId = z.string().uuid().parse(req.params.userId);
      const input = conversationBackgroundSchema.parse(req.body ?? {});
      if (userId === req.auth.userId) throw new HttpError(400, 'Cannot update your own conversation', 'INVALID_RECIPIENT');
      if (!(await userExistsById(userId))) throw new HttpError(404, 'User not found', 'USER_NOT_FOUND');
      if (await blockExistsBetween(req.auth.userId, userId)) {
        throw new HttpError(403, 'You cannot update this conversation', 'USER_BLOCKED');
      }

      const settings = await setConversationBackground(req.auth.userId, userId, input.backgroundData);
      const created = await createMessage(
        req.auth.userId,
        userId,
        input.backgroundData ? CHAT_BACKGROUND_SET_MARKER : CHAT_BACKGROUND_CLEAR_MARKER,
        input.backgroundData ? { dataUrl: input.backgroundData, name: 'chat-background' } : undefined
      );
      const message = toPublicMessage(created);
      const publicSettings = toPublicConversationSettings(settings);
      const ownPayload = { userId, backgroundData: publicSettings.backgroundData, updatedBy: publicSettings.updatedBy, updatedAt: publicSettings.updatedAt };
      const peerPayload = { userId: req.auth.userId, backgroundData: publicSettings.backgroundData, updatedBy: publicSettings.updatedBy, updatedAt: publicSettings.updatedAt };

      io.to(req.auth.userId).emit('messenger:conversationBackgroundChanged', ownPayload);
      io.to(userId).emit('messenger:conversationBackgroundChanged', peerPayload);
      io.to(userId).emit('messenger:message', { message });
      io.to(req.auth.userId).emit('messenger:message', { message });
      res.json({ settings: publicSettings, message });
    })
  );

  // Blocking.
  router.get(
    '/block/:userId',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const userId = z.string().uuid().parse(req.params.userId);
      res.json(await blockState(req.auth.userId, userId));
    })
  );

  router.post(
    '/block/:userId',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const userId = z.string().uuid().parse(req.params.userId);
      if (userId === req.auth.userId) throw new HttpError(400, 'Cannot block yourself', 'INVALID_TARGET');
      await blockUser(req.auth.userId, userId);
      // Tell both sides so their UIs update (conversation hidden / send disabled).
      io.to(userId).emit('messenger:blockChanged', { userId: req.auth.userId });
      io.to(req.auth.userId).emit('messenger:blockChanged', { userId });
      res.json(await blockState(req.auth.userId, userId));
    })
  );

  router.delete(
    '/block/:userId',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const userId = z.string().uuid().parse(req.params.userId);
      await unblockUser(req.auth.userId, userId);
      io.to(userId).emit('messenger:blockChanged', { userId: req.auth.userId });
      io.to(req.auth.userId).emit('messenger:blockChanged', { userId });
      res.json(await blockState(req.auth.userId, userId));
    })
  );

  // ── Search within a conversation ────────────────────────────────────────────
  router.get(
    '/messages/:userId/search',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const userId = z.string().uuid().parse(req.params.userId);
      const query = z.object({ q: z.string().trim().min(1).max(200) }).parse(req.query);
      const rows = await searchConversation(req.auth.userId, userId, query.q);
      res.json({ messages: await toPublicMessagesEnriched(rows) });
    })
  );

  // ── Load a window of messages centred on a target (jump-to-message) ─────────
  router.get(
    '/messages/:userId/around/:messageId',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const userId = z.string().uuid().parse(req.params.userId);
      const messageId = z.string().uuid().parse(req.params.messageId);
      const readReceipt = await markConversationRead(req.auth.userId, userId);
      if (readReceipt.messageIds.length && readReceipt.readAt) {
        io.to(userId).emit('messenger:messagesRead', {
          readerId: req.auth.userId,
          messageIds: readReceipt.messageIds,
          readAt: readReceipt.readAt
        });
      }
      const window = await listConversationAround(req.auth.userId, userId, messageId);
      if (!window) throw new HttpError(404, 'Message not found', 'MESSAGE_NOT_FOUND');
      res.json({
        messages: await toPublicMessagesEnriched(window.messages),
        hasMoreBefore: window.hasMoreBefore,
        hasMoreAfter: window.hasMoreAfter
      });
    })
  );

  // ── Shared media: all images in a conversation ──────────────────────────────
  router.get(
    '/messages/:userId/images',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const userId = z.string().uuid().parse(req.params.userId);
      const rows = await listConversationImages(req.auth.userId, userId);
      res.json({ images: await toPublicMessagesEnriched(rows) });
    })
  );

  // ── Shared links: all messages containing a URL ─────────────────────────────
  router.get(
    '/messages/:userId/pinned',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const userId = z.string().uuid().parse(req.params.userId);
      const query = z.object({ limit: z.coerce.number().int().min(1).max(100).optional() }).parse(req.query);
      const rows = await listConversationPinned(req.auth.userId, userId, query.limit);
      res.json({ messages: await toPublicMessagesEnriched(rows) });
    })
  );

  router.get(
    '/messages/:userId/links',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const userId = z.string().uuid().parse(req.params.userId);
      const rows = await listConversationLinks(req.auth.userId, userId);
      res.json({ links: await toPublicMessagesEnriched(rows) });
    })
  );

  router.post(
    '/messages',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const input = messageSchema.parse(req.body);

      if (input.recipientId === req.auth.userId) {
        throw new HttpError(400, 'Cannot send a message to yourself', 'INVALID_RECIPIENT');
      }

      const recipient = await findUserById(input.recipientId);
      if (!recipient) {
        throw new HttpError(404, 'User not found', 'USER_NOT_FOUND');
      }

      // A block in either direction prevents messaging.
      if (await blockExistsBetween(req.auth.userId, input.recipientId)) {
        throw new HttpError(403, 'You cannot message this user', 'USER_BLOCKED');
      }

      let senderGroup: { id: string; name: string; avatarData: string } | null = null;
      if (input.senderGroupId) {
        if (recipient.allow_group_identity_messages === false) {
          throw new HttpError(403, 'This user does not allow group identity messages', 'GROUP_IDENTITY_MESSAGES_DISABLED');
        }
        const group = await getGroupIdentityForUser(req.auth.userId, input.senderGroupId);
        if (!group) {
          throw new HttpError(403, 'Not allowed to send as this group', 'GROUP_IDENTITY_FORBIDDEN');
        }
        senderGroup = { id: group.id, name: group.name, avatarData: group.avatar_data };
      }

      const created = await createMessage(req.auth.userId, input.recipientId, input.body, input.image, input.replyTo, senderGroup, input.mediaItems);
      const message = input.replyTo ? await toPublicMessageEnriched(created) : toPublicMessage(created);
      io.to(input.recipientId).emit('messenger:message', { message });
      io.to(req.auth.userId).emit('messenger:message', { message });
      if (input.body.includes('@') && mentionedUserIdsFromBody(input.body, [{ id: recipient.id, nickname: recipient.nickname }], req.auth.userId).includes(recipient.id)) {
        const sender = await findUserById(req.auth.userId);
        if (sender) {
          io.to(recipient.id).emit('messenger:mention', {
            kind: 'dm',
            message,
            sender: toPublicUserLite(sender)
          });
        }
      }
      res.json({ message });
    })
  );

  router.patch(
    '/messages/:messageId',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const messageId = z.string().uuid().parse(req.params.messageId);
      const input = editMessageSchema.parse(req.body);
      const updated = await updateMessage(messageId, req.auth.userId, input.body, input.mediaItems);

      if (!updated) {
        throw new HttpError(403, 'Message can no longer be edited', 'MESSAGE_EDIT_FORBIDDEN');
      }

      const message = await toPublicMessageEnriched(updated);
      io.to(updated.recipient_id).emit('messenger:messageUpdated', { message });
      io.to(updated.sender_id).emit('messenger:messageUpdated', { message });
      res.json({ message });
    })
  );

  router.delete(
    '/messages/:messageId',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const messageId = z.string().uuid().parse(req.params.messageId);
      const deleted = await deleteMessage(messageId, req.auth.userId);

      if (!deleted) {
        throw new HttpError(404, 'Message not found', 'MESSAGE_NOT_FOUND');
      }

      const message = toPublicMessage(deleted);
      io.to(deleted.recipient_id).emit('messenger:messageDeleted', { message });
      io.to(deleted.sender_id).emit('messenger:messageDeleted', { message });
      res.json({ message });
    })
  );

  router.post(
    '/conversations/:userId/clear',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const userId = z.string().uuid().parse(req.params.userId);
      const input = z.object({ forEveryone: z.boolean().optional() }).parse(req.body ?? {});
      if (!(await userExistsById(userId))) throw new HttpError(404, 'User not found', 'USER_NOT_FOUND');
      await clearConversation(req.auth.userId, userId, Boolean(input.forEveryone));
      io.to(req.auth.userId).emit('messenger:conversationCleared', { userId, byUserId: req.auth.userId, forEveryone: Boolean(input.forEveryone) });
      if (input.forEveryone) {
        io.to(userId).emit('messenger:conversationCleared', { userId: req.auth.userId, byUserId: req.auth.userId, forEveryone: true });
      }
      res.json({ success: true });
    })
  );

  router.patch(
    '/messages/:messageId/pin',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const messageId = z.string().uuid().parse(req.params.messageId);
      const updated = await pinMessage(messageId, req.auth.userId);
      if (!updated) {
        const unpinned = await unpinMessage(messageId, req.auth.userId);
        if (!unpinned) throw new HttpError(404, 'Message not found', 'MESSAGE_NOT_FOUND');
        const message = toPublicMessage(unpinned);
        io.to(unpinned.recipient_id).emit('messenger:messagePinned', { message });
        io.to(unpinned.sender_id).emit('messenger:messagePinned', { message });
        res.json({ message });
        return;
      }
      const message = await toPublicMessageEnriched(updated);
      io.to(updated.recipient_id).emit('messenger:messagePinned', { message });
      io.to(updated.sender_id).emit('messenger:messagePinned', { message });
      res.json({ message });
    })
  );

  router.post(
    '/messages/:messageId/reactions/toggle',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const messageId = z.string().uuid().parse(req.params.messageId);
      const { emoji } = reactionSchema.parse(req.body);

      const existing = await pool.query<{ sender_id: string; recipient_id: string }>(
        'SELECT sender_id, recipient_id FROM messages WHERE id = $1 AND deleted_at IS NULL',
        [messageId]
      );
      const row = existing.rows[0];
      if (!row) throw new HttpError(404, 'Message not found', 'MESSAGE_NOT_FOUND');
      if (row.sender_id !== req.auth.userId && row.recipient_id !== req.auth.userId) {
        throw new HttpError(403, 'Cannot react to this message', 'MESSAGE_REACT_FORBIDDEN');
      }

      const reactions = await toggleMessageReaction(messageId, req.auth.userId, emoji);
      const full = await pool.query<MessageRecord>('SELECT * FROM messages WHERE id = $1', [messageId]);
      const fullMessage = full.rows[0];
      const replies = fullMessage.reply_to ? await loadReplySnippets([fullMessage.reply_to]) : null;
      const message = toPublicMessage(fullMessage, reactions, fullMessage.reply_to ? replies?.get(fullMessage.reply_to) ?? null : null);
      io.to(row.recipient_id).emit('messenger:messageUpdated', { message });
      io.to(row.sender_id).emit('messenger:messageUpdated', { message });
      res.json({ message });
    })
  );

  return router;
}
