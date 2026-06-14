import { randomUUID } from 'node:crypto';
import { pool } from './pool.js';

export type DesktopWidgetType = 'image' | 'text' | 'video';

export type DesktopWidgetRecord = {
  id: string;
  owner_id: string;
  type: DesktopWidgetType;
  title: string;
  content: string;
  x: number;
  y: number;
  width: number;
  height: number;
  created_at: Date;
  updated_at: Date;
};

export type DesktopWidgetInput = {
  type: DesktopWidgetType;
  title: string;
  content: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DesktopWidgetPatch = {
  title?: string;
  content?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
};

export async function listDesktopWidgets(ownerId: string) {
  const result = await pool.query<DesktopWidgetRecord>(
    `
      SELECT *
      FROM desktop_widgets
      WHERE owner_id = $1
      ORDER BY created_at ASC
    `,
    [ownerId]
  );

  return result.rows;
}

export async function createDesktopWidget(ownerId: string, input: DesktopWidgetInput) {
  const result = await pool.query<DesktopWidgetRecord>(
    `
      INSERT INTO desktop_widgets (id, owner_id, type, title, content, x, y, width, height)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `,
    [randomUUID(), ownerId, input.type, input.title, input.content, input.x, input.y, input.width, input.height]
  );

  return result.rows[0];
}

export async function updateDesktopWidget(widgetId: string, ownerId: string, patch: DesktopWidgetPatch) {
  const result = await pool.query<DesktopWidgetRecord>(
    `
      UPDATE desktop_widgets
      SET
        title = COALESCE($3, title),
        content = COALESCE($4, content),
        x = COALESCE($5, x),
        y = COALESCE($6, y),
        width = COALESCE($7, width),
        height = COALESCE($8, height),
        updated_at = NOW()
      WHERE id = $1 AND owner_id = $2
      RETURNING *
    `,
    [
      widgetId,
      ownerId,
      patch.title ?? null,
      patch.content ?? null,
      patch.x ?? null,
      patch.y ?? null,
      patch.width ?? null,
      patch.height ?? null
    ]
  );

  return result.rows[0] ?? null;
}

export async function deleteDesktopWidget(widgetId: string, ownerId: string) {
  const result = await pool.query<DesktopWidgetRecord>(
    `
      DELETE FROM desktop_widgets
      WHERE id = $1 AND owner_id = $2
      RETURNING *
    `,
    [widgetId, ownerId]
  );

  return result.rows[0] ?? null;
}
