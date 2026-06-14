import { pool } from './pool.js';

export async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      nickname TEXT NOT NULL,
      nickname_normalized TEXT UNIQUE NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      avatar_data TEXT NOT NULL,
      wallpaper TEXT NOT NULL DEFAULT '',
      language_code TEXT NOT NULL DEFAULT 'en',
      theme TEXT NOT NULL DEFAULT 'light',
      accent_color TEXT NOT NULL DEFAULT '#2AABEE',
      transparency_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      desktop_icons JSONB NOT NULL DEFAULT '{}'::jsonb,
      desktop_icon_size TEXT NOT NULL DEFAULT 'medium',
      hide_desktop_icons BOOLEAN NOT NULL DEFAULT FALSE,
      desktop_sort TEXT NOT NULL DEFAULT 'custom',
      auth_secret_hash TEXT NOT NULL,
      recovery_key_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS users_nickname_normalized_idx
      ON users (nickname_normalized);

    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';

    UPDATE users
      SET role = 'dev', updated_at = NOW()
      WHERE nickname_normalized = 'notqqqq' AND role <> 'dev';

    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS language_code TEXT NOT NULL DEFAULT 'en';

    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS theme TEXT NOT NULL DEFAULT 'light';

    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS accent_color TEXT NOT NULL DEFAULT '#2AABEE';

    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS transparency_enabled BOOLEAN NOT NULL DEFAULT TRUE;

    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS desktop_icons JSONB NOT NULL DEFAULT '{}'::jsonb;

    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS desktop_icon_size TEXT NOT NULL DEFAULT 'medium';

    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS hide_desktop_icons BOOLEAN NOT NULL DEFAULT FALSE;

    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS desktop_sort TEXT NOT NULL DEFAULT 'custom';

    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT '';

    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS pinned_image_data TEXT NOT NULL DEFAULT '';

    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS pinned_cards JSONB NOT NULL DEFAULT '[]'::jsonb;

    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS name_style JSONB;

    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS profile_primary_color TEXT NOT NULL DEFAULT '#2AABEE';

    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS profile_accent_color TEXT NOT NULL DEFAULT '#5865F2';

    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS nameplate JSONB;

    CREATE TABLE IF NOT EXISTS virtual_storage (
      user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      iv TEXT NOT NULL,
      tag TEXT NOT NULL,
      ciphertext TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS friends (
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      friend_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, friend_id),
      CHECK (user_id <> friend_id)
    );

    CREATE INDEX IF NOT EXISTS friends_friend_id_idx
      ON friends (friend_id);

    CREATE TABLE IF NOT EXISTS friend_requests (
      requester_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (requester_id, recipient_id),
      CHECK (requester_id <> recipient_id)
    );

    CREATE INDEX IF NOT EXISTS friend_requests_recipient_id_idx
      ON friend_requests (recipient_id);

    CREATE TABLE IF NOT EXISTS messages (
      id UUID PRIMARY KEY,
      sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      image_data TEXT,
      image_name TEXT,
      image_spoiler BOOLEAN NOT NULL DEFAULT FALSE,
      edited_at TIMESTAMPTZ,
      deleted_at TIMESTAMPTZ,
      read_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE messages
      ADD COLUMN IF NOT EXISTS image_data TEXT;

    ALTER TABLE messages
      ADD COLUMN IF NOT EXISTS image_name TEXT;

    ALTER TABLE messages
      ADD COLUMN IF NOT EXISTS image_spoiler BOOLEAN NOT NULL DEFAULT FALSE;

    ALTER TABLE messages
      ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;

    ALTER TABLE messages
      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

    ALTER TABLE messages
      ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;

    ALTER TABLE messages
      ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ;

    CREATE INDEX IF NOT EXISTS messages_conversation_idx
      ON messages (sender_id, recipient_id, created_at);

    CREATE INDEX IF NOT EXISTS messages_unread_idx
      ON messages (recipient_id, sender_id)
      WHERE read_at IS NULL AND deleted_at IS NULL;

    CREATE TABLE IF NOT EXISTS desktop_wall_messages (
      id UUID PRIMARY KEY,
      owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS desktop_wall_owner_created_idx
      ON desktop_wall_messages (owner_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS groups (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL DEFAULT 'Group',
      avatar_data TEXT NOT NULL DEFAULT '',
      owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      invite_code TEXT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE groups
      ADD COLUMN IF NOT EXISTS nameplate JSONB;

    CREATE INDEX IF NOT EXISTS groups_owner_idx
      ON groups (owner_id);

    CREATE TABLE IF NOT EXISTS group_members (
      group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'member',
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (group_id, user_id)
    );

    CREATE INDEX IF NOT EXISTS group_members_user_idx
      ON group_members (user_id);

    CREATE TABLE IF NOT EXISTS group_messages (
      id UUID PRIMARY KEY,
      group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      image_data TEXT,
      image_name TEXT,
      image_spoiler BOOLEAN NOT NULL DEFAULT FALSE,
      edited_at TIMESTAMPTZ,
      deleted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS group_messages_group_idx
      ON group_messages (group_id, created_at);

    ALTER TABLE group_members
      ADD COLUMN IF NOT EXISTS role_id UUID;

    CREATE TABLE IF NOT EXISTS group_roles (
      id UUID PRIMARY KEY,
      group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#8a8a8a',
      position INT NOT NULL DEFAULT 0,
      is_owner BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS group_roles_group_idx
      ON group_roles (group_id, position);

    CREATE TABLE IF NOT EXISTS group_channels (
      id UUID PRIMARY KEY,
      group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS group_channels_group_idx
      ON group_channels (group_id);

    ALTER TABLE group_messages
      ADD COLUMN IF NOT EXISTS channel_id UUID REFERENCES group_channels(id) ON DELETE SET NULL;
    ALTER TABLE group_messages
      ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ;

    ALTER TABLE group_roles
      ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE group_roles
      ADD COLUMN IF NOT EXISTS hoist BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE group_channels
      ADD COLUMN IF NOT EXISTS position INT NOT NULL DEFAULT 0;
    ALTER TABLE group_channels
      ADD COLUMN IF NOT EXISTS folder_id UUID;
    -- Voice channels: 'text' (default) or 'voice'. Voice channels may carry an
    -- optional member limit (NULL = unlimited).
    ALTER TABLE group_channels
      ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'text';
    ALTER TABLE group_channels
      ADD COLUMN IF NOT EXISTS user_limit INT;

    CREATE TABLE IF NOT EXISTS group_folders (
      id UUID PRIMARY KEY,
      group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      position INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS group_folders_group_idx
      ON group_folders (group_id, position);

    DO $do$ BEGIN
      ALTER TABLE group_channels
        ADD CONSTRAINT group_channels_folder_fk
        FOREIGN KEY (folder_id) REFERENCES group_folders(id) ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_object THEN NULL; END $do$;

    -- AI Chat: each chat stores its title and full message history encrypted
    -- per-user (aes-256-gcm), mirroring the virtual_storage approach.
    CREATE TABLE IF NOT EXISTS ai_chats (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      iv TEXT NOT NULL,
      tag TEXT NOT NULL,
      ciphertext TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS ai_chats_user_updated_idx
      ON ai_chats (user_id, updated_at DESC);

    -- AI persona: per-user character/persona configuration for the assistant.
    CREATE TABLE IF NOT EXISTS ai_settings (
      user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      assistant_name TEXT NOT NULL DEFAULT 'NotAI',
      gender TEXT NOT NULL DEFAULT 'neutral',
      persona TEXT NOT NULL DEFAULT 'friendly',
      tone TEXT NOT NULL DEFAULT 'balanced',
      response_length TEXT NOT NULL DEFAULT 'balanced',
      emoji_usage TEXT NOT NULL DEFAULT 'some',
      address_name TEXT NOT NULL DEFAULT '',
      custom_instructions TEXT NOT NULL DEFAULT '',
      onboarded BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- AI quota: tracks the per-day request usage so regular users stay within
    -- the daily cost budget. Resets are derived from period_start (UTC day).
    CREATE TABLE IF NOT EXISTS ai_quota (
      user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      used INT NOT NULL DEFAULT 0,
      period_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}
