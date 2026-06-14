import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { config } from '../../config.js';
import { HttpError } from '../../http/errors.js';

const encryptedAuthFileSchema = z.object({
  type: z.literal('notoc.auth-file'),
  version: z.literal(1),
  algorithm: z.literal('aes-256-gcm'),
  iv: z.string().min(1),
  tag: z.string().min(1),
  ciphertext: z.string().min(1)
});

const authFilePayloadSchema = z.object({
  version: z.literal(1),
  userId: z.string().uuid(),
  nickname: z.string().min(1),
  authSecret: z.string().min(32),
  issuedAt: z.string().datetime()
});

export type AuthFilePayload = z.infer<typeof authFilePayloadSchema>;

function encryptionKey() {
  return createHash('sha256').update(config.authFileSecret).digest();
}

function fromBase64Url(value: string) {
  return Buffer.from(value, 'base64url');
}

function toBase64Url(value: Buffer) {
  return value.toString('base64url');
}

export function encryptAuthFile(payload: AuthFilePayload) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return JSON.stringify(
    {
      type: 'notoc.auth-file',
      version: 1,
      algorithm: 'aes-256-gcm',
      iv: toBase64Url(iv),
      tag: toBase64Url(tag),
      ciphertext: toBase64Url(ciphertext)
    },
    null,
    2
  );
}

export function decryptAuthFile(content: string): AuthFilePayload {
  let parsed: unknown;

  try {
    parsed = JSON.parse(content);
  } catch {
    throw new HttpError(400, 'Auth file must be a JSON file', 'INVALID_AUTH_FILE');
  }

  const encrypted = encryptedAuthFileSchema.safeParse(parsed);
  if (!encrypted.success) {
    throw new HttpError(400, 'Auth file format is not supported', 'INVALID_AUTH_FILE');
  }

  try {
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), fromBase64Url(encrypted.data.iv));
    decipher.setAuthTag(fromBase64Url(encrypted.data.tag));
    const plaintext = Buffer.concat([
      decipher.update(fromBase64Url(encrypted.data.ciphertext)),
      decipher.final()
    ]).toString('utf8');
    const payload = authFilePayloadSchema.safeParse(JSON.parse(plaintext));

    if (!payload.success) {
      throw new Error('Invalid payload');
    }

    return payload.data;
  } catch {
    throw new HttpError(401, 'Auth file is damaged or does not belong to this server', 'INVALID_AUTH_FILE');
  }
}

export function buildAuthFilename(nickname: string, userId: string) {
  const safeNickname = nickname
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  const safePart = safeNickname || 'user';
  const date = new Date().toISOString().slice(0, 10);

  return `notoc-${safePart}-${userId.slice(0, 8)}-${date}.auth.json`;
}
