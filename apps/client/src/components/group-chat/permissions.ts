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
    CreatePolls: 'Создание опросов',
    EmbedLinks: 'Встраивать ссылки',
    CreatePublicThreads: 'Создавать ветки',
    UseApplicationCommands: 'Команды приложения',
    Connect: 'Подключаться',
    Speak: 'Говорить',
    Stream: 'Демонстрация экрана',
    UseCamera: 'Видео',
    PrioritySpeaker: 'Приоритетный голос',
    MuteMembers: 'Отключать микрофон',
    DeafenMembers: 'Отключать звук'
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
    CreatePolls: 'Create Polls',
    EmbedLinks: 'Embed Links',
    CreatePublicThreads: 'Create Threads',
    UseApplicationCommands: 'Use Application Commands',
    Connect: 'Connect',
    Speak: 'Speak',
    Stream: 'Stream',
    UseCamera: 'Use Camera',
    PrioritySpeaker: 'Priority Speaker',
    MuteMembers: 'Mute Members',
    DeafenMembers: 'Deafen Members'
  };
  const zh: Record<string, string> = {
    ViewChannel: '查看频道',
    ManageChannel: '管理频道',
    ManagePermissions: '管理权限',
    ManageWebhooks: '管理 Webhook',
    CreateInvite: '创建邀请',
    SendMessages: '发送消息',
    AttachFiles: '附加文件',
    AddReactions: '添加反应',
    UseExternalEmojis: '使用外部表情',
    MentionEveryone: '提及 @everyone 和角色',
    ManageMessages: '管理消息',
    PinMessages: '置顶消息',
    BypassSlowmode: '忽略慢速模式',
    ReadMessageHistory: '阅读历史消息',
    SendVoiceMessages: '发送语音消息',
    SendVideoCircles: '发送视频圈',
    CreatePolls: '创建投票'
  };
  const zhTW: Record<string, string> = {
    ViewChannel: '檢視頻道',
    ManageChannel: '管理頻道',
    ManagePermissions: '管理權限',
    ManageWebhooks: '管理 Webhook',
    CreateInvite: '建立邀請',
    SendMessages: '傳送訊息',
    AttachFiles: '附加檔案',
    AddReactions: '新增回應',
    UseExternalEmojis: '使用外部表情符號',
    MentionEveryone: '提及 @everyone 和身分組',
    ManageMessages: '管理訊息',
    PinMessages: '置頂訊息',
    BypassSlowmode: '略過慢速模式',
    ReadMessageHistory: '閱讀歷史訊息',
    SendVoiceMessages: '傳送語音訊息',
    SendVideoCircles: '傳送影片圈',
    CreatePolls: '建立投票'
  };
  const table = language === 'ru' ? ru : language === 'zh' ? zh : language === 'zh-TW' ? zhTW : en;
  return table[permission] ?? permission;
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
  const extras: Record<string, Record<string, string>> = {
    en: {
      Administrator: 'Administrator',
      ManageServer: 'Manage Server',
      ManageNicknames: 'Manage Nicknames',
      ChangeNickname: 'Change Nickname',
      BanMembers: 'Ban Members',
      TimeoutMembers: 'Timeout Members',
      MuteMembers: 'Mute Members',
      Connect: 'Connect',
      Speak: 'Speak'
    },
    ru: {
      Administrator: 'Администратор',
      ManageServer: 'Управление сервером',
      ManageNicknames: 'Управление никнеймами',
      ChangeNickname: 'Сменить никнейм',
      BanMembers: 'Бан участников',
      TimeoutMembers: 'Тайм-аут',
      MuteMembers: 'Заглушать',
      Connect: 'Подключаться',
      Speak: 'Говорить'
    },
    zh: {
      Administrator: '管理员',
      ManageServer: '管理服务器',
      ManageNicknames: '管理昵称',
      ChangeNickname: '更改昵称',
      BanMembers: '封禁成员',
      TimeoutMembers: '禁言',
      MuteMembers: '静音成员',
      Connect: '连接',
      Speak: '说话'
    },
    'zh-TW': {
      Administrator: '管理員',
      ManageServer: '管理伺服器',
      ManageNicknames: '管理暱稱',
      ChangeNickname: '更改暱稱',
      BanMembers: '封鎖成員',
      TimeoutMembers: '禁言',
      MuteMembers: '靜音成員',
      Connect: '連線',
      Speak: '說話'
    }
  };
  const extra = (language === 'ru' ? extras.ru : language === 'zh' ? extras.zh : language === 'zh-TW' ? extras['zh-TW'] : extras.en)[permission];
  if (extra) return extra;
  if (permission === MENTION_EVERYONE_PERMISSION) {
    if (language === 'ru') return 'Может использовать @everyone';
    if (language === 'zh') return '可以使用 @everyone';
    if (language === 'zh-TW') return '可以使用 @everyone';
    return 'Can use @everyone';
  }
  if (permission === MENTIONABLE_PERMISSION) {
    if (language === 'ru') return 'Можно пинговать эту роль';
    if (language === 'zh') return '可以提及此角色';
    if (language === 'zh-TW') return '可以提及此身分組';
    return 'Role can receive pings';
  }
  const channelLabel = channelPermissionLabel(permission, language);
  if (channelLabel !== permission) return channelLabel;
  return t(language, permission as any) || permission;
}
