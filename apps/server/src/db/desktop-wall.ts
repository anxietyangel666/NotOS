import { randomUUID } from 'node:crypto';
import { pool } from './pool.js';
import { type UserRecord } from './users.js';

export type DesktopWallMessageRecord = {
  id: string;
  owner_id: string;
  author_id: string;
  body: string;
  created_at: Date;
};

export type DesktopWallMessage = {
  message: DesktopWallMessageRecord;
  author: UserRecord;
};

async function withAuthors(messages: DesktopWallMessageRecord[]): Promise<DesktopWallMessage[]> {
  const authorIds = Array.from(new Set(messages.map((message) => message.author_id)));
  if (!authorIds.length) return [];

  const users = await pool.query<UserRecord>('SELECT * FROM users WHERE id = ANY($1::uuid[])', [authorIds]);
  const usersById = new Map(users.rows.map((user) => [user.id, user]));

  return messages.flatMap((message) => {
    const author = usersById.get(message.author_id);
    return author ? [{ message, author }] : [];
  });
}

export async function listDesktopWallMessages(ownerId: string) {
  const result = await pool.query<DesktopWallMessageRecord>(
    `
      SELECT *
      FROM desktop_wall_messages
      WHERE owner_id = $1
      ORDER BY created_at DESC
    `,
    [ownerId]
  );

  return withAuthors(result.rows);
}

export async function createDesktopWallMessage(ownerId: string, authorId: string, body: string) {
  const result = await pool.query<DesktopWallMessageRecord>(
    `
      INSERT INTO desktop_wall_messages (id, owner_id, author_id, body)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `,
    [randomUUID(), ownerId, authorId, body]
  );

  return (await withAuthors(result.rows))[0] ?? null;
}

export async function deleteDesktopWallMessage(messageId: string, requesterId: string) {
  const result = await pool.query<DesktopWallMessageRecord>(
    `
      DELETE FROM desktop_wall_messages
      WHERE id = $1
        AND (owner_id = $2 OR author_id = $2)
      RETURNING *
    `,
    [messageId, requesterId]
  );

  return result.rows[0] ?? null;
}
