import { Router } from 'express';
import { asyncHandler } from '../../http/async-handler.js';
import { loginSchema, recoverSchema, registerSchema } from './auth.schemas.js';
import { login, recover, register } from './auth.service.js';

export const authRouter = Router();

authRouter.post(
  '/register',
  asyncHandler(async (req, res) => {
    const input = registerSchema.parse(req.body);
    const result = await register(input);
    res.status(201).json(result);
  })
);

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const input = loginSchema.parse(req.body);
    const result = await login(input);
    res.json(result);
  })
);

authRouter.post(
  '/recover',
  asyncHandler(async (req, res) => {
    const input = recoverSchema.parse(req.body);
    const result = await recover(input);
    res.json(result);
  })
);
