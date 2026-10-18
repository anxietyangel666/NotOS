import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import compression from 'compression';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { Server as SocketServer } from 'socket.io';
import { config } from './config.js';
import { migrate } from './db/migrate.js';
import { closePool } from './db/pool.js';
import { errorHandler, HttpError } from './http/errors.js';
import { createAiRouter } from './modules/ai/ai.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { createConnectionsRouter } from './modules/connections/connections.routes.js';
import { createDesktopWallRouter } from './modules/desktop-wall/desktop-wall.routes.js';
import { createEmojiGgRouter } from './modules/emoji-gg/emoji-gg.routes.js';
import { createGifRouter } from './modules/gifs/gif.routes.js';
import { createGroupRouter, startGroupScheduledSweeper } from './modules/messenger/group.routes.js';
import { createMessengerRouter, startExpiredMessageSweeper } from './modules/messenger/messenger.routes.js';
import { createStorageRouter } from './modules/storage/storage.routes.js';
import { createUserRouter } from './modules/users/user.routes.js';
import { uploadRoot } from './modules/messenger/upload-storage.js';
import { setupRealtime } from './realtime/socket.js';

async function main() {
  await migrate();

  const app = express();
  // Exactly one proxy hop in front of us (Railway's edge). `true` would trust
  // arbitrary X-Forwarded-For chains, letting clients spoof their IP and dodge
  // per-IP rate limits.
  app.set('trust proxy', 1);
  app.set('etag', false);
  const httpServer = createServer(app);
  const allowOrigin = (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => {
    if (
      !origin ||
      config.clientOrigins.includes(origin) ||
      /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(origin)
    ) {
      callback(null, true);
      return;
    }

    callback(new Error('CORS origin is not allowed'));
  };
  const io = new SocketServer(httpServer, {
    maxHttpBufferSize: 32 * 1024 * 1024,
    cors: {
      origin: allowOrigin,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE']
    }
  });

  setupRealtime(io);
  startExpiredMessageSweeper(io);
  startGroupScheduledSweeper(io);

  app.use(
    helmet({
      // The Electron renderer loads /uploads images from a different origin
      // (file:// in packaged builds, the Vite origin in dev), so the default
      // same-origin CORP would block every chat image.
      crossOriginResourcePolicy: { policy: 'cross-origin' }
    })
  );
  app.use(
    cors({
      origin: allowOrigin,
      maxAge: 600
    })
  );

  const rateLimitedResponse = { code: 'RATE_LIMITED', message: 'Too many requests, slow down' };
  // Auth endpoints are the brute-force surface (password login, recovery-key
  // guessing) and each attempt costs a bcrypt compare, so keep this tight.
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: rateLimitedResponse
  });
  // AI endpoints proxy a paid Groq API; the per-day quota caps volume, this
  // caps burst speed.
  const aiLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: rateLimitedResponse
  });
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  // Gzip every response above ~1 KB. API payloads are JSON full of base64
  // (avatars, images, GIFs) which compress extremely well — typically 70-85%
  // smaller — so this is the single biggest transfer-size win for the wall,
  // chats and group data. level 6 is the balanced default (fast + strong).
  app.use(
    compression({
      threshold: 1024,
      level: 6
    })
  );
  app.use(express.json({ limit: '100mb' }));
  app.use('/uploads', express.static(uploadRoot, {
    fallthrough: false,
    maxAge: '30d',
    immutable: true
  }));

  const updatesDir = path.join(process.cwd(), 'updates');
  await fs.mkdir(updatesDir, { recursive: true });
  app.use('/updates', express.static(updatesDir, {
    fallthrough: false,
    maxAge: 0,
    etag: false
  }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/api/client/update', async (req, res) => {
    try {
      const versionFile = path.join(updatesDir, 'version.json');
      const content = await fs.readFile(versionFile, 'utf8');
      const manifest = JSON.parse(content);
      const host = req.get('host') || 'notos.tech';
      const proto = (req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0].trim();
      const baseUrl = `${proto}://${host}`;

      if (manifest.url && !manifest.url.startsWith('http://') && !manifest.url.startsWith('https://')) {
        manifest.url = `${baseUrl}${manifest.url.startsWith('/') ? '' : '/'}${manifest.url}`;
      }
      if (manifest.bundleUrl && !manifest.bundleUrl.startsWith('http://') && !manifest.bundleUrl.startsWith('https://')) {
        manifest.bundleUrl = `${baseUrl}${manifest.bundleUrl.startsWith('/') ? '' : '/'}${manifest.bundleUrl}`;
      }
      if (manifest.installerUrl && !manifest.installerUrl.startsWith('http://') && !manifest.installerUrl.startsWith('https://')) {
        manifest.installerUrl = `${baseUrl}${manifest.installerUrl.startsWith('/') ? '' : '/'}${manifest.installerUrl}`;
      }

      // If client explicitly requests bundle via query ?type=bundle or header, provide bundleUrl as url
      // Otherwise, default url to installerUrl so older clients or browser downloads get the executable installer instead of a raw zip
      const wantsBundle = req.query.type === 'bundle' || req.get('x-update-type') === 'bundle';
      if (!wantsBundle && manifest.installerUrl) {
        manifest.bundleUrl = manifest.bundleUrl || manifest.url;
        manifest.url = manifest.installerUrl;
      } else if (wantsBundle && manifest.bundleUrl) {
        manifest.url = manifest.bundleUrl;
      }

      return res.json(manifest);
    } catch {
      return res.json({
        version: config.clientUpdateVersion,
        url: config.clientUpdateUrl,
        notes: config.clientUpdateNotes,
        required: config.clientUpdateRequired,
        publishedAt: config.clientUpdatePublishedAt
      });
    }
  });

  app.use('/api/auth', authLimiter, authRouter);
  app.use('/api/connections', createConnectionsRouter(io));
  app.use('/api/users', createUserRouter(io));
  app.use('/api/messenger', createMessengerRouter(io));
  app.use('/api/messenger', createGroupRouter(io));
  app.use('/api/desktop-wall', createDesktopWallRouter(io));
  app.use('/api/storage', createStorageRouter(io));
  app.use('/api/ai', aiLimiter, createAiRouter());
  app.use('/api/emoji-gg', createEmojiGgRouter());
  app.use('/api/gifs', createGifRouter());

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
