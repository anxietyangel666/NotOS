import { config } from '../config.js';
import { pool } from './pool.js';

// Daily request quota for the built-in AI assistant.
//
// Cost model (Groq llama-3.3-70b-versatile, June 2026 public pricing):
//   ~$0.59 / 1M input tokens, ~$0.79 / 1M output tokens.
// A typical request in NotOS sends the system prompt + recent history
// (~1,500 input tokens) and gets ~500 output tokens back:
//   input:  1500 * 0.59 / 1e6 ≈ $0.00089
//   output:  500 * 0.79 / 1e6 ≈ $0.00040
//   total per request          ≈ $0.0013 (~0.13 cent)
// To keep a regular user under ~5 cents/day:
//   0.05 / 0.0013 ≈ 38 requests  -> default 40 (worst-case ≈ 5 cents).
// Configurable via AI_DAILY_REQUEST_LIMIT. Resets once per 24h window.
const PERIOD_MS = 24 * 60 * 60 * 1000;

function dailyLimit(): number {
  return config.aiDailyRequestLimit;
}

export type AiQuotaStatus = {
  limit: number | null; // null = unlimited (Dev)
  used: number;
  remaining: number | null;
  resetAt: string | null; // ISO timestamp when the window resets
  unlimited: boolean;
};

type AiQuotaRecord = {
  user_id: string;
  used: number;
  period_start: Date;
  updated_at: Date;
};

function unlimitedStatus(): AiQuotaStatus {
  return { limit: null, used: 0, remaining: null, resetAt: null, unlimited: true };
}

// Reads the current window for a user, rolling it over to a fresh period when
// the previous 24h window has elapsed. Dev users are unlimited.
export async function getAiQuotaStatus(userId: string, isDev: boolean): Promise<AiQuotaStatus> {
  if (isDev) return unlimitedStatus();

  const result = await pool.query<AiQuotaRecord>('SELECT * FROM ai_quota WHERE user_id = $1', [userId]);
  const record = result.rows[0];

  const limit = dailyLimit();
  const now = Date.now();
  if (!record) {
    return {
      limit,
      used: 0,
      remaining: limit,
      resetAt: new Date(now + PERIOD_MS).toISOString(),
      unlimited: false
    };
  }

  const periodStart = record.period_start.getTime();
  const expired = now - periodStart >= PERIOD_MS;
  const used = expired ? 0 : record.used;
  const resetAt = new Date((expired ? now : periodStart) + PERIOD_MS).toISOString();

  return {
    limit,
    used,
    remaining: Math.max(0, limit - used),
    resetAt,
    unlimited: false
  };
}

// Atomically consumes one request from the user's quota. Returns the updated
// status. Throws nothing here; callers should check `getAiQuotaStatus` first to
// reject over-limit requests before calling the AI provider.
export async function consumeAiQuota(userId: string, isDev: boolean): Promise<AiQuotaStatus> {
  if (isDev) return unlimitedStatus();

  const now = new Date();
  // Insert a fresh window, or increment within the current one, resetting when
  // the previous window has expired (24h elapsed since period_start).
  const result = await pool.query<AiQuotaRecord>(
    `
      INSERT INTO ai_quota (user_id, used, period_start, updated_at)
      VALUES ($1, 1, $2, $2)
      ON CONFLICT (user_id) DO UPDATE SET
        used = CASE
          WHEN $2 - ai_quota.period_start >= INTERVAL '24 hours' THEN 1
          ELSE ai_quota.used + 1
        END,
        period_start = CASE
          WHEN $2 - ai_quota.period_start >= INTERVAL '24 hours' THEN $2
          ELSE ai_quota.period_start
        END,
        updated_at = $2
      RETURNING *
    `,
    [userId, now]
  );

  const record = result.rows[0];
  const limit = dailyLimit();
  const periodStart = record.period_start.getTime();
  return {
    limit,
    used: record.used,
    remaining: Math.max(0, limit - record.used),
    resetAt: new Date(periodStart + PERIOD_MS).toISOString(),
    unlimited: false
  };
}
