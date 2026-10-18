import { Router } from 'express';
import type { Server } from 'socket.io';
import { z } from 'zod';
import { findUserById, searchUsersByNickname, toPublicUser, toPublicUserLite, updateUserSettings } from '../../db/users.js';
import { asyncHandler } from '../../http/async-handler.js';
import { HttpError } from '../../http/errors.js';
import { type AuthenticatedRequest, requireAuth } from '../../middleware/require-auth.js';

function isSafeWallpaper(value: string) {
  return (
    value === '' ||
    value.startsWith('data:image/') ||
    value.startsWith('linear-gradient(') ||
    value.startsWith('radial-gradient(')
  );
}

function isUniqueViolation(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

function stripNulls<T extends Record<string, unknown>>(value: T): T {
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    if (val !== null) {
      if (typeof val === 'object' && !Array.isArray(val)) {
        result[key] = stripNulls(val as Record<string, unknown>);
      } else {
        result[key] = val;
      }
    }
  }
  return result as T;
}

const nicknameSchema = z
  .string()
  .trim()
  .min(2)
  .max(24)
  .regex(/^[\p{L}\p{N}_.-]+$/u);

const avatarDataSchema = z
  .string()
  .min(20)
  .max(1_200_000)
  .refine((value) => value.startsWith('data:image/'));

const updateUserSchema = z
  .object({
    nickname: nicknameSchema.optional(),
    avatarData: avatarDataSchema.optional(),
    wallpaper: z.string().max(16_000_000).optional(),
    language: z.enum(['en', 'ru', 'uk', 'zh', 'zh-TW']).optional(),
    theme: z.enum(['light', 'dark', 'system-black', 'mint', 'ocean']).optional(),
    accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
    transparencyEnabled: z.boolean().optional(),
    desktopIcons: z
      .preprocess(
        (value) => {
          if (typeof value !== 'object' || value === null) return value;
          const record = value as Record<string, unknown>;
          const cleaned: Record<string, unknown> = {};
          for (const [key, icon] of Object.entries(record)) {
            if (typeof icon === 'object' && icon !== null && !Array.isArray(icon)) {
              cleaned[key] = stripNulls(icon as Record<string, unknown>);
            } else {
              cleaned[key] = icon;
            }
          }
          return cleaned;
        },
        z.record(
          z.object({
            x: z.number().min(0).max(5000),
            y: z.number().min(0).max(5000),
            kind: z.enum(['app', 'storage-item', 'remote-desktop']).optional(),
            storageItemId: z.string().max(120).optional(),
            remoteUserId: z.string().uuid().optional(),
            label: z.string().max(240).optional(),
            itemType: z.enum(['folder', 'text', 'file']).optional(),
            size: z.number().min(0).max(160_000_000).optional(),
            updatedAt: z.string().datetime().optional()
          })
        )
      )
      .optional(),
    desktopIconSize: z.enum(['small', 'medium', 'large']).optional(),
    hideDesktopIcons: z.boolean().optional(),
    desktopSort: z.enum(['custom', 'name', 'type', 'size', 'date']).optional(),
    status: z.string().trim().max(200).optional(),
    voiceBio: z.string().max(20_000_000).nullable().optional(),
    allowGroupIdentityMessages: z.boolean().optional(),
    pinnedImageData: z.string().max(80_000_000).optional(),
    pinnedCards: z
      .array(
        z.object({
          id: z.string().max(120),
          imageData: z
            .string()
            .max(210_000_000)
            .refine((value) => value.startsWith('data:image/') || value.startsWith('data:video/'), {
              message: 'Pinned card media must be an image or video data URL'
            }),
          name: z.string().max(240),
          kind: z.enum(['image', 'video']).optional(),
          x: z.number().min(0).max(1),
          y: z.number().min(0).max(1),
          width: z.number().min(80).max(4000),
          height: z.number().min(60).max(4000)
        })
      )
      .max(50)
      .optional(),
    nameStyle: z
      .object({
        font: z.string().max(40),
        effect: z.string().max(40),
        color: z.string().regex(/^#[0-9A-Fa-f]{6}$/)
      })
      .nullable()
      .optional(),
    profilePrimaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
    profileAccentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
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
      .optional(),
  })
  .refine((value) => value.wallpaper === undefined || isSafeWallpaper(value.wallpaper), {
    path: ['wallpaper'],
    message: 'Wallpaper must be an image or safe CSS gradient'
  });

export function createUserRouter(io: Server) {
  const router = Router();

  router.get(
    '/me',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const user = await findUserById(req.auth.userId);

      if (!user) {
        throw new HttpError(404, 'User not found', 'USER_NOT_FOUND');
      }

      res.json({ user: toPublicUser(user) });
    })
  );

  router.get(
    '/search',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const nickname = z.string().trim().max(24).parse(req.query.nickname ?? '');
      const users = await searchUsersByNickname(nickname, req.auth.userId);
      res.json({ users: users.map(toPublicUserLite) });
    })
  );

  router.get(
    '/:userId/public',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const userId = z.string().uuid().parse(req.params.userId);
      const user = await findUserById(userId);

      if (!user) {
        throw new HttpError(404, 'User not found', 'USER_NOT_FOUND');
      }

      res.json({ user: toPublicUser(user) });
    })
  );

  router.patch(
    '/me',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const input = updateUserSchema.parse(req.body);
      let updatedUser;

      try {
        updatedUser = await updateUserSettings(req.auth.userId, input);
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new HttpError(409, 'Nickname is already taken', 'NICKNAME_EXISTS');
        }

        throw error;
      }

      if (!updatedUser) {
        throw new HttpError(404, 'User not found', 'USER_NOT_FOUND');
      }

      const user = toPublicUser(updatedUser);
      io.to(updatedUser.id).emit('desktop:settingsChanged', { user });
      io.emit('desktop:userChanged', { user });
      res.json({ user });
    })
  );

  return router;
}
