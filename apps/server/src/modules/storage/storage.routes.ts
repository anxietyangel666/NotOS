import { Router } from 'express';
import type { Server } from 'socket.io';
import { z } from 'zod';
import { config } from '../../config.js';
import { findEncryptedStorage, upsertEncryptedStorage } from '../../db/virtual-storage.js';
import {
  addUserMusicTrack,
  deleteUserMusicTrack,
  listUserMusicTracks,
  reorderUserMusicTracks
} from '../../db/user-music.js';
import { asyncHandler } from '../../http/async-handler.js';
import { type AuthenticatedRequest, requireAuth } from '../../middleware/require-auth.js';
import { decryptStorageJson, encryptStorageJson } from './storage-crypto.js';
import { saveAudioDataUrl } from './audio-storage.js';

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

const uploadAudioSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(240),
  dataUrl: z.string().min(1)
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

      const dbTracks = await listUserMusicTracks(userId);
      if (dbTracks.length > 0) {
        const tracks = dbTracks.map((t) => ({
          id: t.id,
          name: t.name,
          dataUrl: t.dataUrl.startsWith('/') ? `${config.publicApiUrl}${t.dataUrl}` : t.dataUrl,
          mimeType: t.mimeType,
          size: t.size,
          updatedAt: t.createdAt
        }));
        res.json({ tracks });
        return;
      }

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
    '/audio',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const dbTracks = await listUserMusicTracks(req.auth.userId);
      const tracks = dbTracks.map((t) => ({
        id: t.id,
        name: t.name,
        dataUrl: t.dataUrl.startsWith('/') ? `${config.publicApiUrl}${t.dataUrl}` : t.dataUrl,
        mimeType: t.mimeType,
        size: t.size,
        updatedAt: t.createdAt
      }));
      res.json({ tracks });
    })
  );

  router.post(
    '/audio',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const input = uploadAudioSchema.parse(req.body);
      let fileUrl = input.dataUrl;
      let mimeType = 'audio/mpeg';
      let size = 0;

      if (input.dataUrl.startsWith('data:')) {
        const saved = await saveAudioDataUrl(input.dataUrl, input.name);
        fileUrl = saved.urlPath;
        mimeType = saved.mimeType;
        size = saved.size;
      }

      const track = await addUserMusicTrack(req.auth.userId, {
        id: input.id,
        name: input.name,
        url: fileUrl,
        mimeType,
        size
      });

      const publicTrack = {
        id: track.id,
        name: track.name,
        dataUrl: track.dataUrl.startsWith('/') ? `${config.publicApiUrl}${track.dataUrl}` : track.dataUrl,
        mimeType: track.mimeType,
        size: track.size,
        updatedAt: track.createdAt
      };

      io.emit('storage:publicChanged', { userId: req.auth.userId });
      res.json({ track: publicTrack });
    })
  );

  router.delete(
    '/audio/:trackId',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const trackId = z.string().uuid().parse(req.params.trackId);
      await deleteUserMusicTrack(req.auth.userId, trackId);
      io.emit('storage:publicChanged', { userId: req.auth.userId });
      res.json({ ok: true });
    })
  );

  router.put(
    '/audio/order',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const { trackIds } = z.object({ trackIds: z.array(z.string().uuid()) }).parse(req.body);
      await reorderUserMusicTracks(req.auth.userId, trackIds);
      io.emit('storage:publicChanged', { userId: req.auth.userId });
      res.json({ ok: true });
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
