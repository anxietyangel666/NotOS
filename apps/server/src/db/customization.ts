import { randomUUID } from 'node:crypto';
import { pool } from './pool.js';

// ── Records ──

export type CustomCategoryRecord = {
  id: string;
  group_id: string;
  name: string;
  selection_type: 'multi' | 'single';
  hide_channels: boolean;
  required: boolean;
  position: number;
  created_at: Date;
};

export type CustomOptionRecord = {
  id: string;
  category_id: string;
  group_id: string;
  label: string;
  emoji: string;
  color: string;
  role_id: string | null;
  folder_id: string | null;
  position: number;
  created_at: Date;
};

// ── Public shapes ──

export type PublicCustomOption = {
  id: string;
  categoryId: string;
  label: string;
  emoji: string;
  color: string;
  roleId: string | null;
  folderId: string | null;
  position: number;
};

export type PublicCustomCategory = {
  id: string;
  groupId: string;
  name: string;
  selectionType: 'multi' | 'single';
  hideChannels: boolean;
  required: boolean;
  position: number;
  options: PublicCustomOption[];
};

export function toPublicCustomOption(option: CustomOptionRecord): PublicCustomOption {
  return {
    id: option.id,
    categoryId: option.category_id,
    label: option.label,
    emoji: option.emoji ?? '',
    color: option.color ?? '#8a8a8a',
    roleId: option.role_id,
    folderId: option.folder_id,
    position: option.position
  };
}

export function toPublicCustomCategory(
  category: CustomCategoryRecord,
  options: CustomOptionRecord[]
): PublicCustomCategory {
  return {
    id: category.id,
    groupId: category.group_id,
    name: category.name,
    selectionType: category.selection_type === 'single' ? 'single' : 'multi',
    hideChannels: category.hide_channels,
    required: category.required,
    position: category.position,
    options: options
      .filter((o) => o.category_id === category.id)
      .sort((a, b) => a.position - b.position)
      .map(toPublicCustomOption)
  };
}

// ── Queries ──

export async function listCustomCategories(groupId: string): Promise<PublicCustomCategory[]> {
  const categories = await pool.query<CustomCategoryRecord>(
    'SELECT * FROM group_custom_categories WHERE group_id = $1 ORDER BY position ASC, created_at ASC',
    [groupId]
  );
  if (!categories.rows.length) return [];

  const options = await pool.query<CustomOptionRecord>(
    'SELECT * FROM group_custom_options WHERE group_id = $1 ORDER BY position ASC, created_at ASC',
    [groupId]
  );

  return categories.rows.map((c) => toPublicCustomCategory(c, options.rows));
}

export async function hasRequiredCategories(groupId: string) {
  const result = await pool.query(
    'SELECT 1 FROM group_custom_categories WHERE group_id = $1 AND required = TRUE LIMIT 1',
    [groupId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function hasCompletedOnboarding(groupId: string, userId: string) {
  const result = await pool.query(
    'SELECT 1 FROM group_onboarding_state WHERE group_id = $1 AND user_id = $2 LIMIT 1',
    [groupId, userId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function markOnboardingComplete(groupId: string, userId: string) {
  await pool.query(
    `
      INSERT INTO group_onboarding_state (group_id, user_id)
      VALUES ($1, $2)
      ON CONFLICT (group_id, user_id) DO NOTHING
    `,
    [groupId, userId]
  );
}

// Whether the user must complete onboarding before seeing the server: there are
// required categories and they have not finished the flow yet.
export async function needsOnboarding(groupId: string, userId: string) {
  if (!(await hasRequiredCategories(groupId))) return false;
  return !(await hasCompletedOnboarding(groupId, userId));
}

// ── Mutations ──

export async function createCustomCategory(
  groupId: string,
  input: { name: string; selectionType: 'multi' | 'single'; hideChannels: boolean; required: boolean }
) {
  const id = randomUUID();
  const maxPos = await pool.query(
    'SELECT COALESCE(MAX(position), -1) + 1 AS next_pos FROM group_custom_categories WHERE group_id = $1',
    [groupId]
  );
  const position = maxPos.rows[0]?.next_pos ?? 0;
  const result = await pool.query<CustomCategoryRecord>(
    `
      INSERT INTO group_custom_categories (id, group_id, name, selection_type, hide_channels, required, position)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `,
    [id, groupId, input.name, input.selectionType, input.hideChannels, input.required, position]
  );
  return result.rows[0];
}

export async function updateCustomCategory(
  categoryId: string,
  groupId: string,
  updates: { name?: string; selectionType?: 'multi' | 'single'; hideChannels?: boolean; required?: boolean; position?: number }
) {
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  if (updates.name !== undefined) { setClauses.push(`name = $${i++}`); values.push(updates.name); }
  if (updates.selectionType !== undefined) { setClauses.push(`selection_type = $${i++}`); values.push(updates.selectionType); }
  if (updates.hideChannels !== undefined) { setClauses.push(`hide_channels = $${i++}`); values.push(updates.hideChannels); }
  if (updates.required !== undefined) { setClauses.push(`required = $${i++}`); values.push(updates.required); }
  if (updates.position !== undefined) { setClauses.push(`position = $${i++}`); values.push(updates.position); }
  if (!setClauses.length) return getCustomCategory(categoryId, groupId);

  values.push(categoryId, groupId);
  const result = await pool.query<CustomCategoryRecord>(
    `UPDATE group_custom_categories SET ${setClauses.join(', ')} WHERE id = $${i} AND group_id = $${i + 1} RETURNING *`,
    values
  );
  return result.rows[0] ?? null;
}

export async function getCustomCategory(categoryId: string, groupId: string) {
  const result = await pool.query<CustomCategoryRecord>(
    'SELECT * FROM group_custom_categories WHERE id = $1 AND group_id = $2',
    [categoryId, groupId]
  );
  return result.rows[0] ?? null;
}

// Deleting a category removes its options; their generated roles/folders are
// cleaned up first so no orphan roles linger in the role list.
export async function deleteCustomCategory(categoryId: string, groupId: string) {
  const options = await pool.query<CustomOptionRecord>(
    'SELECT * FROM group_custom_options WHERE category_id = $1 AND group_id = $2',
    [categoryId, groupId]
  );
  for (const option of options.rows) {
    await cleanupOptionArtifacts(option);
  }
  const result = await pool.query(
    'DELETE FROM group_custom_categories WHERE id = $1 AND group_id = $2 RETURNING id',
    [categoryId, groupId]
  );
  return (result.rowCount ?? 0) > 0;
}

// Creates an option and its backing role. If the parent category hides
// channels, also creates a role-gated folder so holders get a private space.
export async function createCustomOption(
  categoryId: string,
  groupId: string,
  input: { label: string; emoji?: string; color?: string }
) {
  const category = await getCustomCategory(categoryId, groupId);
  if (!category) return null;

  const color = input.color || '#8a8a8a';
  const roleId = randomUUID();

  // Auto-generated role, named exactly after the option label.
  const maxRolePos = await pool.query(
    'SELECT COALESCE(MAX(position), -1) + 1 AS next_pos FROM group_roles WHERE group_id = $1',
    [groupId]
  );
  await pool.query(
    `
      INSERT INTO group_roles (id, group_id, name, color, position, permissions)
      VALUES ($1, $2, $3, $4, $5, '[]'::jsonb)
    `,
    [roleId, groupId, input.label, color, maxRolePos.rows[0]?.next_pos ?? 0]
  );

  let folderId: string | null = null;
  if (category.hide_channels) {
    folderId = randomUUID();
    const maxFolderPos = await pool.query(
      'SELECT COALESCE(MAX(position), -1) + 1 AS next_pos FROM group_folders WHERE group_id = $1',
      [groupId]
    );
    await pool.query(
      `
        INSERT INTO group_folders (id, group_id, name, position, required_role_id)
        VALUES ($1, $2, $3, $4, $5)
      `,
      [folderId, groupId, input.label, maxFolderPos.rows[0]?.next_pos ?? 0, roleId]
    );
  }

  const id = randomUUID();
  const maxPos = await pool.query(
    'SELECT COALESCE(MAX(position), -1) + 1 AS next_pos FROM group_custom_options WHERE category_id = $1',
    [categoryId]
  );
  const result = await pool.query<CustomOptionRecord>(
    `
      INSERT INTO group_custom_options (id, category_id, group_id, label, emoji, color, role_id, folder_id, position)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `,
    [id, categoryId, groupId, input.label, input.emoji ?? '', color, roleId, folderId, maxPos.rows[0]?.next_pos ?? 0]
  );
  return result.rows[0];
}

export async function updateCustomOption(
  optionId: string,
  groupId: string,
  updates: { label?: string; emoji?: string; color?: string }
) {
  const existing = await pool.query<CustomOptionRecord>(
    'SELECT * FROM group_custom_options WHERE id = $1 AND group_id = $2',
    [optionId, groupId]
  );
  const option = existing.rows[0];
  if (!option) return null;

  const setClauses: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  if (updates.label !== undefined) { setClauses.push(`label = $${i++}`); values.push(updates.label); }
  if (updates.emoji !== undefined) { setClauses.push(`emoji = $${i++}`); values.push(updates.emoji); }
  if (updates.color !== undefined) { setClauses.push(`color = $${i++}`); values.push(updates.color); }

  if (setClauses.length) {
    values.push(optionId, groupId);
    await pool.query(
      `UPDATE group_custom_options SET ${setClauses.join(', ')} WHERE id = $${i} AND group_id = $${i + 1}`,
      values
    );
  }

  // Keep the backing role/folder in sync with label + color changes.
  if (option.role_id && (updates.label !== undefined || updates.color !== undefined)) {
    const roleSets: string[] = [];
    const roleValues: unknown[] = [];
    let j = 1;
    if (updates.label !== undefined) { roleSets.push(`name = $${j++}`); roleValues.push(updates.label); }
    if (updates.color !== undefined) { roleSets.push(`color = $${j++}`); roleValues.push(updates.color); }
    roleValues.push(option.role_id);
    await pool.query(`UPDATE group_roles SET ${roleSets.join(', ')} WHERE id = $${j}`, roleValues);
  }
  if (option.folder_id && updates.label !== undefined) {
    await pool.query('UPDATE group_folders SET name = $1 WHERE id = $2', [updates.label, option.folder_id]);
  }

  const result = await pool.query<CustomOptionRecord>(
    'SELECT * FROM group_custom_options WHERE id = $1 AND group_id = $2',
    [optionId, groupId]
  );
  return result.rows[0] ?? null;
}

export async function deleteCustomOption(optionId: string, groupId: string) {
  const existing = await pool.query<CustomOptionRecord>(
    'SELECT * FROM group_custom_options WHERE id = $1 AND group_id = $2',
    [optionId, groupId]
  );
  const option = existing.rows[0];
  if (!option) return false;

  await cleanupOptionArtifacts(option);
  await pool.query('DELETE FROM group_custom_options WHERE id = $1', [optionId]);
  return true;
}

// Removes the role + folder generated for an option. Channels inside a deleted
// folder are detached (folder_id -> NULL) by the folder FK ON DELETE SET NULL.
async function cleanupOptionArtifacts(option: CustomOptionRecord) {
  if (option.folder_id) {
    await pool.query('UPDATE group_channels SET folder_id = NULL WHERE folder_id = $1', [option.folder_id]);
    await pool.query('DELETE FROM group_folders WHERE id = $1', [option.folder_id]);
  }
  if (option.role_id) {
    // Detach the role from any members holding it (primary or extra), then
    // delete the role itself. group_member_roles rows cascade on role delete.
    await pool.query(
      "UPDATE group_members SET role_id = NULL, role = 'member' WHERE role_id = $1",
      [option.role_id]
    );
    await pool.query('DELETE FROM group_roles WHERE id = $1', [option.role_id]);
  }
}

// ── Member self-service toggling ──

// Toggle an option's role on the calling member. For 'single' categories,
// selecting an option clears the sibling options' roles first (radio
// behaviour). Returns the resulting set of selected option ids for the group.
export async function toggleCustomOption(groupId: string, userId: string, optionId: string) {
  const optionResult = await pool.query<CustomOptionRecord>(
    'SELECT * FROM group_custom_options WHERE id = $1 AND group_id = $2',
    [optionId, groupId]
  );
  const option = optionResult.rows[0];
  if (!option || !option.role_id) return null;

  const category = await getCustomCategory(option.category_id, groupId);
  if (!category) return null;

  const currentlySelected = await isOptionSelected(groupId, userId, option);

  if (currentlySelected) {
    await detachRole(groupId, userId, option.role_id);
  } else {
    if (category.selection_type === 'single') {
      // Clear sibling option roles in this category before adding the new one.
      const siblings = await pool.query<CustomOptionRecord>(
        'SELECT * FROM group_custom_options WHERE category_id = $1',
        [option.category_id]
      );
      for (const sibling of siblings.rows) {
        if (sibling.role_id && sibling.id !== option.id) {
          await detachRole(groupId, userId, sibling.role_id);
        }
      }
    }
    await attachRole(groupId, userId, option.role_id);
  }

  return getSelectedOptionIds(groupId, userId);
}

// A member "has" an option when they hold its role. Roles are stored on
// group_members.role_id (primary) plus group_member_roles (extra roles).
async function isOptionSelected(groupId: string, userId: string, option: CustomOptionRecord) {
  if (!option.role_id) return false;
  const result = await pool.query(
    'SELECT 1 FROM group_member_roles WHERE group_id = $1 AND user_id = $2 AND role_id = $3 LIMIT 1',
    [groupId, userId, option.role_id]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function attachRole(groupId: string, userId: string, roleId: string) {
  await pool.query(
    `
      INSERT INTO group_member_roles (group_id, user_id, role_id)
      SELECT group_id, user_id, role_id
      FROM group_members
      WHERE group_id = $1 AND user_id = $2 AND role_id IS NOT NULL AND role_id <> $3
      ON CONFLICT (group_id, user_id, role_id) DO NOTHING
    `,
    [groupId, userId, roleId]
  );
  await pool.query(
    `
      INSERT INTO group_member_roles (group_id, user_id, role_id)
      VALUES ($1, $2, $3)
      ON CONFLICT (group_id, user_id, role_id) DO NOTHING
    `,
    [groupId, userId, roleId]
  );
  // Also surface the role as the member's displayed (primary) role so the
  // member list, name colour and grouping reflect the pick immediately.
  await pool.query(
    `
      UPDATE group_members
      SET role_id = $3,
          role = COALESCE((SELECT name FROM group_roles WHERE id = $3 AND group_id = $1), role)
      WHERE group_id = $1 AND user_id = $2
    `,
    [groupId, userId, roleId]
  );
}

export async function detachRole(groupId: string, userId: string, roleId: string) {
  await pool.query(
    'DELETE FROM group_member_roles WHERE group_id = $1 AND user_id = $2 AND role_id = $3',
    [groupId, userId, roleId]
  );
  // If this role was the displayed primary role, fall back to another
  // customization role the member still holds, otherwise clear it.
  const fallback = await pool.query<{ role_id: string }>(
    'SELECT role_id FROM group_member_roles WHERE group_id = $1 AND user_id = $2 ORDER BY role_id LIMIT 1',
    [groupId, userId]
  );
  await pool.query(
    `
      UPDATE group_members
      SET role_id = $3,
          role = COALESCE((SELECT name FROM group_roles WHERE id = $3 AND group_id = $1), 'member')
      WHERE group_id = $1 AND user_id = $2 AND role_id = $4
    `,
    [groupId, userId, fallback.rows[0]?.role_id ?? null, roleId]
  );
}

export async function getSelectedOptionIds(groupId: string, userId: string) {
  const result = await pool.query<{ id: string }>(
    `
      SELECT o.id
      FROM group_custom_options o
      JOIN group_member_roles gmr
        ON gmr.role_id = o.role_id AND gmr.group_id = o.group_id
      WHERE o.group_id = $1 AND gmr.user_id = $2
    `,
    [groupId, userId]
  );
  return result.rows.map((r) => r.id);
}

// ── Channel / folder visibility ──

// Map of channelId -> required role ids (from group_channel_roles).
export async function getChannelRoleGates(groupId: string) {
  const result = await pool.query<{ channel_id: string; role_id: string }>(
    `
      SELECT gcr.channel_id, gcr.role_id
      FROM group_channel_roles gcr
      JOIN group_channels gc ON gc.id = gcr.channel_id
      WHERE gc.group_id = $1
    `,
    [groupId]
  );
  const map = new Map<string, Set<string>>();
  for (const row of result.rows) {
    if (!map.has(row.channel_id)) map.set(row.channel_id, new Set());
    map.get(row.channel_id)!.add(row.role_id);
  }
  return map;
}

// Map of folderId -> required role id (from group_folders.required_role_id).
export async function getFolderRoleGates(groupId: string) {
  const result = await pool.query<{ id: string; required_role_id: string | null }>(
    'SELECT id, required_role_id FROM group_folders WHERE group_id = $1',
    [groupId]
  );
  const map = new Map<string, string>();
  for (const row of result.rows) {
    if (row.required_role_id) map.set(row.id, row.required_role_id);
  }
  return map;
}

export async function setChannelRoleGates(channelId: string, roleIds: string[]) {
  await pool.query('DELETE FROM group_channel_roles WHERE channel_id = $1', [channelId]);
  for (const roleId of roleIds) {
    await pool.query(
      'INSERT INTO group_channel_roles (channel_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [channelId, roleId]
    );
  }
}

// All role ids the member holds in the group: the primary role plus any extra
// customization roles. Used for channel/folder visibility checks.
export async function getMemberRoleIds(groupId: string, userId: string) {
  const primary = await pool.query<{ role_id: string | null }>(
    'SELECT role_id FROM group_members WHERE group_id = $1 AND user_id = $2',
    [groupId, userId]
  );
  const extra = await pool.query<{ role_id: string }>(
    'SELECT role_id FROM group_member_roles WHERE group_id = $1 AND user_id = $2',
    [groupId, userId]
  );
  const ids = new Set<string>();
  if (primary.rows[0]?.role_id) ids.add(primary.rows[0].role_id);
  for (const row of extra.rows) ids.add(row.role_id);
  return ids;
}
