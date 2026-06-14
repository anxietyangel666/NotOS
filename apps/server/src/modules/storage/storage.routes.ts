import { Router } from 'express';
import type { Server } from 'socket.io';
import { z } from 'zod';
import { findEncryptedStorage, upsertEncryptedStorage } from '../../db/virtual-storage.js';
import { asyncHandler } from '../../http/async-handler.js';
import { type AuthenticatedRequest, requireAuth } from '../../middleware/require-auth.js';
import { decryptStorageJson, encryptStorageJson } from './storage-crypto.js';

const storageItemSchema = z.object({
  id: z.string().min(1).max(80),
  type: z.enum(['folder', 'text', 'file']),
  name: z.string().min(1).max(240),
  parentId: z.string().nullable(),
  content: z.string().max(210_000_000).optional(),
  mimeType: z.string().max(120).optional(),
  size: z.number().min(0).max(157_286_400).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

const storageSchema = z.object({
  items: z.array(storageItemSchema)
});

function initialStorage() {
  const now = new Date().toISOString();
  return {
    items: [
      {
        id: 'system-desktop',
        type: 'folder' as const,
        name: 'Desktop',
        parentId: null,
        createdAt: now,
        updatedAt: now
      },
      {
        id: 'welcome-note',
        type: 'text' as const,
        name: 'Welcome.txt',
        parentId: null,
        content: 'Encrypted virtual storage is ready.',
        createdAt: now,
        updatedAt: now
      }
    ]
  };
}

export function createStorageRouter(io: Server) {
  const router = Router();

  router.get(
    '/public-audio/:userId',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const userId = z.string().uuid().parse(req.params.userId);
      const encrypted = await findEncryptedStorage(userId);

      if (!encrypted) {
        res.json({ tracks: [] });
        return;
      }

      const payload = decryptStorageJson<{ items: Array<{ id: string; type: string; name: string; content?: string; mimeType?: string; size?: number; updatedAt?: string }> }>(userId, encrypted);
      const tracks = payload.items
        .filter((item) => item.type === 'file' && (item.mimeType?.startsWith('audio/') || item.content?.startsWith('data:audio/')) && item.content)
        .map((item) => ({ id: item.id, name: item.name, dataUrl: item.content, mimeType: item.mimeType, size: item.size, updatedAt: item.updatedAt }));

      res.json({ tracks });
    })
  );

  router.get(
    '/',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const encrypted = await findEncryptedStorage(req.auth.userId);

      if (!encrypted) {
        const payload = initialStorage();
        await upsertEncryptedStorage(req.auth.userId, encryptStorageJson(req.auth.userId, payload));
        res.json(payload);
        return;
      }

      res.json(decryptStorageJson(req.auth.userId, encrypted));
    })
  );

  router.put(
    '/',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const input = storageSchema.parse(req.body);

      await upsertEncryptedStorage(req.auth.userId, encryptStorageJson(req.auth.userId, input));
      io.to(req.auth.userId).emit('storage:changed', input);
      io.emit('storage:publicChanged', { userId: req.auth.userId });
      res.json(input);
    })
  );

  return router;
}
