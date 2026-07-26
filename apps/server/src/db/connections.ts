import { pool } from './pool.js';

export type ConnectionProvider = 'spotify' | 'riot';

export type UserConnectionRecord = {
  user_id: string;
  provider: ConnectionProvider;
  provider_user_id: string;
  display_name: string;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: Date | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
};

export type PublicConnection = {
  provider: ConnectionProvider;
  connected: boolean;
  displayName: string;
  metadata: Record<string, unknown>;
  updatedAt: string;
};

export function toPublicConnection(row: UserConnectionRecord): PublicConnection {
  return {
    provider: row.provider,
    connected: true,
    displayName: row.display_name,
    metadata: row.metadata ?? {},
    updatedAt: row.updated_at.toISOString()
  };
}

export async function listUserConnections(userId: string) {
  const result = await pool.query<UserConnectionRecord>(
    'SELECT * FROM user_connections WHERE user_id = $1 ORDER BY provider ASC',
    [userId]
  );
  return result.rows;
}

export async function getUserConnection(userId: string, provider: ConnectionProvider) {
  const result = await pool.query<UserConnectionRecord>(
    'SELECT * FROM user_connections WHERE user_id = $1 AND provider = $2',
    [userId, provider]
  );
  return result.rows[0] ?? null;
}

export async function upsertUserConnection(input: {
  userId: string;
  provider: ConnectionProvider;
  providerUserId: string;
  displayName: string;
  accessToken?: string | null;
  refreshToken?: string | null;
  tokenExpiresAt?: Date | null;
  metadata?: Record<string, unknown>;
}) {
  const result = await pool.query<UserConnectionRecord>(
    `
      INSERT INTO user_connections (
        user_id,
        provider,
        provider_user_id,
        display_name,
        access_token,
        refresh_token,
        token_expires_at,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
      ON CONFLICT (user_id, provider)
      DO UPDATE SET
        provider_user_id = EXCLUDED.provider_user_id,
        display_name = EXCLUDED.display_name,
        access_token = COALESCE(EXCLUDED.access_token, user_connections.access_token),
        refresh_token = COALESCE(EXCLUDED.refresh_token, user_connections.refresh_token),
        token_expires_at = COALESCE(EXCLUDED.token_expires_at, user_connections.token_expires_at),
        metadata = EXCLUDED.metadata,
        updated_at = NOW()
      RETURNING *
    `,
    [
      input.userId,
      input.provider,
      input.providerUserId,
      input.displayName,
      input.accessToken ?? null,
      input.refreshToken ?? null,
      input.tokenExpiresAt ?? null,
      JSON.stringify(input.metadata ?? {})
    ]
  );
  return result.rows[0];
}

export async function updateConnectionToken(
  userId: string,
  provider: ConnectionProvider,
  input: { accessToken: string; refreshToken?: string | null; tokenExpiresAt: Date | null }
) {
  const result = await pool.query<UserConnectionRecord>(
    `
      UPDATE user_connections
      SET
        access_token = $3,
        refresh_token = COALESCE($4, refresh_token),
        token_expires_at = $5,
        updated_at = NOW()
      WHERE user_id = $1 AND provider = $2
      RETURNING *
    `,
    [userId, provider, input.accessToken, input.refreshToken ?? null, input.tokenExpiresAt]
  );
  return result.rows[0] ?? null;
}

export async function updateConnectionMetadata(
  userId: string,
  provider: ConnectionProvider,
  metadata: Record<string, unknown>
) {
  const result = await pool.query<UserConnectionRecord>(
    `
      UPDATE user_connections
      SET metadata = $3::jsonb, updated_at = NOW()
      WHERE user_id = $1 AND provider = $2
      RETURNING *
    `,
    [userId, provider, JSON.stringify(metadata)]
  );
  return result.rows[0] ?? null;
}

export async function deleteUserConnection(userId: string, provider: ConnectionProvider) {
  await pool.query('DELETE FROM user_connections WHERE user_id = $1 AND provider = $2', [userId, provider]);
}
