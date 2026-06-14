import { Router } from 'express';
import type { Server } from 'socket.io';
import { z } from 'zod';
import {
  acceptFriendRequest,
  createMessage,
  deleteFriendRequest,
  deleteMessage,
  getFriendshipDate,
  listConversation,
  listConversationPreviews,
  listFriendRequests,
  listFriends,
  listMutualFriends,
  markConversationRead,
  pinMessage,
  removeFriend,
  requestFriendship,
  unpinMessage,
  updateMessage,
  toPublicMessage
} from '../../db/messenger.js';
import { findUserById, toPublicUser } from '../../db/users.js';
import { getMutualGroups, toPublicGroup } from '../../db/groups.js';
import { asyncHandler } from '../../http/async-handler.js';
import { HttpError } from '../../http/errors.js';
import { type AuthenticatedRequest, requireAuth } from '../../middleware/require-auth.js';

const friendSchema = z.object({
  userId: z.string().uuid()
});

const messageImageSchema = z.object({
  dataUrl: z.string().startsWith('data:image/').max(24_000_000),
  name: z.string().trim().max(240).optional(),
  spoiler: z.boolean().optional()
});

const messageSchema = z.object({
  recipientId: z.string().uuid(),
  body: z.preprocess((value) => (typeof value === 'string' ? value : ''), z.string().trim().max(2000)),
  image: z.preprocess((value) => (value === null ? undefined : value), messageImageSchema.optional())
}).refine((value) => value.body.length > 0 || Boolean(value.image), {
  message: 'Message body or image is required'
});

const editMessageSchema = z.object({
  body: z.string().trim().min(1).max(2000)
});

async function friendPayload(userId: string) {
  const [friends, requests] = await Promise.all([listFriends(userId), listFriendRequests(userId)]);
  return {
    friends: friends.map(toPublicUser),
    requests: {
      incoming: requests.incoming.map(toPublicUser),
      outgoing: requests.outgoing.map(toPublicUser)
    }
  };
}

async function emitFriendUpdates(io: Server, ...userIds: string[]) {
  await Promise.all(
    userIds.map(async (userId) => {
      io.to(userId).emit('messenger:friendsChanged', await friendPayload(userId));
    })
  );
}

export function createMessengerRouter(io: Server) {
  const router = Router();

  router.get(
    '/friends',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const friends = await listFriends(req.auth.userId);
      res.json({ friends: friends.map(toPublicUser) });
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
      res.json({ friends: friends.map(toPublicUser) });
    })
  );

  router.get(
    '/mutual-groups/:userId',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const userId = z.string().uuid().parse(req.params.userId);
      const groups = await getMutualGroups(req.auth.userId, userId);
      res.json({ groups: groups.map(toPublicGroup) });
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
      const target = await findUserById(userId);

      if (!target) {
        throw new HttpError(404, 'User not found', 'USER_NOT_FOUND');
      }

      await markConversationRead(req.auth.userId, userId);
      const messages = await listConversation(req.auth.userId, userId);
      res.json({ messages: messages.map(toPublicMessage) });
    })
  );

  router.get(
    '/conversations',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const conversations = await listConversationPreviews(req.auth.userId);
      res.json({
        conversations: conversations.map((conversation) => ({
          user: toPublicUser(conversation.user),
          message: toPublicMessage(conversation.message),
          unreadCount: conversation.unreadCount
        }))
      });
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

      const message = toPublicMessage(await createMessage(req.auth.userId, input.recipientId, input.body, input.image));
      io.to(input.recipientId).emit('messenger:message', { message });
      io.to(req.auth.userId).emit('messenger:message', { message });
      res.json({ message });
    })
  );

  router.patch(
    '/messages/:messageId',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const messageId = z.string().uuid().parse(req.params.messageId);
      const input = editMessageSchema.parse(req.body);
      const updated = await updateMessage(messageId, req.auth.userId, input.body);

      if (!updated) {
        throw new HttpError(403, 'Message can no longer be edited', 'MESSAGE_EDIT_FORBIDDEN');
      }

      const message = toPublicMessage(updated);
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
      const message = toPublicMessage(updated);
      io.to(updated.recipient_id).emit('messenger:messagePinned', { message });
      io.to(updated.sender_id).emit('messenger:messagePinned', { message });
      res.json({ message });
    })
  );

  return router;
}
