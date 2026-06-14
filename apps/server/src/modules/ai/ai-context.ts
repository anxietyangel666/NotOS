import type { AiSettingsRecord } from '../../db/ai-settings.js';
import type { UserRecord } from '../../db/users.js';
import { normalizeNickname } from '../../db/users.js';

// Static map of where things live in the NotOS interface. Keep this in sync
// with the client so the assistant can guide users to the right place.
const INTERFACE_MAP = `
NotOS interface map (use this to tell the user where settings live):
- Settings: open the Start menu, then click "Settings". Sections:
  - Appearance: theme (light/dark), accent color, transparency, wallpaper.
  - Desktop: desktop icon size, hide/show desktop icons, icon sort order.
  - Profile: nickname, avatar, status, name style, profile colors.
  - Account: change auth secret / recovery key.
- Messenger: open from the taskbar; friends list, friend requests, group chats and channels live here.
- AI Assistant: the chat app you are running in; chat history is in the left sidebar.
- Desktop wall: right-click the desktop or use the wall widget to post messages.
`.trim();

function roleOf(user: UserRecord): 'dev' | 'user' {
  return user.role === 'dev' || normalizeNickname(user.nickname) === 'notqqqq' ? 'dev' : 'user';
}

// A single music track summary the client sends from the user's playlist.
// The playlist lives in the browser's localStorage, so it is supplied per
// request rather than read from the database.
export type MusicTrackContext = {
  name: string;
};

// A wall comment posted on the user's desktop wall.
export type WallCommentContext = {
  author: string;
  body: string;
  createdAt: string;
};

// Optional client-provided context about the user's local clock. The time
// format (12h/24h, i.e. AM/PM) is stored client-side, so it is sent with each
// message rather than read from the database.
// A summary of one of the user's other chats with the assistant, so the
// assistant can recall context that was discussed in a different conversation.
export type OtherChatContext = {
  title: string;
  updatedAt: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
};

export type ClientContext = {
  localDateTime?: string;
  timeFormat?: '12h' | '24h';
  musicTracks?: MusicTrackContext[];
  wallComments?: WallCommentContext[];
  // Persona/character configuration for the assistant (set by the user in the
  // AI settings "Persona" tab). When omitted, neutral defaults are used.
  settings?: AiSettingsRecord;
  // Condensed history of the user's other chats with the assistant.
  otherChats?: OtherChatContext[];
};

const MAX_LISTED = 30;

function buildMusicBlock(tracks?: MusicTrackContext[]): string {
  if (!tracks || tracks.length === 0) {
    return 'Music playlist: the user has no tracks in their playlist.';
  }
  const lines = tracks
    .slice(0, MAX_LISTED)
    .map((track, index) => `  ${index + 1}. ${track.name}`)
    .join('\n');
  const extra = tracks.length > MAX_LISTED ? `\n  …and ${tracks.length - MAX_LISTED} more` : '';
  return [
    `Music playlist (${tracks.length} track(s); same list used by the Music Player and the desktop player):`,
    lines + extra
  ].join('\n');
}

function buildWallBlock(comments?: WallCommentContext[]): string {
  if (!comments || comments.length === 0) {
    return 'Desktop wall: there are no comments on the user\'s desktop wall.';
  }
  const lines = comments
    .slice(0, MAX_LISTED)
    .map((c) => `  - ${c.author} (${c.createdAt}): ${c.body}`)
    .join('\n');
  const extra = comments.length > MAX_LISTED ? `\n  …and ${comments.length - MAX_LISTED} more` : '';
  return [
    `Desktop wall comments (${comments.length}, newest first):`,
    lines + extra
  ].join('\n');
}

const GENDER_LABELS: Record<string, string> = {
  male: 'male (refer to yourself with masculine forms where the language has grammatical gender)',
  female: 'female (refer to yourself with feminine forms where the language has grammatical gender)',
  neutral: 'gender-neutral'
};

const PERSONA_LABELS: Record<string, string> = {
  friendly: 'warm, friendly and approachable',
  professional: 'professional, precise and businesslike',
  playful: 'playful, witty and light-hearted',
  mentor: 'patient mentor who explains things step by step',
  concise: 'direct and minimal, no fluff',
  enthusiastic: 'energetic and enthusiastic'
};

const TONE_LABELS: Record<string, string> = {
  formal: 'formal',
  balanced: 'balanced (neither too formal nor too casual)',
  casual: 'casual and relaxed'
};

const LENGTH_LABELS: Record<string, string> = {
  short: 'Keep answers short (1-3 sentences) unless more detail is explicitly requested.',
  balanced: 'Use a balanced length: enough detail to be useful, without rambling.',
  detailed: 'Give thorough, detailed answers with explanations and examples.'
};

const EMOJI_LABELS: Record<string, string> = {
  none: 'Do not use emoji.',
  some: 'Use emoji sparingly, only when they add clarity or warmth.',
  many: 'Use emoji liberally to add personality.'
};

// Describes the assistant's persona/character based on the user's settings so
// the same model can role-play different personalities per user.
function buildPersonaBlock(settings?: AiSettingsRecord): string {
  const name = settings?.assistant_name?.trim() || 'NotAI';
  const gender = GENDER_LABELS[settings?.gender ?? 'neutral'] ?? GENDER_LABELS.neutral;
  const persona = PERSONA_LABELS[settings?.persona ?? 'friendly'] ?? PERSONA_LABELS.friendly;
  const tone = TONE_LABELS[settings?.tone ?? 'balanced'] ?? TONE_LABELS.balanced;
  const length = LENGTH_LABELS[settings?.response_length ?? 'balanced'] ?? LENGTH_LABELS.balanced;
  const emoji = EMOJI_LABELS[settings?.emoji_usage ?? 'some'] ?? EMOJI_LABELS.some;
  const addressName = settings?.address_name?.trim();
  const custom = settings?.custom_instructions?.trim();

  const lines = [
    'Your persona (stay in character at all times):',
    `- Your name is "${name}". If the user asks your name, use it.`,
    `- Your gender/identity: ${gender}.`,
    `- Personality: ${persona}.`,
    `- Tone: ${tone}.`,
    `- ${length}`,
    `- ${emoji}`
  ];
  if (addressName) {
    lines.push(`- Address the user as "${addressName}" when it feels natural.`);
  }
  if (custom) {
    lines.push('', 'Additional custom instructions from the user (follow these unless they conflict with safety):', custom);
  }
  return lines.join('\n');
}

// Limits to keep the cross-chat context from blowing up the prompt size.
const MAX_OTHER_CHATS = 15;
const MAX_MSGS_PER_CHAT = 12;
const MAX_MSG_CHARS = 300;

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

// Summarizes the user's other conversations with the assistant so it can recall
// what was said across chats (not just the current one).
function buildOtherChatsBlock(chats?: OtherChatContext[]): string {
  if (!chats || chats.length === 0) {
    return 'Other chats: the user has no other conversations with you.';
  }

  const shown = chats.slice(0, MAX_OTHER_CHATS);
  const blocks = shown.map((chat, index) => {
    const recent = chat.messages.slice(-MAX_MSGS_PER_CHAT);
    const skipped = chat.messages.length - recent.length;
    const lines = recent.map((m) => {
      const who = m.role === 'user' ? 'User' : 'You';
      return `    ${who}: ${truncate(m.content, MAX_MSG_CHARS)}`;
    });
    const head = `  ${index + 1}. "${chat.title}" (last updated ${chat.updatedAt}):`;
    const more = skipped > 0 ? `\n    …(${skipped} earlier message(s) omitted)` : '';
    return [head, more, ...lines].filter(Boolean).join('\n');
  });

  const extra = chats.length > MAX_OTHER_CHATS ? `\n  …and ${chats.length - MAX_OTHER_CHATS} more chat(s) not shown.` : '';

  return [
    `The user has ${chats.length} other chat(s) with you. Here is a condensed history so you can recall what was discussed:`,
    blocks.join('\n'),
    extra,
    'Use this only when relevant; do not bring up unrelated past chats unprompted.'
  ].filter(Boolean).join('\n');
}

// Builds a dynamic system prompt that describes who the user is and their
// current settings. Called on every message so the assistant always sees the
// latest values straight from the database.
export function buildSystemPrompt(user: UserRecord, client: ClientContext = {}): string {
  const role = roleOf(user);
  const roleLabel = role === 'dev' ? 'Developer (Dev)' : 'Regular user';

  const profile = [
    `- Nickname: ${user.nickname}`,
    `- Role/tag: ${roleLabel}`,
    `- Status: ${user.status || '(none)'}`,
    `- Interface language: ${user.language_code}`,
    `- Theme: ${user.theme}`,
    `- Accent color: ${user.accent_color}`,
    `- Transparency: ${user.transparency_enabled ? 'on' : 'off'}`,
    `- Desktop icon size: ${user.desktop_icon_size}`,
    `- Desktop icons hidden: ${user.hide_desktop_icons ? 'yes' : 'no'}`,
    `- Desktop sort: ${user.desktop_sort}`,
    `- Member since: ${user.created_at.toISOString().slice(0, 10)}`
  ].join('\n');

  const devNote =
    role === 'dev'
      ? '\nThis user is a Developer: you may discuss advanced/technical NotOS topics in more depth.'
      : '';

  // Current date/time block, synced with the user's local clock and 12h/24h
  // (AM/PM) preference. Falls back to server UTC if the client sent nothing.
  const clockPref =
    client.timeFormat === '12h'
      ? '12-hour clock (AM/PM)'
      : client.timeFormat === '24h'
        ? '24-hour clock'
        : 'unknown';
  const nowLine = client.localDateTime
    ? `- Current date & time (user's local time): ${client.localDateTime}`
    : `- Current date & time (server UTC): ${new Date().toISOString()}`;
  const timeBlock = [
    'Current time context:',
    nowLine,
    `- Time format preference: ${clockPref}`,
    'When you mention times, use the time format preference above.'
  ].join('\n');

  return [
    'You are the built-in AI assistant of NotOS, a friendly desktop environment.',
    'You are a general-purpose AI with broad knowledge from your training data — you can answer questions on any topic: science, history, programming, math, culture, language, and more.',
    'You do NOT have real-time internet access, but your training knowledge is extensive and up to date as of your training cutoff.',
    'Answer clearly and helpfully. Reply in the same language the user writes in.',
    'Only mention NotOS-specific context when it is relevant to the user\'s question.',
    '',
    buildPersonaBlock(client.settings),
    '',
    'You are talking to the following user (this is the live, current state):',
    profile,
    devNote,
    '',
    timeBlock,
    '',
    buildMusicBlock(client.musicTracks),
    '',
    buildWallBlock(client.wallComments),
    '',
    buildOtherChatsBlock(client.otherChats),
    '',
    INTERFACE_MAP,
    '',
    'When the user asks where a NotOS setting is, point them to the exact section above.',
    'For all other questions, answer from your general knowledge without restricting yourself to NotOS topics.'
  ]
    .filter(Boolean)
    .join('\n');
}
