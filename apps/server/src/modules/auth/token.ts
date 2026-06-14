import jwt from 'jsonwebtoken';
import { config } from '../../config.js';

type AccessTokenPayload = {
  sub: string;
};

export function signAccessToken(userId: string) {
  return jwt.sign({ sub: userId } satisfies AccessTokenPayload, config.jwtSecret, { expiresIn: '7d' });
}

export function verifyAccessToken(token: string) {
  try {
    const payload = jwt.verify(token, config.jwtSecret) as AccessTokenPayload;
    if (!payload.sub) return null;
    return { userId: payload.sub };
  } catch {
    return null;
  }
}
