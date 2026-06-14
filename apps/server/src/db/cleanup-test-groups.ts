import { pool } from './pool.js';

async function cleanup() {
  console.log('Cleaning up test groups...');

  const result = await pool.query(`
    WITH deleted_messages AS (
      DELETE FROM group_messages gm
      USING groups g
      WHERE gm.group_id = g.id AND g.name IN ('Test', 'test', 'Group', 'New Group')
      RETURNING gm.id
    ),
    deleted_channels AS (
      DELETE FROM group_channels gc
      USING groups g
      WHERE gc.group_id = g.id AND g.name IN ('Test', 'test', 'Group', 'New Group')
      RETURNING gc.id
    ),
    deleted_roles AS (
      DELETE FROM group_roles gr
      USING groups g
      WHERE gr.group_id = g.id AND g.name IN ('Test', 'test', 'Group', 'New Group')
      RETURNING gr.id
    ),
    deleted_members AS (
      DELETE FROM group_members gm
      USING groups g
      WHERE gm.group_id = g.id AND g.name IN ('Test', 'test', 'Group', 'New Group')
      RETURNING gm.user_id
    )
    DELETE FROM groups WHERE name IN ('Test', 'test', 'Group', 'New Group')
    RETURNING id, name
  `);

  console.log(`Deleted ${result.rowCount} test groups:`);
  for (const row of result.rows) {
    console.log(`  - ${row.name} (${row.id})`);
  }

  await pool.end();
}

void cleanup();
