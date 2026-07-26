// Local dev stack without Docker: boots an embedded PostgreSQL (real binaries
// shipped via npm) and then the API server against it. Data persists in
// apps/server/.pgdata between runs.
//
//   npm run --workspace @notoc/server dev:local
import { existsSync } from 'node:fs';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';

const dataDir = path.resolve(import.meta.dirname, '.pgdata');
const firstRun = !existsSync(dataDir);

const postgres = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'notoc',
  password: 'notoc',
  port: 5433,
  persistent: true,
  // Windows initdb picks the system locale (e.g. WIN1251) by default, which
  // breaks UTF-8 payloads with "untranslatable character" errors.
  initdbFlags: ['--encoding=UTF8', '--no-locale']
});

if (firstRun) {
  console.log('[dev-local] initialising embedded PostgreSQL in', dataDir);
  await postgres.initialise();
}
await postgres.start();
if (firstRun) {
  await postgres.createDatabase('notoc');
}
console.log('[dev-local] PostgreSQL is up on :5433');

process.env.DATABASE_URL = 'postgresql://notoc:notoc@localhost:5433/notoc';
process.env.PORT = process.env.PORT ?? '4000';

const shutdown = async () => {
  try { await postgres.stop(); } catch { /* already stopped */ }
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

await import('./src/server.js');
