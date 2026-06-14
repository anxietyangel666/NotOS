import type { NextFunction, Request, Response } from 'express';
import { HttpError } from '../http/errors.js';
import { verifyAccessToken } from '../modules/auth/token.js';

export type AuthenticatedRequest = Request & {
  auth: {
    userId: string;
  };
};

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.header('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;

  if (!token) {
    next(new HttpError(401, 'Authorization required', 'UNAUTHORIZED'));
    return;
  }

  const payload = verifyAccessToken(token);
  if (!payload) {
    next(new HttpError(401, 'Session is invalid', 'UNAUTHORIZED'));
    return;
  }

  (req as AuthenticatedRequest).auth = payload;
  next();
}
