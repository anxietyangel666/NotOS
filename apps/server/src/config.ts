import 'dotenv/config';

function readNumber(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a number`);
  }

  return parsed;
}

function readRequiredInProduction(name: string, fallback: string) {
  const value = process.env[name];
  if (value) return value;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`${name} is required in production`);
  }
  return fallback;
}

function normalizeUrl(value: string) {
  return value.replace(/\/+$/, '');
}

function encodeConnectionPart(value: string) {
  return encodeURIComponent(value);
}

function readDatabaseUrl() {
  const direct =
    process.env.DATABASE_URL ||
    process.env.DATABASE_PUBLIC_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PUBLIC_URL;
  if (direct) return direct;

  const host = process.env.PGHOST || process.env.POSTGRES_HOST;
  const port = process.env.PGPORT || process.env.POSTGRES_PORT || '5432';
  const user = process.env.PGUSER || process.env.POSTGRES_USER;
  const password = process.env.PGPASSWORD || process.env.POSTGRES_PASSWORD;
  const database = process.env.PGDATABASE || process.env.POSTGRES_DB || 'railway';

  if (host && user && password) {
    return `postgresql://${encodeConnectionPart(user)}:${encodeConnectionPart(password)}@${host}:${port}/${encodeConnectionPart(database)}`;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Postgres connection is missing. Set DATABASE_URL on the server service, or provide PGHOST, PGPORT, PGUSER, PGPASSWORD and PGDATABASE.'
    );
  }

  return 'postgresql://notoc:notoc@localhost:5432/notoc';
}

export const config = {
  port: readNumber('PORT', 4000),
  clientOrigins: (process.env.CLIENT_ORIGINS ?? process.env.CLIENT_ORIGIN ?? 'http://localhost:5173,http://127.0.0.1:5173,file://,null')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  databaseUrl: readDatabaseUrl(),
  publicApiUrl: normalizeUrl(
    process.env.PUBLIC_API_URL ||
    process.env.SERVER_PUBLIC_URL ||
    process.env.VITE_API_URL ||
    (process.env.NODE_ENV === 'production'
      ? 'https://server-production-23e35.up.railway.app'
      : `http://localhost:${readNumber('PORT', 4000)}`)
  ),
  // Both secrets are hard-fail in production: a leaked-by-default JWT secret
  // lets anyone forge a session token, and a default auth-file secret makes
  // every user's encrypted auth file decryptable by anyone with the source.
  jwtSecret: readRequiredInProduction('JWT_SECRET', 'dev-jwt-secret-change-me'),
  authFileSecret: readRequiredInProduction('AUTH_FILE_SECRET', 'dev-auth-file-secret-change-me'),
  bcryptRounds: readNumber('BCRYPT_ROUNDS', 12),
  // AI Provider Configuration (AnyModel)
  // Provider ID: anymodel, Base URL: https://anymodel.org/v1, Model: gcli/grok-4.7
  aiProvider: process.env.AI_PROVIDER ?? 'anymodel',
  aiApiKey: process.env.ANYMODEL_API_KEY ?? process.env.AI_API_KEY ?? 'sk-dc9d4b7df36ba555-q1c1pw-21b7fd37',
  aiBaseUrl: normalizeUrl(process.env.ANYMODEL_BASE_URL ?? process.env.AI_BASE_URL ?? 'https://anymodel.org/v1'),
  aiChatEndpoint: `${normalizeUrl(process.env.ANYMODEL_BASE_URL ?? process.env.AI_BASE_URL ?? 'https://anymodel.org/v1')}/chat/completions`,
  aiModel: process.env.ANYMODEL_MODEL ?? process.env.AI_MODEL ?? 'gcli/grok-4.7',
  aiTranslateModel: process.env.ANYMODEL_TRANSLATE_MODEL ?? process.env.AI_TRANSLATE_MODEL ?? 'ag/gemini-3.7-flash-low',

  // Backward compatibility getters
  get groqApiKey(): string {
    return this.aiApiKey;
  },
  get groqModel(): string {
    return this.aiModel;
  },
  get groqTranslateModel(): string {
    return this.aiTranslateModel;
  },
  // Speech-to-text model for voice message transcription.
  groqWhisperModel: process.env.GROQ_WHISPER_MODEL ?? 'whisper-large-v3-turbo',
  // Daily AI request quota for regular users (Dev users are unlimited).
  aiDailyRequestLimit: readNumber('AI_DAILY_REQUEST_LIMIT', 40),
  tenorApiKey: process.env.TENOR_KEY ?? process.env.VITE_TENOR_KEY ?? 'AIzaSyAyimkuYQYF_FXVALexPuGQctUWRURdCYQ',
  giphyApiKey: process.env.GIPHY_KEY ?? process.env.VITE_GIPHY_KEY ?? 'dc6zaTOxFJmzC',
  spotifyClientId: process.env.SPOTIFY_CLIENT_ID ?? '',
  spotifyClientSecret: process.env.SPOTIFY_CLIENT_SECRET ?? '',
  spotifyRedirectUri: process.env.SPOTIFY_REDIRECT_URI ?? `${normalizeUrl(
    process.env.PUBLIC_API_URL ||
    process.env.SERVER_PUBLIC_URL ||
    process.env.VITE_API_URL ||
    (process.env.NODE_ENV === 'production'
      ? 'https://server-production-23e35.up.railway.app'
      : `http://localhost:${readNumber('PORT', 4000)}`)
  )}/api/connections/spotify/callback`,
  riotApiKey: process.env.RIOT_API_KEY ?? '',
  clientUpdateVersion: process.env.CLIENT_UPDATE_VERSION ?? '',
  clientUpdateUrl: process.env.CLIENT_UPDATE_URL ?? '',
  clientUpdateNotes: process.env.CLIENT_UPDATE_NOTES ?? '',
  clientUpdateRequired: process.env.CLIENT_UPDATE_REQUIRED === 'true',
  clientUpdatePublishedAt: process.env.CLIENT_UPDATE_PUBLISHED_AT ?? ''
};
