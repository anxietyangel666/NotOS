import bcrypt from 'bcryptjs';
import { config } from '../../config.js';
import {
  createUser,
  findUserById,
  findUserByNickname,
  toPublicUser,
  updateUserAuthSecret
} from '../../db/users.js';
import { HttpError } from '../../http/errors.js';
import { buildAuthFilename, decryptAuthFile, encryptAuthFile } from './auth-file.js';
import type { LoginInput, RecoverInput, RegisterInput } from './auth.schemas.js';
import { generateAuthSecret, generateRecoveryKey } from './secrets.js';
import { signAccessToken } from './token.js';

const AUTH_FILE_MIME = 'application/vnd.notoc.auth+json';

function isUniqueViolation(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

async function hashSecret(secret: string) {
  return bcrypt.hash(secret, config.bcryptRounds);
}

function buildAuthFile(user: { id: string; nickname: string }, authSecret: string) {
  return {
    filename: buildAuthFilename(user.nickname, user.id),
    mimeType: AUTH_FILE_MIME,
    content: encryptAuthFile({
      version: 1,
      userId: user.id,
      nickname: user.nickname,
      authSecret,
      issuedAt: new Date().toISOString()
    })
  };
}

export async function register(input: RegisterInput) {
  const recoveryKey = generateRecoveryKey();
  const authSecret = generateAuthSecret();

  try {
    const user = await createUser({
      nickname: input.nickname,
      avatarData: input.avatarData,
      language: input.language,
      theme: input.theme,
      authSecretHash: await hashSecret(authSecret),
      recoveryKeyHash: await hashSecret(recoveryKey)
    });

    return {
      token: signAccessToken(user.id),
      user: toPublicUser(user),
      recoveryKey,
      authFile: buildAuthFile(user, authSecret)
    };
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new HttpError(409, 'Nickname is already taken', 'NICKNAME_EXISTS');
    }

    throw error;
  }
}

export async function login(input: LoginInput) {
  const payload = decryptAuthFile(input.authFileContent);
  const user = await findUserById(payload.userId);

  if (!user) {
    throw new HttpError(401, 'Auth file is invalid', 'INVALID_AUTH_FILE');
  }

  const validSecret = await bcrypt.compare(payload.authSecret, user.auth_secret_hash);
  if (!validSecret) {
    throw new HttpError(401, 'Auth file was revoked or replaced', 'INVALID_AUTH_FILE');
  }

  return {
    token: signAccessToken(user.id),
    user: toPublicUser(user)
  };
}

export async function recover(input: RecoverInput) {
  const user = await findUserByNickname(input.nickname);

  if (!user) {
    throw new HttpError(401, 'Nickname or recovery key is invalid', 'RECOVERY_FAILED');
  }

  const validRecoveryKey = await bcrypt.compare(input.recoveryKey, user.recovery_key_hash);
  if (!validRecoveryKey) {
    throw new HttpError(401, 'Nickname or recovery key is invalid', 'RECOVERY_FAILED');
  }

  const authSecret = generateAuthSecret();
  const updatedUser = await updateUserAuthSecret(user.id, await hashSecret(authSecret));

  if (!updatedUser) {
    throw new HttpError(404, 'User not found', 'USER_NOT_FOUND');
  }

  return {
    token: signAccessToken(updatedUser.id),
    user: toPublicUser(updatedUser),
    authFile: buildAuthFile(updatedUser, authSecret)
  };
}
