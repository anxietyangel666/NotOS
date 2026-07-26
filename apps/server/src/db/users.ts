import { randomUUID } from 'node:crypto';
import { pool } from './pool.js';

export type NameStyle = {
  font: string;
  effect: string;
  color: string;
};

export type NamePlate = {
  type: 'none' | 'color' | 'gradient' | 'image';
  color: string;
  gradientFrom: string;
  gradientTo: string;
  image: string;
};

// A single image card pinned to the desktop. Position (x/y) is stored as a
// fraction of the viewport (0..1); width/height are pixels.
export type PinnedCard = {
  id: string;
  imageData: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type UserRecord = {
  id: string;
  nickname: string;
  nickname_normalized: string;
  login: string | null;
  login_normalized: string | null;
  email: string | null;
  role: string;
  avatar_data: string;
  wallpaper: string;
  language_code: string;
  theme: string;
  accent_color: string;
  transparency_enabled: boolean;
  desktop_icons: Record<string, unknown>;
  desktop_icon_size: string;
  hide_desktop_icons: boolean;
  desktop_sort: string;
  status: string;
  pinned_image_data: string;
  pinned_cards: PinnedCard[];
  name_style: NameStyle | null;
  profile_primary_color: string;
  profile_accent_color: string;
  nameplate: NamePlate | null;
  allow_group_identity_messages: boolean;
  auth_secret_hash: string;
  password_hash: string | null;
  recovery_key_hash: string;
  xp: string | number;
  last_xp_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export type PublicUser = {
  id: string;
  nickname: string;
  role: string;
  avatarData: string;
  wallpaper: string;
  language: string;
  theme: string;
  accentColor: string;
  transparencyEnabled: boolean;
  desktopIcons: Record<string, unknown>;
  desktopIconSize: string;
  hideDesktopIcons: boolean;
  desktopSort: string;
  status: string;
  pinnedImageData: string;
  pinnedCards: PinnedCard[];
  nameStyle: NameStyle | null;
  profilePrimaryColor: string;
  profileAccentColor: string;
  nameplate: NamePlate | null;
  allowGroupIdentityMessages: boolean;
  xp: number;
  createdAt: string;
  updatedAt: string;
};

export function normalizeNickname(nickname: string) {
  return nickname.trim().toLowerCase();
}

export function normalizeLogin(login: string) {
  return login.trim().toLowerCase();
}

export function toPublicUser(user: UserRecord): PublicUser {
  return {
    id: user.id,
    nickname: user.nickname,
    role: user.role === 'dev' ? 'dev' : 'user',
    avatarData: user.avatar_data,
    wallpaper: user.wallpaper,
    language: user.language_code,
    theme: user.theme,
    accentColor: user.accent_color,
    transparencyEnabled: user.transparency_enabled,
    desktopIcons: user.desktop_icons,
    desktopIconSize: user.desktop_icon_size,
    hideDesktopIcons: user.hide_desktop_icons,
    desktopSort: user.desktop_sort,
    status: user.status,
    pinnedImageData: user.pinned_image_data,
    pinnedCards: Array.isArray(user.pinned_cards) ? user.pinned_cards : [],
    nameStyle: user.name_style ?? null,
    profilePrimaryColor: user.profile_primary_color,
    profileAccentColor: user.profile_accent_color,
    nameplate: user.nameplate ?? null,
    allowGroupIdentityMessages: user.allow_group_identity_messages ?? true,
    xp: Number(user.xp ?? 0),
    createdAt: user.created_at.toISOString(),
    updatedAt: user.updated_at.toISOString()
  };
}

// A trimmed author snapshot for embedding inside lists of messages (wall, DMs,
// group chat). It drops the heavy per-user base64 blobs that message rendering
// never needs — `wallpaper`, `pinnedImageData`, `pinnedCards` and the desktop
// layout — which previously inflated a single wall/conversation response to
// hundreds of megabytes because the full author was duplicated per message.
//
// The fields kept are exactly what the message UI uses: identity (id, nickname,
// role), the avatar, and name/profile styling (nameStyle, nameplate, profile
// colours). When a full profile is opened the client re-fetches the complete
// user via `GET /users/:id/public`, so nothing is lost.
// The exact set of user columns `toPublicUserLite` reads. Selecting only these
// (instead of `users.*` / `SELECT *`) keeps the DB from reading and shipping the
// heavy base64 blobs — wallpaper, pinned image/cards, desktop layout — for every
// row in a list. Those columns are TOASTed and dominate member/conversation list
// latency. Use `liteUserColumns('users')` inside a JOIN, or `liteUserColumns()`
// for a bare `FROM users`.
const LITE_USER_FIELDS = [
  'id', 'nickname', 'role', 'avatar_data', 'language_code', 'theme', 'accent_color',
  'transparency_enabled', 'desktop_icon_size', 'hide_desktop_icons', 'desktop_sort',
  'status', 'name_style', 'profile_primary_color', 'profile_accent_color', 'nameplate',
  'allow_group_identity_messages', 'xp', 'created_at', 'updated_at'
];

export function liteUserColumns(prefix = ''): string {
  const p = prefix ? `${prefix}.` : '';
  return LITE_USER_FIELDS.map((field) => `${p}${field}`).join(', ');
}

export function toPublicUserLite(user: UserRecord): PublicUser {
  return {
    id: user.id,
    nickname: user.nickname,
    role: user.role === 'dev' ? 'dev' : 'user',
    avatarData: user.avatar_data,
    // Heavy fields intentionally blanked out to keep the payload small.
    wallpaper: '',
    language: user.language_code,
    theme: user.theme,
    accentColor: user.accent_color,
    transparencyEnabled: user.transparency_enabled,
    desktopIcons: {},
    desktopIconSize: user.desktop_icon_size,
    hideDesktopIcons: user.hide_desktop_icons,
    desktopSort: user.desktop_sort,
    status: user.status,
    pinnedImageData: '',
    pinnedCards: [],
    nameStyle: user.name_style ?? null,
    profilePrimaryColor: user.profile_primary_color,
    profileAccentColor: user.profile_accent_color,
    nameplate: user.nameplate ?? null,
    allowGroupIdentityMessages: user.allow_group_identity_messages ?? true,
    xp: Number(user.xp ?? 0),
    createdAt: user.created_at.toISOString(),
    updatedAt: user.updated_at.toISOString()
  };
}

export async function createUser(input: {
  nickname: string;
  login?: string | null;
  email?: string | null;
  avatarData: string;
  authSecretHash: string;
  passwordHash?: string | null;
  recoveryKeyHash: string;
  language?: string;
  theme?: string;
}) {
  const result = await pool.query<UserRecord>(
    `
      INSERT INTO users (
        id,
        nickname,
        nickname_normalized,
        login,
        login_normalized,
        email,
        role,
        avatar_data,
        language_code,
        theme,
        auth_secret_hash,
        password_hash,
        recovery_key_hash
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *
    `,
    [
      randomUUID(),
      input.nickname.trim(),
      normalizeNickname(input.nickname),
      input.login?.trim() || null,
      input.login ? normalizeLogin(input.login) : null,
      input.email?.trim() || null,
      'user',
      input.avatarData,
      input.language ?? 'en',
      input.theme ?? 'light',
      input.authSecretHash,
      input.passwordHash ?? null,
      input.recoveryKeyHash
    ]
  );

  return result.rows[0];
}

export async function findUserById(id: string) {
  const result = await pool.query<UserRecord>('SELECT * FROM users WHERE id = $1', [id]);
  return result.rows[0] ?? null;
}

export async function userExistsById(id: string) {
  const result = await pool.query('SELECT 1 FROM users WHERE id = $1 LIMIT 1', [id]);
  return (result.rowCount ?? 0) > 0;
}

export async function findUserByNickname(nickname: string) {
  const result = await pool.query<UserRecord>('SELECT * FROM users WHERE nickname_normalized = $1', [
    normalizeNickname(nickname)
  ]);
  return result.rows[0] ?? null;
}

export async function findUserByLogin(login: string) {
  const result = await pool.query<UserRecord>('SELECT * FROM users WHERE login_normalized = $1', [
    normalizeLogin(login)
  ]);
  return result.rows[0] ?? null;
}

export async function searchUsersByNickname(query: string, currentUserId: string) {
  const normalized = normalizeNickname(query);
  if (normalized.length < 2) return [];

  const result = await pool.query<UserRecord>(
    `
      SELECT ${liteUserColumns()}
      FROM users
      WHERE id <> $1
        AND nickname_normalized LIKE $2
      ORDER BY
        CASE WHEN nickname_normalized LIKE $3 THEN 0 ELSE 1 END,
        nickname_normalized ASC
      LIMIT 12
    `,
    [currentUserId, `%${normalized}%`, `${normalized}%`]
  );

  return result.rows;
}

export async function updateUserAuthSecret(userId: string, authSecretHash: string) {
  const result = await pool.query<UserRecord>(
    `
      UPDATE users
      SET auth_secret_hash = $2, updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [userId, authSecretHash]
  );

  return result.rows[0] ?? null;
}

export async function updateUserSettings(
  userId: string,
  input: {
    nickname?: string;
    avatarData?: string;
    wallpaper?: string;
    language?: string;
    theme?: string;
    accentColor?: string;
    transparencyEnabled?: boolean;
    desktopIcons?: Record<string, unknown>;
    desktopIconSize?: string;
    hideDesktopIcons?: boolean;
    desktopSort?: string;
    status?: string;
    pinnedImageData?: string;
    pinnedCards?: PinnedCard[];
    nameStyle?: NameStyle | null;
    profilePrimaryColor?: string;
    profileAccentColor?: string;
    nameplate?: NamePlate | null;
    allowGroupIdentityMessages?: boolean;
  }
) {
  // `nameStyle` is special: `undefined` means "leave unchanged", while an
  // explicit `null` clears the saved style. The $16/$17 pair encodes this so a
  // single COALESCE-style query can express both.
  const nameStyleProvided = Object.prototype.hasOwnProperty.call(input, 'nameStyle');
  const nameStyleValue = input.nameStyle == null ? null : JSON.stringify(input.nameStyle);
  const nameplateProvided = Object.prototype.hasOwnProperty.call(input, 'nameplate');
  const nameplateValue = input.nameplate == null ? null : JSON.stringify(input.nameplate);

  const result = await pool.query<UserRecord>(
    `
      UPDATE users
      SET
        nickname = COALESCE($2, nickname),
        nickname_normalized = COALESCE($3, nickname_normalized),
        avatar_data = COALESCE($4, avatar_data),
        wallpaper = COALESCE($5, wallpaper),
        language_code = COALESCE($6, language_code),
        theme = COALESCE($7, theme),
        accent_color = COALESCE($8, accent_color),
        transparency_enabled = COALESCE($9, transparency_enabled),
        desktop_icons = COALESCE($10::jsonb, desktop_icons),
        desktop_icon_size = COALESCE($11, desktop_icon_size),
        hide_desktop_icons = COALESCE($12, hide_desktop_icons),
        desktop_sort = COALESCE($13, desktop_sort),
        status = COALESCE($14, status),
        pinned_image_data = COALESCE($15, pinned_image_data),
        name_style = CASE WHEN $16 = TRUE THEN $17::jsonb ELSE name_style END,
        profile_primary_color = COALESCE($18, profile_primary_color),
        profile_accent_color = COALESCE($19, profile_accent_color),
        nameplate = CASE WHEN $20 = TRUE THEN $21::jsonb ELSE nameplate END,
        pinned_cards = COALESCE($22::jsonb, pinned_cards),
        allow_group_identity_messages = COALESCE($23, allow_group_identity_messages),
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [
      userId,
      input.nickname?.trim(),
      input.nickname === undefined ? undefined : normalizeNickname(input.nickname),
      input.avatarData,
      input.wallpaper,
      input.language,
      input.theme,
      input.accentColor,
      input.transparencyEnabled,
      input.desktopIcons === undefined ? undefined : JSON.stringify(input.desktopIcons),
      input.desktopIconSize,
      input.hideDesktopIcons,
      input.desktopSort,
      input.status,
      input.pinnedImageData,
      nameStyleProvided,
      nameStyleValue,
      input.profilePrimaryColor,
      input.profileAccentColor,
      nameplateProvided,
      nameplateValue,
      input.pinnedCards === undefined ? undefined : JSON.stringify(input.pinnedCards),
      input.allowGroupIdentityMessages,
    ]
  );

  return result.rows[0] ?? null;
}

// Award message XP with a 60s cooldown so spamming does not farm levels.
// Fire-and-forget from the send routes; returns the new total or null when
// still cooling down.
export async function awardMessageXp(userId: string): Promise<number | null> {
  const result = await pool.query<{ xp: string }>(
    `
      UPDATE users
      SET xp = xp + 15, last_xp_at = NOW()
      WHERE id = $1
        AND (last_xp_at IS NULL OR last_xp_at < NOW() - INTERVAL '60 seconds')
      RETURNING xp
    `,
    [userId]
  );
  return result.rows[0] ? Number(result.rows[0].xp) : null;
}
