import { createServer } from 'node:http';
import cors from 'cors';
import express from 'express';
import { Server as SocketServer } from 'socket.io';
import { config } from './config.js';
import { migrate } from './db/migrate.js';
import { closePool } from './db/pool.js';
import { errorHandler, HttpError } from './http/errors.js';
import { createAiRouter } from './modules/ai/ai.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { createDesktopWallRouter } from './modules/desktop-wall/desktop-wall.routes.js';
import { createGroupRouter } from './modules/messenger/group.routes.js';
import { createMessengerRouter } from './modules/messenger/messenger.routes.js';
import { createStorageRouter } from './modules/storage/storage.routes.js';
import { createUserRouter } from './modules/users/user.routes.js';
import { setupRealtime } from './realtime/socket.js';

async function main() {
  await migrate();

  const app = express();
  const httpServer = createServer(app);
  const allowOrigin = (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => {
    if (!origin || config.clientOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error('CORS origin is not allowed'));
  };
  const io = new SocketServer(httpServer, {
    cors: {
      origin: allowOrigin,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE']
    }
  });

  setupRealtime(io);

  app.use(
    cors({
      origin: allowOrigin
    })
  );
  app.use(express.json({ limit: '1024mb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/users', createUserRouter(io));
  app.use('/api/messenger', createMessengerRouter(io));
  app.use('/api/messenger', createGroupRouter(io));
  app.use('/api/desktop-wall', createDesktopWallRouter(io));
  app.use('/api/storage', createStorageRouter(io));
  app.use('/api/ai', createAiRouter());

  app.use((_req, _res, next) => {
    next(new HttpError(404, 'Route not found', 'NOT_FOUND'));
  });
  app.use(errorHandler);

  httpServer.listen(config.port, () => {
    console.log(`NotOS API listening on :${config.port}`);
  });

  const shutdown = async () => {
    httpServer.close();
    await closePool();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
