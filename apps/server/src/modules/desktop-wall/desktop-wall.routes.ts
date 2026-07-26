import { Router } from 'express';
import type { Server } from 'socket.io';
import { z } from 'zod';
import { createDesktopWallMessage, deleteDesktopWallMessage, listDesktopWallMessages, type DesktopWallMessage } from '../../db/desktop-wall.js';
import { toPublicUserLite, userExistsById } from '../../db/users.js';
import { asyncHandler } from '../../http/async-handler.js';
import { HttpError } from '../../http/errors.js';
import { type AuthenticatedRequest, requireAuth } from '../../middleware/require-auth.js';

const wallMessageSchema = z.object({
  body: z.string().trim().min(1).max(260)
});

const WALL_URL_RE = /https?:\/\/[^\s<>"')]+/gi;
const WALL_CUSTOM_EMOJI_RE = /<ce:[^:>\s]+:(?:(?:https?:\/\/|data:image\/(?:png|gif|jpe?g|webp);base64,)[^\s<>]+)>/gi;
const WALL_PACK_LINK_RE = /cep_[A-Za-z0-9_-]+/;
const WALL_GROUP_INVITE_RE = /(?:gc_[A-Za-z0-9]{12})|(?:notoc:\/\/invite\/gc_[A-Za-z0-9]{12})|(?:\/g\/gc_[A-Za-z0-9]{12})|(?:[?&](?:g|invite)=gc_[A-Za-z0-9]{12})/;
const WALL_WATCH_INVITE_RE = /(?:\[watch:[A-Za-z0-9_-]{10}\])|(?:[?&]watch=[A-Za-z0-9_-]{10})|(?:\/watch\/[A-Za-z0-9_-]{10})/;
const WALL_PROFILE_LINK_RE = /(?:np_[0-9a-fA-F-]{36})|(?:\/p\/[0-9a-fA-F-]{36})|(?:[?&]p=[0-9a-fA-F-]{36})/;
const WALL_MEDIA_HOSTS = [
  'tenor.com',
  'media.tenor.com',
  'c.tenor.com',
  'media1.tenor.com',
  'giphy.com',
  'media.giphy.com',
  'media0.giphy.com',
  'media1.giphy.com',
  'media2.giphy.com',
  'media3.giphy.com',
  'media4.giphy.com',
  'i.giphy.com'
];
const WALL_IMAGE_EXT_RE = /\.(gif|png|jpe?g|webp|avif|bmp|svg)(\?|#|$)/i;

function isWallMediaUrl(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  if (WALL_MEDIA_HOSTS.some((media) => host === media || host.endsWith(`.${media}`))) return true;
  return WALL_IMAGE_EXT_RE.test(parsed.pathname) || WALL_IMAGE_EXT_RE.test(parsed.href);
}

function wallMessageContainsEmbed(body: string) {
  if (WALL_PACK_LINK_RE.test(body) || WALL_GROUP_INVITE_RE.test(body) || WALL_WATCH_INVITE_RE.test(body) || WALL_PROFILE_LINK_RE.test(body)) return true;
  const withoutCustomEmoji = body.replace(WALL_CUSTOM_EMOJI_RE, '');
  WALL_URL_RE.lastIndex = 0;
  return Array.from(withoutCustomEmoji.matchAll(WALL_URL_RE), (match) => match[0].replace(/[),.;!?]+$/g, '')).some(isWallMediaUrl);
}

function toPublicWallMessage(item: DesktopWallMessage) {
  return {
    id: item.message.id,
    ownerId: item.message.owner_id,
    author: toPublicUserLite(item.author),
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
      // `before` is an optional message-id cursor for loading older pages as
      // the user scrolls. `limit` lets the client tune the page size.
      const query = z
        .object({
          before: z.string().uuid().optional(),
          limit: z.coerce.number().int().min(1).max(60).optional()
        })
        .parse(req.query);
      const ownerExists = await userExistsById(ownerId);

      if (!ownerExists) {
        throw new HttpError(404, 'User not found', 'USER_NOT_FOUND');
      }

      const { messages, hasMore } = await listDesktopWallMessages(ownerId, {
        before: query.before,
        limit: query.limit
      });
      res.json({ messages: messages.map(toPublicWallMessage), hasMore });
    })
  );

  router.post(
    '/:ownerId',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const ownerId = z.string().uuid().parse(req.params.ownerId);
      const input = wallMessageSchema.parse(req.body);
      if (wallMessageContainsEmbed(input.body)) {
        throw new HttpError(400, 'Embeds cannot be posted on the desktop wall', 'WALL_EMBEDS_NOT_ALLOWED');
      }
      const ownerExists = await userExistsById(ownerId);

      if (!ownerExists) {
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
