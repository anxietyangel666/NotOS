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
  jwtSecret: process.env.JWT_SECRET ?? 'dev-jwt-secret-change-me',
  authFileSecret: process.env.AUTH_FILE_SECRET ?? 'dev-auth-file-secret-change-me',
  bcryptRounds: readNumber('BCRYPT_ROUNDS', 12),
  // Single shared Groq API key for the built-in AI Chat app. Keep this on the
  // server only so it never reaches the client.
  groqApiKey: process.env.GROQ_API_KEY ?? 'your_groq_api_key_here',
  groqModel: process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile',
  // Separate (lighter/faster) model used ONLY for the chat "Translate" feature,
  // so message translation does not depend on the main AI Chat model.
  groqTranslateModel: process.env.GROQ_TRANSLATE_MODEL ?? 'llama-3.1-8b-instant',
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
