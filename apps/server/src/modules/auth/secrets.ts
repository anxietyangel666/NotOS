import { randomBytes, randomInt } from 'node:crypto';

const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateRecoveryKey() {
  let key = '';
  for (let index = 0; index < 32; index += 1) {
    key += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
  }
  return key;
}

export function generateAuthSecret() {
  return randomBytes(32).toString('base64url');
}
