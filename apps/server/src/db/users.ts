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
  auth_secret_hash: string;
  recovery_key_hash: string;
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
  createdAt: string;
  updatedAt: string;
};

export function normalizeNickname(nickname: string) {
  return nickname.trim().toLowerCase();
}

function roleForNickname(nickname: string) {
  return normalizeNickname(nickname) === 'notqqqq' ? 'dev' : 'user';
}

export function toPublicUser(user: UserRecord): PublicUser {
  return {
    id: user.id,
    nickname: user.nickname,
    role: user.role === 'dev' || normalizeNickname(user.nickname) === 'notqqqq' ? 'dev' : 'user',
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
    createdAt: user.created_at.toISOString(),
    updatedAt: user.updated_at.toISOString()
  };
}

export async function createUser(input: {
  nickname: string;
  avatarData: string;
  authSecretHash: string;
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
        role,
        avatar_data,
        language_code,
        theme,
        auth_secret_hash,
        recovery_key_hash
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `,
    [
      randomUUID(),
      input.nickname.trim(),
      normalizeNickname(input.nickname),
      roleForNickname(input.nickname),
      input.avatarData,
      input.language ?? 'en',
      input.theme ?? 'light',
      input.authSecretHash,
      input.recoveryKeyHash
    ]
  );

  return result.rows[0];
}

export async function findUserById(id: string) {
  const result = await pool.query<UserRecord>('SELECT * FROM users WHERE id = $1', [id]);
  return result.rows[0] ?? null;
}

export async function findUserByNickname(nickname: string) {
  const result = await pool.query<UserRecord>('SELECT * FROM users WHERE nickname_normalized = $1', [
    normalizeNickname(nickname)
  ]);
  return result.rows[0] ?? null;
}

export async function searchUsersByNickname(query: string, currentUserId: string) {
  const normalized = normalizeNickname(query);
  if (normalized.length < 2) return [];

  const result = await pool.query<UserRecord>(
    `
      SELECT *
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
        role = CASE WHEN COALESCE($3, nickname_normalized) = 'notqqqq' THEN 'dev' ELSE role END,
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
    ]
  );

  return result.rows[0] ?? null;
}
