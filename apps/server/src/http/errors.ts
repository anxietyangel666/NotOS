import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = 'HTTP_ERROR'
  ) {
    super(message);
  }
}

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (typeof error === 'object' && error && 'type' in error && error.type === 'entity.too.large') {
    res.status(413).json({ code: 'PAYLOAD_TOO_LARGE', message: 'Payload is too large' });
    return;
  }

  if (typeof error === 'object' && error && 'status' in error && error.status === 413) {
    res.status(413).json({ code: 'PAYLOAD_TOO_LARGE', message: 'Payload is too large' });
    return;
  }

  if (error instanceof ZodError) {
    res.status(400).json({
      code: 'VALIDATION_ERROR',
      message: 'Invalid request data',
      issues: error.issues
    });
    return;
  }

  if (error instanceof HttpError) {
    res.status(error.status).json({ code: error.code, message: error.message });
    return;
  }

  console.error(error);
  res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Internal server error' });
};
