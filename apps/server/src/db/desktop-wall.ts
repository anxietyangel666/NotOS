import { randomUUID } from 'node:crypto';
import { pool } from './pool.js';
import { liteUserColumns, type UserRecord } from './users.js';

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

  const users = await pool.query<UserRecord>(`SELECT ${liteUserColumns()} FROM users WHERE id = ANY($1::uuid[])`, [authorIds]);
  const usersById = new Map(users.rows.map((user) => [user.id, user]));

  return messages.flatMap((message) => {
    const author = usersById.get(message.author_id);
    return author ? [{ message, author }] : [];
  });
}

// Page size for a single wall fetch. The client loads the newest page first
// and pages backwards (older messages) as the user scrolls down the list.
export const WALL_PAGE_SIZE = 20;

// Load one page of wall messages, newest-first. When `before` is provided, only
// messages older than that message are returned, which powers lazy loading on
// scroll. `hasMore` tells the client whether an older page still exists.
export async function listDesktopWallMessages(
  ownerId: string,
  options: { limit?: number; before?: string } = {}
): Promise<{ messages: DesktopWallMessage[]; hasMore: boolean }> {
  const limit = options.limit ?? WALL_PAGE_SIZE;

  // Resolve the cursor message's timestamp for stable keyset pagination.
  let beforeCreatedAt: Date | null = null;
  if (options.before) {
    const cursor = await pool.query<{ created_at: Date }>(
      'SELECT created_at FROM desktop_wall_messages WHERE id = $1',
      [options.before]
    );
    beforeCreatedAt = cursor.rows[0]?.created_at ?? null;
  }

  const params: unknown[] = [ownerId];
  let cursorClause = '';
  if (beforeCreatedAt) {
    params.push(beforeCreatedAt, options.before);
    cursorClause = `AND (created_at, id) < ($2, $3)`;
  }
  // Fetch one extra row to detect whether an older page exists.
  params.push(limit + 1);
  const limitParam = `$${params.length}`;

  const result = await pool.query<DesktopWallMessageRecord>(
    `
      SELECT *
      FROM desktop_wall_messages
      WHERE owner_id = $1
        ${cursorClause}
      ORDER BY created_at DESC, id DESC
      LIMIT ${limitParam}
    `,
    params
  );

  const hasMore = result.rows.length > limit;
  const page = hasMore ? result.rows.slice(0, limit) : result.rows;
  return { messages: await withAuthors(page), hasMore };
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
