import { pool } from './pool.js';

export async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      nickname TEXT NOT NULL,
      nickname_normalized TEXT UNIQUE NOT NULL,
      login TEXT,
      login_normalized TEXT UNIQUE,
      email TEXT,
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
      password_hash TEXT,
      recovery_key_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS users_nickname_normalized_idx
      ON users (nickname_normalized);

    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';

    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS login TEXT;

    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS login_normalized TEXT;

    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS email TEXT;

    CREATE UNIQUE INDEX IF NOT EXISTS users_login_normalized_idx
      ON users (login_normalized)
      WHERE login_normalized IS NOT NULL;

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

    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS allow_group_identity_messages BOOLEAN NOT NULL DEFAULT TRUE;

    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS password_hash TEXT;

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

    -- Directed blocks: blocker_id has blocked blocked_id. A block prevents the
    -- blocked user from messaging or calling the blocker, and hides the
    -- conversation for the blocker.
    CREATE TABLE IF NOT EXISTS blocked_users (
      blocker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      blocked_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (blocker_id, blocked_id),
      CHECK (blocker_id <> blocked_id)
    );

    CREATE INDEX IF NOT EXISTS blocked_users_blocked_id_idx
      ON blocked_users (blocked_id);

    CREATE TABLE IF NOT EXISTS messages (
      id UUID PRIMARY KEY,
      sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      sender_group_id UUID,
      sender_group_name TEXT,
      sender_group_avatar_data TEXT,
      body TEXT NOT NULL,
      image_data TEXT,
      image_name TEXT,
      image_spoiler BOOLEAN NOT NULL DEFAULT FALSE,
      media_items JSONB,
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
      ADD COLUMN IF NOT EXISTS media_items JSONB;

    ALTER TABLE messages
      ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;

    ALTER TABLE messages
      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

    ALTER TABLE messages
      ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;

    ALTER TABLE messages
      ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ;

    ALTER TABLE messages
      ADD COLUMN IF NOT EXISTS sender_group_id UUID;

    ALTER TABLE messages
      ADD COLUMN IF NOT EXISTS sender_group_name TEXT;

    ALTER TABLE messages
      ADD COLUMN IF NOT EXISTS sender_group_avatar_data TEXT;

    -- Direct-message reply: references the message this one replies to (the
    -- referenced message may later be deleted, hence ON DELETE SET NULL).
    ALTER TABLE messages
      ADD COLUMN IF NOT EXISTS reply_to UUID;

    -- OpenGraph preview of the first URL in the body, attached asynchronously
    -- after the message is created ({url, title, description, imageUrl, siteName}).
    ALTER TABLE messages
      ADD COLUMN IF NOT EXISTS link_preview JSONB;

    -- Cached Whisper transcript of a voice message (filled on first request).
    ALTER TABLE messages
      ADD COLUMN IF NOT EXISTS transcript TEXT;

    -- Scheduled send: the message row exists but stays invisible to both sides
    -- until a sweeper clears scheduled_at and delivers it.
    ALTER TABLE messages
      ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;

    -- "Send when they are online": parked with a sentinel scheduled_at far in
    -- the future so every scheduled_at IS NULL filter already hides it and the
    -- time-based sweeper never releases it. Presence release clears both.
    ALTER TABLE messages
      ADD COLUMN IF NOT EXISTS awaiting_online BOOLEAN NOT NULL DEFAULT FALSE;
    CREATE INDEX IF NOT EXISTS messages_awaiting_online_idx
      ON messages (recipient_id)
      WHERE awaiting_online = TRUE AND deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS messages_scheduled_idx
      ON messages (scheduled_at)
      WHERE scheduled_at IS NOT NULL AND deleted_at IS NULL;

    -- View-once media: the attachment is dropped from the row once the
    -- recipient opens it, leaving only a "photo viewed" placeholder.
    ALTER TABLE messages
      ADD COLUMN IF NOT EXISTS view_once BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE messages
      ADD COLUMN IF NOT EXISTS view_once_seen_at TIMESTAMPTZ;

    ALTER TABLE messages
      ADD COLUMN IF NOT EXISTS ai_generated BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE messages
      ADD COLUMN IF NOT EXISTS ai_name TEXT;
    ALTER TABLE messages
      ADD COLUMN IF NOT EXISTS ai_avatar_data TEXT;

    -- Full-text-ish search across all conversations of a user.
    CREATE INDEX IF NOT EXISTS messages_body_trgm_idx
      ON messages (recipient_id, created_at DESC)
      WHERE deleted_at IS NULL;

    -- Global account XP: awarded per message with a cooldown, level is
    -- derived client-side from the raw number.
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS xp BIGINT NOT NULL DEFAULT 0;
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS last_xp_at TIMESTAMPTZ;

    -- Reaction roles: reacting with the bound emoji grants the role,
    -- removing the reaction revokes it.
    CREATE TABLE IF NOT EXISTS group_reaction_roles (
      message_id UUID NOT NULL REFERENCES group_messages(id) ON DELETE CASCADE,
      group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      emoji TEXT NOT NULL,
      role_id UUID NOT NULL REFERENCES group_roles(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (message_id, emoji)
    );

    -- Word blocklist checked on every group message.
    ALTER TABLE groups
      ADD COLUMN IF NOT EXISTS automod_words JSONB NOT NULL DEFAULT '[]'::jsonb;

    -- Admin audit trail (kicks, role changes, channel ops, automod hits...).
    CREATE TABLE IF NOT EXISTS group_audit_log (
      id UUID PRIMARY KEY,
      group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      target TEXT NOT NULL DEFAULT '',
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS group_audit_log_group_idx
      ON group_audit_log (group_id, created_at DESC);

    -- Polls: the chat message carries a [poll:<id>] marker; votes are one row
    -- per (poll, user, option). context locates the poll for access checks and
    -- socket fan-out ({type:'dm',a,b} or {type:'group',groupId,channelId}).
    CREATE TABLE IF NOT EXISTS polls (
      id UUID PRIMARY KEY,
      creator_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      question TEXT NOT NULL,
      options JSONB NOT NULL,
      multi BOOLEAN NOT NULL DEFAULT FALSE,
      context JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS poll_votes (
      poll_id UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      option_index INT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (poll_id, user_id, option_index)
    );

    -- Private per-user bookmarks on DM messages.
    CREATE TABLE IF NOT EXISTS message_bookmarks (
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, message_id)
    );

    -- "Remind me about this message" entries, delivered by the same sweeper.
    CREATE TABLE IF NOT EXISTS message_reminders (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      remind_at TIMESTAMPTZ NOT NULL,
      delivered_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS message_reminders_due_idx
      ON message_reminders (remind_at)
      WHERE delivered_at IS NULL;

    -- Server-side cache of fetched OpenGraph previews keyed by sha256(url).
    -- data is NULL when the fetch failed, so dead links are not retried on
    -- every message that repeats them.
    CREATE TABLE IF NOT EXISTS link_previews (
      url_hash TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      data JSONB,
      fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Emoji reactions on direct messages. One row per (message, user, emoji).
    CREATE TABLE IF NOT EXISTS message_reactions (
      message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      emoji TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (message_id, user_id, emoji)
    );

    CREATE INDEX IF NOT EXISTS message_reactions_message_idx
      ON message_reactions (message_id);

    CREATE TABLE IF NOT EXISTS message_hidden_for (
      message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      hidden_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (message_id, user_id)
    );

    CREATE INDEX IF NOT EXISTS message_hidden_for_user_idx
      ON message_hidden_for (user_id, hidden_at DESC);

    CREATE INDEX IF NOT EXISTS messages_conversation_idx
      ON messages (sender_id, recipient_id, created_at);
    CREATE INDEX IF NOT EXISTS messages_conversation_page_idx
      ON messages (
        LEAST(sender_id, recipient_id),
        GREATEST(sender_id, recipient_id),
        created_at DESC,
        id DESC
      );

    CREATE INDEX IF NOT EXISTS messages_unread_idx
      ON messages (recipient_id, sender_id)
      WHERE read_at IS NULL AND deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS messages_recipient_created_idx
      ON messages (recipient_id, created_at DESC)
      WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS messages_sender_created_idx
      ON messages (sender_id, created_at DESC)
      WHERE deleted_at IS NULL;

    CREATE TABLE IF NOT EXISTS conversation_settings (
      user_a UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_b UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      background_data TEXT NOT NULL DEFAULT '',
      updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_a, user_b),
      CHECK (user_a < user_b)
    );

    -- Disappearing messages: per-conversation TTL in seconds (0 = off). New
    -- messages get expires_at = NOW() + ttl and a sweeper deletes them.
    ALTER TABLE conversation_settings
      ADD COLUMN IF NOT EXISTS message_ttl_seconds INT NOT NULL DEFAULT 0;

    ALTER TABLE messages
      ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

    CREATE INDEX IF NOT EXISTS messages_expiring_idx
      ON messages (expires_at)
      WHERE expires_at IS NOT NULL AND deleted_at IS NULL;

    CREATE TABLE IF NOT EXISTS desktop_wall_messages (
      id UUID PRIMARY KEY,
      owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS desktop_wall_owner_created_idx
      ON desktop_wall_messages (owner_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS desktop_wall_owner_page_idx
      ON desktop_wall_messages (owner_id, created_at DESC, id DESC);

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

    -- Optional short group description (max 200 chars, enforced in the API)
    -- shown in the group invite embed and editable from group settings.
    ALTER TABLE groups
      ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';

    -- Role automatically granted to members when they join the server. NULL
    -- falls back to the lowest non-owner role (legacy behaviour).
    ALTER TABLE groups
      ADD COLUMN IF NOT EXISTS default_role_id UUID;
    ALTER TABLE groups
      ADD COLUMN IF NOT EXISTS everyone_permissions JSONB NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE groups
      ADD COLUMN IF NOT EXISTS everyone_permissions_seeded BOOLEAN NOT NULL DEFAULT FALSE;

    UPDATE groups
      SET everyone_permissions = (
        SELECT jsonb_agg(DISTINCT permission)
        FROM jsonb_array_elements_text(
          everyone_permissions || '["ViewChannel","SendMessages","AttachFiles","AddReactions","UseExternalEmojis","ReadMessageHistory","SendVoiceMessages","SendVideoCircles","CreatePolls"]'::jsonb
        ) AS defaults(permission)
      ),
      everyone_permissions_seeded = TRUE
      WHERE everyone_permissions_seeded = FALSE;

    ALTER TABLE groups
      ALTER COLUMN everyone_permissions_seeded SET DEFAULT TRUE;

    CREATE INDEX IF NOT EXISTS groups_owner_idx
      ON groups (owner_id);

    CREATE TABLE IF NOT EXISTS group_invites (
      id UUID PRIMARY KEY,
      group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      code TEXT UNIQUE NOT NULL,
      creator_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      uses_count INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS group_invites_group_created_idx
      ON group_invites (group_id, created_at DESC);

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
      media_items JSONB,
      edited_at TIMESTAMPTZ,
      deleted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS group_messages_group_idx
      ON group_messages (group_id, created_at);
    CREATE INDEX IF NOT EXISTS group_messages_group_page_idx
      ON group_messages (group_id, created_at DESC, id DESC);
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

    ALTER TABLE group_invites
      ADD COLUMN IF NOT EXISTS channel_id UUID REFERENCES group_channels(id) ON DELETE CASCADE;
    CREATE INDEX IF NOT EXISTS group_invites_group_channel_created_idx
      ON group_invites (group_id, channel_id, created_at DESC);

    ALTER TABLE group_messages
      ADD COLUMN IF NOT EXISTS channel_id UUID REFERENCES group_channels(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS group_messages_channel_page_idx
      ON group_messages (group_id, channel_id, created_at DESC, id DESC);
    ALTER TABLE group_messages
      ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ;
    ALTER TABLE group_messages
      ADD COLUMN IF NOT EXISTS sender_group_id UUID;
    ALTER TABLE group_messages
      ADD COLUMN IF NOT EXISTS sender_group_name TEXT;
    ALTER TABLE group_messages
      ADD COLUMN IF NOT EXISTS sender_group_avatar_data TEXT;
    -- Group reply: references the message this one replies to.
    ALTER TABLE group_messages
      ADD COLUMN IF NOT EXISTS reply_to UUID;
    ALTER TABLE group_messages
      ADD COLUMN IF NOT EXISTS link_preview JSONB;
    ALTER TABLE group_messages
      ADD COLUMN IF NOT EXISTS transcript TEXT;

    -- Scheduled feed posts: invisible until the sweeper releases them.
    ALTER TABLE group_messages
      ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;
    CREATE INDEX IF NOT EXISTS group_messages_scheduled_idx
      ON group_messages (scheduled_at)
      WHERE scheduled_at IS NOT NULL AND deleted_at IS NULL;

    -- Feed channels: "sign posts" shows which admin published each post.
    ALTER TABLE group_channels
      ADD COLUMN IF NOT EXISTS sign_posts BOOLEAN NOT NULL DEFAULT FALSE;

    -- Threads: replies posted "in thread" reference the root message and are
    -- hidden from the main channel flow.
    ALTER TABLE group_messages
      ADD COLUMN IF NOT EXISTS thread_root_id UUID;
    CREATE INDEX IF NOT EXISTS group_messages_thread_idx
      ON group_messages (thread_root_id, created_at)
      WHERE thread_root_id IS NOT NULL;
    ALTER TABLE group_messages
      ADD COLUMN IF NOT EXISTS media_items JSONB;
    ALTER TABLE group_messages
      ADD COLUMN IF NOT EXISTS feed_source_id UUID REFERENCES group_messages(id) ON DELETE SET NULL;
    ALTER TABLE group_messages
      ADD COLUMN IF NOT EXISTS feed_mirror BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE group_messages
      ADD COLUMN IF NOT EXISTS ai_generated BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE group_messages
      ADD COLUMN IF NOT EXISTS ai_name TEXT;
    ALTER TABLE group_messages
      ADD COLUMN IF NOT EXISTS ai_avatar_data TEXT;

    CREATE TABLE IF NOT EXISTS group_message_views (
      message_id UUID NOT NULL REFERENCES group_messages(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (message_id, user_id)
    );

    CREATE INDEX IF NOT EXISTS group_message_views_message_idx
      ON group_message_views (message_id);

    -- Emoji reactions on group messages (Discord-style). One row per
    -- (message, user, emoji). The emoji is either a unicode emoji or a custom
    -- emoji token (e.g. ":name~url:") so both render inline in the chat.
    CREATE TABLE IF NOT EXISTS group_message_reactions (
      message_id UUID NOT NULL REFERENCES group_messages(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      emoji TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (message_id, user_id, emoji)
    );

    CREATE INDEX IF NOT EXISTS group_message_reactions_message_idx
      ON group_message_reactions (message_id);

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
    ALTER TABLE group_channels
      ADD COLUMN IF NOT EXISTS topic TEXT NOT NULL DEFAULT '';
    ALTER TABLE group_channels
      ADD COLUMN IF NOT EXISTS slowmode_seconds INT NOT NULL DEFAULT 0;
    ALTER TABLE group_channels
      ADD COLUMN IF NOT EXISTS nsfw BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE group_channels
      ADD COLUMN IF NOT EXISTS bitrate INT NOT NULL DEFAULT 64000;
    ALTER TABLE group_channels
      ADD COLUMN IF NOT EXISTS feed_chat_channel_id UUID REFERENCES group_channels(id) ON DELETE SET NULL;
    ALTER TABLE group_channels
      ADD COLUMN IF NOT EXISTS feed_parent_channel_id UUID REFERENCES group_channels(id) ON DELETE SET NULL;
    ALTER TABLE group_channels
      ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}'::jsonb;

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

    -- ── Server profile customization ──
    -- Admin-defined categories ("Hobby", "Faction", ...). selection_type is
    -- 'multi' (checkboxes) or 'single' (radio: picking one clears the others).
    -- hide_channels toggles auto-created hidden channel categories per option.
    -- required gates the server behind an onboarding modal on first visit.
    CREATE TABLE IF NOT EXISTS group_custom_categories (
      id UUID PRIMARY KEY,
      group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      selection_type TEXT NOT NULL DEFAULT 'multi',
      hide_channels BOOLEAN NOT NULL DEFAULT FALSE,
      required BOOLEAN NOT NULL DEFAULT FALSE,
      position INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS group_custom_categories_group_idx
      ON group_custom_categories (group_id, position);

    -- A selectable option inside a category. Each option owns an auto-generated
    -- group role (role_id) and, when the category hides channels, an
    -- auto-generated channel folder (folder_id) only its holders can see.
    CREATE TABLE IF NOT EXISTS group_custom_options (
      id UUID PRIMARY KEY,
      category_id UUID NOT NULL REFERENCES group_custom_categories(id) ON DELETE CASCADE,
      group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      emoji TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL DEFAULT '#8a8a8a',
      role_id UUID,
      folder_id UUID,
      position INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS group_custom_options_category_idx
      ON group_custom_options (category_id, position);

    -- Channel visibility gated by roles. A channel with one or more rows here is
    -- only visible to members holding at least one of the listed roles (plus the
    -- owner). Channels with no rows are visible to everyone (legacy behaviour).
    CREATE TABLE IF NOT EXISTS group_channel_roles (
      channel_id UUID NOT NULL REFERENCES group_channels(id) ON DELETE CASCADE,
      role_id UUID NOT NULL REFERENCES group_roles(id) ON DELETE CASCADE,
      PRIMARY KEY (channel_id, role_id)
    );

    CREATE TABLE IF NOT EXISTS group_channel_permission_overrides (
      channel_id UUID NOT NULL REFERENCES group_channels(id) ON DELETE CASCADE,
      role_id UUID REFERENCES group_roles(id) ON DELETE CASCADE,
      target_id TEXT NOT NULL,
      permission TEXT NOT NULL,
      value TEXT NOT NULL CHECK (value IN ('allow', 'deny')),
      PRIMARY KEY (channel_id, target_id, permission)
    );

    ALTER TABLE group_channel_permission_overrides
      ADD COLUMN IF NOT EXISTS target_id TEXT;
    UPDATE group_channel_permission_overrides
      SET target_id = COALESCE(target_id, role_id::text)
      WHERE target_id IS NULL;
    ALTER TABLE group_channel_permission_overrides
      DROP CONSTRAINT IF EXISTS group_channel_permission_overrides_pkey;
    ALTER TABLE group_channel_permission_overrides
      ALTER COLUMN role_id DROP NOT NULL;
    ALTER TABLE group_channel_permission_overrides
      ALTER COLUMN target_id SET NOT NULL;
    ALTER TABLE group_channel_permission_overrides
      ADD PRIMARY KEY (channel_id, target_id, permission);

    -- Same role-gated visibility for folders (used by hidden channel folders).
    ALTER TABLE group_folders
      ADD COLUMN IF NOT EXISTS required_role_id UUID;

    -- Extra (additive) roles a member holds beyond their primary role_id. Used
    -- by the profile customization feature so a member can hold several
    -- customization roles at once (e.g. multiple hobbies).
    CREATE TABLE IF NOT EXISTS group_member_roles (
      group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role_id UUID NOT NULL REFERENCES group_roles(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (group_id, user_id, role_id)
    );

    CREATE INDEX IF NOT EXISTS group_member_roles_member_idx
      ON group_member_roles (group_id, user_id);

    -- Tracks which members have completed the onboarding customization flow so
    -- the required modal only blocks them until they pick their roles once.
    CREATE TABLE IF NOT EXISTS group_onboarding_state (
      group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (group_id, user_id)
    );

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
      assistant_avatar_data TEXT NOT NULL DEFAULT '',
      assistant_avatar_history JSONB NOT NULL DEFAULT '[]'::jsonb,
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

    ALTER TABLE ai_settings
      ADD COLUMN IF NOT EXISTS assistant_avatar_data TEXT NOT NULL DEFAULT '';

    ALTER TABLE ai_settings
      ADD COLUMN IF NOT EXISTS assistant_avatar_history JSONB NOT NULL DEFAULT '[]'::jsonb;

    -- AI quota: tracks the per-day request usage so regular users stay within
    -- the daily cost budget. Resets are derived from period_start (UTC day).
    CREATE TABLE IF NOT EXISTS ai_quota (
      user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      used INT NOT NULL DEFAULT 0,
      period_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS user_connections (
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      provider_user_id TEXT NOT NULL DEFAULT '',
      display_name TEXT NOT NULL DEFAULT '',
      access_token TEXT,
      refresh_token TEXT,
      token_expires_at TIMESTAMPTZ,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, provider)
    );

    CREATE INDEX IF NOT EXISTS user_connections_provider_idx
      ON user_connections (provider, provider_user_id);

    -- Saved Messages uses the same user on both sides; the original
    -- user_a < user_b check blocked a wallpaper for that chat.
    DO $$
    DECLARE
      r record;
    BEGIN
      FOR r IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'conversation_settings'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%user_a < user_b%'
      LOOP
        EXECUTE format('ALTER TABLE conversation_settings DROP CONSTRAINT %I', r.conname);
      END LOOP;
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'conversation_settings'::regclass
          AND conname = 'conversation_settings_user_order_check'
      ) THEN
        ALTER TABLE conversation_settings
          ADD CONSTRAINT conversation_settings_user_order_check CHECK (user_a <= user_b);
      END IF;
    END $$;

    ALTER TABLE group_members
      ADD COLUMN IF NOT EXISTS nickname TEXT NOT NULL DEFAULT '';
    ALTER TABLE group_members
      ADD COLUMN IF NOT EXISTS timeout_until TIMESTAMPTZ;
    ALTER TABLE group_invites
      ADD COLUMN IF NOT EXISTS max_uses INT;
    ALTER TABLE group_invites
      ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

    CREATE TABLE IF NOT EXISTS group_bans (
      group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      banned_by UUID REFERENCES users(id) ON DELETE SET NULL,
      reason TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (group_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS group_bans_user_idx ON group_bans (user_id);

    CREATE TABLE IF NOT EXISTS user_music_tracks (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      mime_type TEXT NOT NULL DEFAULT 'audio/mpeg',
      size INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS user_music_tracks_user_idx ON user_music_tracks (user_id, sort_order);

    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS voice_bio TEXT;
  `);
}
