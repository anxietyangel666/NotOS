import { pool } from './pool.js';

type StorageRecord = {
  user_id: string;
  iv: string;
  tag: string;
  ciphertext: string;
  created_at: Date;
  updated_at: Date;
};

export type EncryptedStoragePayload = {
  iv: string;
  tag: string;
  ciphertext: string;
};

export async function findEncryptedStorage(userId: string) {
  const result = await pool.query<StorageRecord>('SELECT * FROM virtual_storage WHERE user_id = $1', [userId]);
  return result.rows[0] ?? null;
}

export async function upsertEncryptedStorage(userId: string, payload: EncryptedStoragePayload) {
  const result = await pool.query<StorageRecord>(
    `
      INSERT INTO virtual_storage (user_id, iv, tag, ciphertext)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id)
      DO UPDATE SET iv = $2, tag = $3, ciphertext = $4, updated_at = NOW()
      RETURNING *
    `,
    [userId, payload.iv, payload.tag, payload.ciphertext]
  );

  return result.rows[0];
}
