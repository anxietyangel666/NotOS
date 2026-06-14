import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { config } from '../../config.js';

function storageKey(userId: string) {
  return createHash('sha256').update(`${config.authFileSecret}:storage:${userId}`).digest();
}

function toBase64Url(value: Buffer) {
  return value.toString('base64url');
}

function fromBase64Url(value: string) {
  return Buffer.from(value, 'base64url');
}

export function encryptStorageJson(userId: string, value: unknown) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', storageKey(userId), iv);
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  return {
    iv: toBase64Url(iv),
    tag: toBase64Url(cipher.getAuthTag()),
    ciphertext: toBase64Url(ciphertext)
  };
}

export function decryptStorageJson<T>(userId: string, encrypted: { iv: string; tag: string; ciphertext: string }) {
  const decipher = createDecipheriv('aes-256-gcm', storageKey(userId), fromBase64Url(encrypted.iv));
  decipher.setAuthTag(fromBase64Url(encrypted.tag));
  const plaintext = Buffer.concat([
    decipher.update(fromBase64Url(encrypted.ciphertext)),
    decipher.final()
  ]).toString('utf8');

  return JSON.parse(plaintext) as T;
}
