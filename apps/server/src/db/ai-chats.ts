import { pool } from './pool.js';

type AiChatRecord = {
  id: string;
  user_id: string;
  iv: string;
  tag: string;
  ciphertext: string;
  created_at: Date;
  updated_at: Date;
};

export type EncryptedChatPayload = {
  iv: string;
  tag: string;
  ciphertext: string;
};

export async function listAiChats(userId: string) {
  const result = await pool.query<AiChatRecord>(
    'SELECT * FROM ai_chats WHERE user_id = $1 ORDER BY updated_at DESC',
    [userId]
  );
  return result.rows;
}

export async function findAiChat(userId: string, chatId: string) {
  const result = await pool.query<AiChatRecord>(
    'SELECT * FROM ai_chats WHERE user_id = $1 AND id = $2',
    [userId, chatId]
  );
  return result.rows[0] ?? null;
}

export async function insertAiChat(userId: string, chatId: string, payload: EncryptedChatPayload) {
  const result = await pool.query<AiChatRecord>(
    `
      INSERT INTO ai_chats (id, user_id, iv, tag, ciphertext)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `,
    [chatId, userId, payload.iv, payload.tag, payload.ciphertext]
  );
  return result.rows[0];
}

export async function updateAiChat(userId: string, chatId: string, payload: EncryptedChatPayload) {
  const result = await pool.query<AiChatRecord>(
    `
      UPDATE ai_chats
      SET iv = $3, tag = $4, ciphertext = $5, updated_at = NOW()
      WHERE user_id = $1 AND id = $2
      RETURNING *
    `,
    [userId, chatId, payload.iv, payload.tag, payload.ciphertext]
  );
  return result.rows[0] ?? null;
}

export async function deleteAiChat(userId: string, chatId: string) {
  const result = await pool.query('DELETE FROM ai_chats WHERE user_id = $1 AND id = $2', [userId, chatId]);
  return (result.rowCount ?? 0) > 0;
}
