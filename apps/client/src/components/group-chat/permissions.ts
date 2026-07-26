// Channel/role permission helpers for the group chat view (extracted from
// GroupChatView.tsx).
import type { ChannelPermissionOverride, Language } from '../../api/types';
import { t } from '../../i18n';
import { MENTIONABLE_PERMISSION, MENTION_EVERYONE_PERMISSION } from './constants';

export type ChannelSettingsTab = 'overview' | 'permissions' | 'invites' | 'delete';
export type ChannelPermissionValue = 'inherit' | 'allow' | 'deny';

export function channelPermissionLabel(permission: string, language: Language) {
  const ru: Record<string, string> = {
    ViewChannel: 'Просмотр канала',
    ManageChannel: 'Управление каналом',
    ManagePermissions: 'Управление правами',
    ManageWebhooks: 'Управление вебхуками',
    CreateInvite: 'Создание приглашения',
    SendMessages: 'Отправка сообщений',
    AttachFiles: 'Прикрепление файлов',
    AddReactions: 'Добавление реакций',
    UseExternalEmojis: 'Внешние эмодзи',
    MentionEveryone: 'Упоминание @everyone и ролей',
    ManageMessages: 'Управление сообщениями',
    PinMessages: 'Закрепление сообщений',
    BypassSlowmode: 'Игнор slowmode',
    ReadMessageHistory: 'Чтение истории',
    SendVoiceMessages: 'Голосовые сообщения',
    SendVideoCircles: 'Видео кружки',
    CreatePolls: 'Создание опросов'
  };
  const en: Record<string, string> = {
    ViewChannel: 'View Channel',
    ManageChannel: 'Manage Channel',
    ManagePermissions: 'Manage Permissions',
    ManageWebhooks: 'Manage Webhooks',
    CreateInvite: 'Create Invite',
    SendMessages: 'Send Messages',
    AttachFiles: 'Attach Files',
    AddReactions: 'Add Reactions',
    UseExternalEmojis: 'Use External Emojis',
    MentionEveryone: 'Mention @everyone and Roles',
    ManageMessages: 'Manage Messages',
    PinMessages: 'Pin Messages',
    BypassSlowmode: 'Bypass Slowmode',
    ReadMessageHistory: 'Read Message History',
    SendVoiceMessages: 'Send Voice Messages',
    SendVideoCircles: 'Send Video Circles',
    CreatePolls: 'Create Polls'
  };
  return (language === 'ru' ? ru : en)[permission] ?? permission;
}

export function sanitizeChannelName(value: string) {
  return value
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 50);
}

export function permissionOverridesToDraft(overrides: ChannelPermissionOverride[]) {
  const draft: Record<string, Record<string, ChannelPermissionValue>> = {};
  for (const override of overrides) {
    draft[override.roleId] = draft[override.roleId] ?? {};
    draft[override.roleId][override.permission] = override.value;
  }
  return draft;
}

export function permissionDraftToOverrides(draft: Record<string, Record<string, ChannelPermissionValue>>) {
  const overrides: Array<{ roleId: string; permission: string; value: 'allow' | 'deny' }> = [];
  for (const [roleId, permissions] of Object.entries(draft)) {
    for (const [permission, value] of Object.entries(permissions)) {
      if (value === 'allow' || value === 'deny') overrides.push({ roleId, permission, value });
    }
  }
  return overrides;
}

export function rolePermissionLabel(permission: string, language: Language) {
  if (permission === MENTION_EVERYONE_PERMISSION) return language === 'ru' ? 'Может использовать @everyone' : 'Can use @everyone';
  if (permission === MENTIONABLE_PERMISSION) return language === 'ru' ? 'Можно пинговать эту роль' : 'Role can receive pings';
  const channelLabel = channelPermissionLabel(permission, language);
  if (channelLabel !== permission) return channelLabel;
  return t(language, permission as any) || permission;
}
