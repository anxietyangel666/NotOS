import { z } from 'zod';

const nicknameSchema = z
  .string()
  .trim()
  .min(2, 'Nickname must be at least 2 characters')
  .max(24, 'Nickname must be at most 24 characters')
  .regex(/^[\p{L}\p{N}_.-]+$/u, 'Use letters, numbers, dot, dash or underscore');

const loginNameSchema = z
  .string()
  .trim()
  .min(3, 'Login must be at least 3 characters')
  .max(32, 'Login must be at most 32 characters')
  .regex(/^[A-Za-z0-9_.-]+$/, 'Use latin letters, numbers, dot, dash or underscore');

const avatarDataSchema = z
  .string()
  .min(20)
  .max(1_200_000, 'Avatar is too large')
  .refine((value) => value.startsWith('data:image/'), 'Avatar must be an image');

const passwordSchema = z
  .string()
  .min(6, 'Password must be at least 6 characters')
  .max(128, 'Password must be at most 128 characters');

export const registerSchema = z.object({
  nickname: nicknameSchema,
  avatarData: avatarDataSchema,
  language: z.enum(['en', 'ru', 'uk']).optional(),
  theme: z.enum(['light', 'dark', 'system-black', 'mint', 'ocean']).optional()
});

export const passwordRegisterSchema = registerSchema.extend({
  login: loginNameSchema,
  email: z.string().trim().email('Email is invalid').max(254),
  password: passwordSchema
}).omit({ nickname: true });

export const loginSchema = z.object({
  authFileContent: z.string().min(16).max(100_000)
});

export const passwordLoginSchema = z.object({
  login: loginNameSchema,
  password: passwordSchema
});

export const recoverSchema = z.object({
  nickname: nicknameSchema,
  recoveryKey: z
    .string()
    .transform((value) => value.replace(/[\s-]/g, '').toUpperCase())
    .pipe(z.string().length(32).regex(/^[A-Z2-9]+$/))
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type PasswordRegisterInput = z.infer<typeof passwordRegisterSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type PasswordLoginInput = z.infer<typeof passwordLoginSchema>;
export type RecoverInput = z.infer<typeof recoverSchema>;
