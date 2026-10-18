import { randomUUID } from 'node:crypto';
import { pool } from './pool.js';

export type UserMusicRecord = {
  id: string;
  name: string;
  dataUrl: string;
  mimeType: string;
  size: number;
  sortOrder: number;
  createdAt: string;
};

export async function listUserMusicTracks(userId: string): Promise<UserMusicRecord[]> {
  const result = await pool.query<UserMusicRecord>(
    `SELECT
       id,
       name,
       url AS "dataUrl",
       mime_type AS "mimeType",
       size,
       sort_order AS "sortOrder",
       created_at AS "createdAt"
     FROM user_music_tracks
     WHERE user_id = $1
     ORDER BY sort_order ASC, created_at ASC`,
    [userId]
  );
  return result.rows;
}

export async function addUserMusicTrack(
  userId: string,
  track: { id?: string; name: string; url: string; mimeType?: string; size?: number }
): Promise<UserMusicRecord> {
  const id = track.id || randomUUID();
  const mimeType = track.mimeType || 'audio/mpeg';
  const size = track.size || 0;

  const result = await pool.query<UserMusicRecord>(
    `INSERT INTO user_music_tracks (id, user_id, name, url, mime_type, size, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, (
       SELECT COALESCE(MAX(sort_order), 0) + 1 FROM user_music_tracks WHERE user_id = $2
     ))
     RETURNING
       id,
       name,
       url AS "dataUrl",
       mime_type AS "mimeType",
       size,
       sort_order AS "sortOrder",
       created_at AS "createdAt"`,
    [id, userId, track.name, track.url, mimeType, size]
  );
  return result.rows[0];
}

export async function deleteUserMusicTrack(userId: string, trackId: string): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM user_music_tracks WHERE id = $1 AND user_id = $2`,
    [trackId, userId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function reorderUserMusicTracks(userId: string, trackIds: string[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < trackIds.length; i++) {
      await client.query(
        `UPDATE user_music_tracks SET sort_order = $1 WHERE id = $2 AND user_id = $3`,
        [i, trackIds[i], userId]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
