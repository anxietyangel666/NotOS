// Shared constants for the group chat view (extracted from GroupChatView.tsx).

export const MAX_CHAT_IMAGE_SIZE = 5 * 1024 * 1024;
export const MAX_CHAT_MEDIA_BATCH = 10;

export const CHANNEL_PANEL_MIN = 200;
export const CHANNEL_PANEL_MAX = 460;
export const MEMBER_PANEL_MIN = 240;
export const MEMBER_PANEL_MAX = 500;
export const GROUP_TYPING_IDLE_MS = 1500;
export const GROUP_TYPING_STALE_MS = 4500;
export const MENTION_EVERYONE_PERMISSION = 'MentionEveryone';
export const MENTIONABLE_PERMISSION = 'Mentionable';
export const GROUP_IDENTITY_PERMISSIONS = [
  'Administrator',
  'ManageServer',
  'ManageRoles',
  'DeleteAnyMessage',
  'ManageChannels',
  'ManageInvites',
  'KickMembers',
  'BanMembers',
  'ManageMessages'
];
export const EVERYONE_ROLE_ID = '@everyone';
export const ROLE_COLOR_PRESETS = ['#1abc9c', '#2ecc71', '#3498db', '#9b59b6', '#e91e63', '#f1c40f', '#e67e22', '#e74c3c', '#95a5a6', '#607d8b', '#11806a', '#1f8b4c', '#206694', '#71368a', '#ad1457', '#c27c0e'];
export const ROLE_PERMISSION_GROUPS = [
  {
    id: 'general',
    titleKey: 'permGroupGeneral' as const,
    permissions: ['Administrator', 'ViewChannel', 'ManageChannels', 'ManageRoles', 'ManageServer', 'CreateInvite', 'ManageInvites', 'ChangeNickname', 'ManageNicknames']
  },
  {
    id: 'membership',
    titleKey: 'permGroupMembership' as const,
    permissions: ['KickMembers', 'BanMembers', 'TimeoutMembers', 'MuteMembers']
  },
  {
    id: 'text',
    titleKey: 'permGroupText' as const,
    permissions: ['SendMessages', 'AttachFiles', 'AddReactions', 'UseExternalEmojis', 'MentionEveryone', 'ManageMessages', 'PinMessages', 'BypassSlowmode', 'ReadMessageHistory', 'SendVoiceMessages', 'SendVideoCircles', 'CreatePolls', 'DeleteAnyMessage']
  },
  {
    id: 'voice',
    titleKey: 'permGroupVoice' as const,
    permissions: ['Connect', 'Speak', 'Stream', 'UseCamera', 'PrioritySpeaker', 'MuteMembers', 'DeafenMembers']
  }
] as const;

export const CHANNEL_PERMISSION_GROUPS = [
  {
    title: 'General Channel Permissions',
    permissions: ['ViewChannel', 'ManageChannel', 'ManagePermissions', 'ManageWebhooks', 'CreateInvite']
  },
  {
    title: 'Text Channel Permissions',
    textOnly: true,
    permissions: ['SendMessages', 'AttachFiles', 'EmbedLinks', 'AddReactions', 'UseExternalEmojis', 'MentionEveryone', 'ManageMessages', 'PinMessages', 'BypassSlowmode', 'ReadMessageHistory', 'SendVoiceMessages', 'SendVideoCircles', 'CreatePolls', 'CreatePublicThreads', 'UseApplicationCommands']
  },
  {
    title: 'Voice Channel Permissions',
    voiceOnly: true,
    permissions: ['Connect', 'Speak', 'Stream', 'UseCamera', 'PrioritySpeaker', 'MuteMembers', 'DeafenMembers']
  }
] as const;

export const CHAT_SKELETON_ROWS = [
  { width: 68, extra: 42 },
  { width: 82, media: true },
  { width: 56, mine: true },
  { width: 74, extra: 34 },
  { width: 60, media: true, mine: true },
  { width: 88, extra: 50 },
  { width: 64 },
  { width: 78, media: true },
  { width: 52, mine: true },
  { width: 84, extra: 38 },
  { width: 70, media: true, mine: true },
  { width: 58, extra: 32 }
] satisfies Array<{ width: number; extra?: number; media?: boolean; mine?: boolean }>;
