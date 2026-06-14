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

export const config = {
  port: readNumber('PORT', 4000),
  clientOrigins: (process.env.CLIENT_ORIGINS ?? process.env.CLIENT_ORIGIN ?? 'http://localhost:5173,http://127.0.0.1:5173,file://,null')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  databaseUrl: process.env.DATABASE_URL ?? 'postgresql://notoc:notoc@localhost:5432/notoc',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-jwt-secret-change-me',
  authFileSecret: process.env.AUTH_FILE_SECRET ?? 'dev-auth-file-secret-change-me',
  bcryptRounds: readNumber('BCRYPT_ROUNDS', 12),
  // Single shared Groq API key for the built-in AI Chat app. Keep this on the
  // server only so it never reaches the client.
  groqApiKey: process.env.GROQ_API_KEY ?? 'your_groq_api_key_here',
  groqModel: process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile',
  // Daily AI request quota for regular users (Dev users are unlimited).
  aiDailyRequestLimit: readNumber('AI_DAILY_REQUEST_LIMIT', 40)
};
