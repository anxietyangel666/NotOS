import { Router } from 'express';
import type { Server } from 'socket.io';
import { z } from 'zod';
import { createDesktopWallMessage, deleteDesktopWallMessage, listDesktopWallMessages, type DesktopWallMessage } from '../../db/desktop-wall.js';
import { findUserById, toPublicUser } from '../../db/users.js';
import { asyncHandler } from '../../http/async-handler.js';
import { HttpError } from '../../http/errors.js';
import { type AuthenticatedRequest, requireAuth } from '../../middleware/require-auth.js';

const wallMessageSchema = z.object({
  body: z.string().trim().min(1).max(260)
});

function toPublicWallMessage(item: DesktopWallMessage) {
  return {
    id: item.message.id,
    ownerId: item.message.owner_id,
    author: toPublicUser(item.author),
    body: item.message.body,
    createdAt: item.message.created_at.toISOString()
  };
}

export function createDesktopWallRouter(io: Server) {
  const router = Router();

  router.get(
    '/:ownerId',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const ownerId = z.string().uuid().parse(req.params.ownerId);
      const owner = await findUserById(ownerId);

      if (!owner) {
        throw new HttpError(404, 'User not found', 'USER_NOT_FOUND');
      }

      const messages = await listDesktopWallMessages(ownerId);
      res.json({ messages: messages.map(toPublicWallMessage) });
    })
  );

  router.post(
    '/:ownerId',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const ownerId = z.string().uuid().parse(req.params.ownerId);
      const input = wallMessageSchema.parse(req.body);
      const owner = await findUserById(ownerId);

      if (!owner) {
        throw new HttpError(404, 'User not found', 'USER_NOT_FOUND');
      }

      const created = await createDesktopWallMessage(ownerId, req.auth.userId, input.body);

      if (!created) {
        throw new HttpError(404, 'Author not found', 'USER_NOT_FOUND');
      }

      const message = toPublicWallMessage(created);
      io.emit('desktopWall:messageCreated', { ownerId, message });
      res.json({ message });
    })
  );

  router.delete(
    '/messages/:messageId',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const messageId = z.string().uuid().parse(req.params.messageId);
      const deleted = await deleteDesktopWallMessage(messageId, req.auth.userId);

      if (!deleted) {
        throw new HttpError(403, 'Wall message cannot be deleted', 'WALL_MESSAGE_DELETE_FORBIDDEN');
      }

      io.emit('desktopWall:messageDeleted', { ownerId: deleted.owner_id, messageId: deleted.id });
      res.json({ messageId: deleted.id, ownerId: deleted.owner_id });
    })
  );

  return router;
}
