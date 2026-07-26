import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../../config.js';
import {
  deleteAiChat,
  findAiChat,
  insertAiChat,
  listAiChats,
  updateAiChat
} from '../../db/ai-chats.js';
import { consumeAiQuota, getAiQuotaStatus } from '../../db/ai-quota.js';
import { getAiSettings, upsertAiSettings } from '../../db/ai-settings.js';
import { listDesktopWallMessages } from '../../db/desktop-wall.js';
import { findUserById, type UserRecord } from '../../db/users.js';
import { asyncHandler } from '../../http/async-handler.js';
import { HttpError } from '../../http/errors.js';
import { type AuthenticatedRequest, requireAuth } from '../../middleware/require-auth.js';
import { buildSystemPrompt } from './ai-context.js';
import { decryptChatJson, encryptChatJson } from './ai-crypto.js';
import { chatImageSchema, chatMediaItemsSchema } from '../messenger/media.js';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MAX_HISTORY = 30;

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  imageData?: string | null;
  imageName?: string | null;
  imageSpoiler?: boolean;
  mediaItems?: Array<{ dataUrl: string; name: string | null; spoiler: boolean }>;
  createdAt: string;
};

type StoredChat = {
  title: string;
  messages: ChatMessage[];
};

type AvatarAction =
  | { action: 'none'; reason?: string }
  | { action: 'set_from_attachment'; attachmentIndex?: number; reason?: string }
  | { action: 'restore_previous'; reason?: string }
  | { action: 'reset_default'; reason?: string };

function isDevUser(user: UserRecord): boolean {
  return user.role === 'dev';
}

const settingsSchema = z.object({
  assistantName: z.string().trim().min(1).max(40).optional(),
  assistantAvatarData: z.string().max(5_500_000).optional(),
  gender: z.enum(['male', 'female', 'neutral']).optional(),
  persona: z.enum(['friendly', 'professional', 'playful', 'mentor', 'concise', 'enthusiastic']).optional(),
  tone: z.enum(['formal', 'balanced', 'casual']).optional(),
  responseLength: z.enum(['short', 'balanced', 'detailed']).optional(),
  emojiUsage: z.enum(['none', 'some', 'many']).optional(),
  addressName: z.string().trim().max(40).optional(),
  customInstructions: z.string().max(2_000).optional(),
  onboarded: z.boolean().optional()
});

function publicSettings(record: Awaited<ReturnType<typeof getAiSettings>>) {
  return {
    assistantName: record.assistant_name,
    assistantAvatarData: record.assistant_avatar_data,
    gender: record.gender,
    persona: record.persona,
    tone: record.tone,
    responseLength: record.response_length,
    emojiUsage: record.emoji_usage,
    addressName: record.address_name,
    customInstructions: record.custom_instructions,
    onboarded: record.onboarded
  };
}

const generateSchema = z.object({
  seed: z.string().max(2_000).optional(),
  language: z.enum(['en', 'ru', 'uk']).optional()
});

const translateSchema = z.object({
  text: z.string().min(1).max(8_000),
  // Free-form language name so any language can be chosen (e.g. "German",
  // "Japanese"). The client sends the human-readable name.
  target: z.string().trim().min(2).max(40)
});

const avatarActionSchema = z.object({
  action: z.enum(['none', 'set_from_attachment', 'restore_previous', 'reset_default']),
  attachmentIndex: z.number().int().min(0).max(9).optional(),
  reason: z.string().max(300).optional()
}) satisfies z.ZodType<AvatarAction>;

const sendSchema = z.object({
  content: z.string().max(16_000).default(''),
  // Client clock context: local time string and 12h/24h (AM/PM) preference.
  localDateTime: z.string().max(120).optional(),
  timeFormat: z.enum(['12h', '24h']).optional(),
  // Music playlist lives in the browser, so the client sends track names.
  musicTracks: z.array(z.object({ name: z.string().max(300) })).max(200).optional(),
  image: chatImageSchema.optional(),
  mediaItems: chatMediaItemsSchema.optional()
}).refine((value) => value.content.trim().length > 0 || Boolean(value.image) || Boolean(value.mediaItems?.length), {
  message: 'Message content or attachments are required'
});

function decode(userId: string, record: { iv: string; tag: string; ciphertext: string }): StoredChat {
  return decryptChatJson<StoredChat>(userId, record);
}

function titleFromContent(content: string) {
  const trimmed = content.trim().replace(/\s+/g, ' ');
  return trimmed.length > 48 ? `${trimmed.slice(0, 48)}…` : trimmed || 'New chat';
}

function formatAttachmentSummary(message: ChatMessage) {
  const items = message.mediaItems?.length ? message.mediaItems : message.imageData ? [{ dataUrl: message.imageData, name: message.imageName ?? null, spoiler: Boolean(message.imageSpoiler) }] : [];
  if (items.length === 0) return '';
  const labels = items.map((item, index) => `${index + 1}. ${item.name?.trim() || 'attachment'}`);
  return `\n[Attachments: ${labels.join('; ')}]`;
}

function shouldSetAvatarFromContent(content: string) {
  const text = content.trim().toLowerCase();
  return (
    /\b(set|use|make|put|change|update)\b.*\b(avatar|profile picture|pfp)\b/.test(text)
    || /\b(avatar|profile picture|pfp)\b.*\b(set|use|make|put|change|update)\b/.test(text)
    || /\b(аватар(ку|ом)?|аву)\b/.test(text)
  );
}

function shouldSetAssistantAvatarFromContent(content: string) {
  const text = content.trim().toLowerCase();
  return (
    /\b(set|use|make|put|change|update)\b.*\b(your|ur|yourself|assistant|ai|bot)\b.*\b(avatar|profile picture|pfp)\b/.test(text)
    || /\b(avatar|profile picture|pfp)\b.*\b(set|use|make|put|change|update)\b.*\b(your|ur|yourself|assistant|ai|bot)\b/.test(text)
    || /(?:\u043f\u043e\u0441\u0442\u0430\u0432\u044c|\u0441\u0434\u0435\u043b\u0430\u0439|\u043f\u043e\u043c\u0435\u043d\u044f\u0439|\u0438\u0437\u043c\u0435\u043d\u0438|\u043e\u0431\u043d\u043e\u0432\u0438).*(?:\u0441\u0435\u0431\u0435|\u0442\u0435\u0431\u0435|\u0441\u0432\u043e\u0439|\u0441\u0432\u043e\u044e|\u0442\u0432\u043e\u0439|\u0442\u0432\u043e\u044e).*(?:\u0430\u0432\u0430\u0442\u0430\u0440|\u0430\u0432\u0430\u0442\u0430\u0440\u043a|\u0430\u0432\u0443)/u.test(text)
    || /(?:\u0430\u0432\u0430\u0442\u0430\u0440|\u0430\u0432\u0430\u0442\u0430\u0440\u043a|\u0430\u0432\u0443).*(?:\u0441\u0435\u0431\u0435|\u0442\u0435\u0431\u0435|\u0441\u0432\u043e\u0439|\u0441\u0432\u043e\u044e|\u0442\u0432\u043e\u0439|\u0442\u0432\u043e\u044e)/u.test(text)
  );
}

function avatarUpdatedReply(language: string) {
  if (language === 'ru') return '\u0413\u043e\u0442\u043e\u0432\u043e, \u043f\u043e\u0441\u0442\u0430\u0432\u0438\u043b \u044d\u0442\u0443 \u043a\u0430\u0440\u0442\u0438\u043d\u043a\u0443 \u0441\u0435\u0431\u0435 \u043d\u0430 \u0430\u0432\u0430\u0442\u0430\u0440.';
  if (language === 'uk') return '\u0413\u043e\u0442\u043e\u0432\u043e, \u043f\u043e\u0441\u0442\u0430\u0432\u0438\u0432 \u0446\u0435 \u0437\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u043d\u044f \u0441\u043e\u0431\u0456 \u043d\u0430 \u0430\u0432\u0430\u0442\u0430\u0440.';
  return 'Done, I set this image as my avatar.';
}

function parseJsonObject(text: string) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as unknown;
  } catch {
    return null;
  }
}

function avatarHistoryWithCurrent(currentAvatar: string, history: string[]) {
  const next = currentAvatar ? [currentAvatar, ...history] : [...history];
  return Array.from(new Set(next.filter(Boolean))).slice(0, 8);
}

async function callGroq(
  systemPrompt: string,
  messages: Array<{ role: string; content: string }>,
  // Optional model override. Defaults to the main AI Chat model; the translate
  // route passes the dedicated translation model instead.
  options: { model?: string; temperature?: number } = {}
) {
  if (!config.groqApiKey) {
    throw new HttpError(503, 'AI is not configured on this server', 'AI_NOT_CONFIGURED');
  }

  const response = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.groqApiKey}`
    },
    body: JSON.stringify({
      model: options.model ?? config.groqModel,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      temperature: options.temperature ?? 0.7
    })
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error('Groq request failed', response.status, detail);
    throw new HttpError(502, 'AI provider request failed', 'AI_UPSTREAM_ERROR');
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const reply = data.choices?.[0]?.message?.content?.trim();
  if (!reply) {
    throw new HttpError(502, 'AI provider returned an empty response', 'AI_EMPTY_RESPONSE');
  }
  return reply;
}

async function decideAvatarAction(input: {
  content: string;
  attachmentCount: number;
  hasCurrentAvatar: boolean;
  previousAvatarCount: number;
  recentMessages: Array<{ role: 'user' | 'assistant'; content: string }>;
  language: string;
}): Promise<AvatarAction> {
  const prompt = [
    'You are an intent classifier for a chat assistant avatar feature.',
    'Decide whether the user wants the assistant to change its own avatar.',
    'Supported actions:',
    '- none: no assistant-avatar change was requested.',
    '- set_from_attachment: use one of the newly attached images as the assistant avatar.',
    '- restore_previous: restore the previous assistant avatar from saved history.',
    '- reset_default: remove the custom assistant avatar and use the default avatar.',
    'Use conversation context, not exact keywords. Understand English, Russian, and Ukrainian.',
    'Only choose set_from_attachment when the user refers to a newly attached image and at least one attachment is available.',
    'Only choose restore_previous when the user asks to go back/restore the previous/old avatar and previousAvatarCount > 0.',
    'Only choose reset_default when the user asks for the default/original avatar.',
    'Output only compact JSON matching this TypeScript type:',
    '{"action":"none"|"set_from_attachment"|"restore_previous"|"reset_default","attachmentIndex"?:number,"reason"?:string}'
  ].join('\n');

  const payload = {
    userText: input.content,
    attachmentCount: input.attachmentCount,
    hasCurrentAvatar: input.hasCurrentAvatar,
    previousAvatarCount: input.previousAvatarCount,
    interfaceLanguage: input.language,
    recentMessages: input.recentMessages.slice(-8)
  };

  try {
    const raw = await callGroq(prompt, [{ role: 'user', content: JSON.stringify(payload) }], { temperature: 0.05 });
    const parsed = avatarActionSchema.safeParse(parseJsonObject(raw));
    return parsed.success ? parsed.data : { action: 'none', reason: 'invalid decision json' };
  } catch (error) {
    console.error('AI avatar action decision failed', error);
    return { action: 'none', reason: 'decision failed' };
  }
}

export function createAiRouter() {
  const router = Router();

  // List chats (summary only) for the chat history sidebar.
  router.get(
    '/chats',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const records = await listAiChats(req.auth.userId);
      const chats = records.map((record) => {
        const chat = decode(req.auth.userId, record);
        return {
          id: record.id,
          title: chat.title || 'New chat',
          messageCount: chat.messages.length,
          createdAt: record.created_at,
          updatedAt: record.updated_at
        };
      });
      res.json({ chats, configured: Boolean(config.groqApiKey) });
    })
  );

  // Persona/character settings for the assistant.
  router.get(
    '/settings',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const settings = await getAiSettings(req.auth.userId);
      res.json({ settings: publicSettings(settings) });
    })
  );

  router.patch(
    '/settings',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const input = settingsSchema.parse(req.body);
      const updated = await upsertAiSettings(req.auth.userId, input);
      res.json({ settings: publicSettings(updated) });
    })
  );

  // Generate "how should the AI talk to you" instructions. If the user already
  // typed a seed, the generator refines/expands it; otherwise it invents a
  // random communication style. This is a settings helper and does not count
  // against the chat quota.
  router.post(
    '/persona/generate',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const input = generateSchema.parse(req.body);
      const seed = input.seed?.trim();

      const systemPrompt = [
        'You generate a short "communication style" instruction for a personal AI assistant.',
        'The text is written in the second person, addressed TO the assistant (e.g. "Speak casually, use humour, keep answers short").',
        'Rules:',
        '- Output ONLY the instruction text, no preamble, no quotes, no markdown.',
        '- 1 to 3 sentences, at most ~280 characters.',
        seed
          ? `- Base it on this idea from the user and expand it into a coherent style: "${seed}".`
          : '- Invent a fun, distinctive but usable communication style at random.',
        `- Write it in the user's interface language (${input.language ?? 'en'}).`
      ].join('\n');

      const reply = await callGroq(systemPrompt, [
        { role: 'user', content: seed ? `Refine and expand: ${seed}` : 'Generate a random communication style.' }
      ]);

      // Keep it tidy: strip wrapping quotes and clamp length.
      const text = reply.replace(/^["'\s]+|["'\s]+$/g, '').slice(0, 2_000);
      res.json({ text });
    })
  );

  // Translate a single chat message into the target language. This is a chat
  // utility (right-click → Translate) and intentionally does NOT count against
  // the AI quota. The translation is computed on demand and never stored: the
  // client keeps it only for the lifetime of the open chat view.
  router.post(
    '/translate',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const input = translateSchema.parse(req.body);
      const targetName = input.target;

      const systemPrompt = [
        `You are a translation engine. Translate the user's text into ${targetName}.`,
        'Rules:',
        '- Output ONLY the translated text, with no preamble, quotes, or notes.',
        '- Preserve the original meaning, tone, line breaks and emoji.',
        '- Do not translate URLs, code, @mentions or :shortcodes:.',
        `- If the text is already in ${targetName}, return it unchanged.`
      ].join('\n');

      const text = await callGroq(systemPrompt, [{ role: 'user', content: input.text }], {
        model: config.groqTranslateModel,
        temperature: 0.2
      });
      res.json({ text: text.replace(/^["'\s]+|["'\s]+$/g, '').slice(0, 8_000) });
    })
  );

  // Daily request quota (progress bar in the AI settings "Quota" tab).
  router.get(
    '/quota',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const user = await findUserById(req.auth.userId);
      if (!user) throw new HttpError(404, 'User not found', 'NOT_FOUND');
      const quota = await getAiQuotaStatus(req.auth.userId, isDevUser(user));
      res.json({ quota });
    })
  );

  // Full chat with messages.
  router.get(
    '/chats/:id',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const chatId = z.string().uuid().parse(req.params.id);
      const record = await findAiChat(req.auth.userId, chatId);
      if (!record) throw new HttpError(404, 'Chat not found', 'NOT_FOUND');
      const chat = decode(req.auth.userId, record);
      res.json({ chat: { id: record.id, ...chat, updatedAt: record.updated_at } });
    })
  );

  // Create a new empty chat.
  router.post(
    '/chats',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const id = randomUUID();
      const chat: StoredChat = { title: 'New chat', messages: [] };
      const record = await insertAiChat(req.auth.userId, id, encryptChatJson(req.auth.userId, chat));
      res.status(201).json({ chat: { id: record.id, ...chat, updatedAt: record.updated_at } });
    })
  );

  router.delete(
    '/chats/:id',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const chatId = z.string().uuid().parse(req.params.id);
      const removed = await deleteAiChat(req.auth.userId, chatId);
      if (!removed) throw new HttpError(404, 'Chat not found', 'NOT_FOUND');
      res.json({ id: chatId });
    })
  );

  // Append a user message, query Groq, persist the assistant reply.
  router.post(
    '/chats/:id/messages',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const chatId = z.string().uuid().parse(req.params.id);
      const input = sendSchema.parse(req.body);

      const record = await findAiChat(req.auth.userId, chatId);
      if (!record) throw new HttpError(404, 'Chat not found', 'NOT_FOUND');
      const chat = decode(req.auth.userId, record);

      // Load the live user so the assistant always knows who it is talking to
      // (nickname, role/tag, current settings) at the moment of the request.
      const user = await findUserById(req.auth.userId);
      if (!user) throw new HttpError(404, 'User not found', 'NOT_FOUND');

      // Enforce the daily request quota for regular users (Dev is unlimited).
      const dev = isDevUser(user);
      const quotaBefore = await getAiQuotaStatus(req.auth.userId, dev);
      if (!quotaBefore.unlimited && quotaBefore.remaining !== null && quotaBefore.remaining <= 0) {
        throw new HttpError(429, 'Daily AI request limit reached', 'AI_QUOTA_EXCEEDED');
      }

      // Persona settings shape the assistant's character for this user.
      const settings = await getAiSettings(req.auth.userId);

      // Wall comments live in the database, so the server reads them directly.
      // Pull a generous page so the assistant has recent wall context.
      const wall = await listDesktopWallMessages(req.auth.userId, { limit: 50 });
      const wallComments = wall.messages.map((item) => ({
        author: item.author.nickname,
        body: item.message.body,
        createdAt: item.message.created_at.toISOString()
      }));

      // Give the assistant awareness of the user's OTHER chats so it can recall
      // things discussed elsewhere. The current chat is excluded (it is already
      // sent in full as the message history below).
      const allChats = await listAiChats(req.auth.userId);
      const otherChats = allChats
        .filter((c) => c.id !== chatId)
        .map((c) => {
          const decoded = decode(req.auth.userId, c);
          return {
            title: decoded.title,
            updatedAt: c.updated_at.toISOString(),
            messages: decoded.messages.map((m) => ({ role: m.role, content: m.content }))
          };
        });

      const systemPrompt = buildSystemPrompt(user, {
        localDateTime: input.localDateTime,
        timeFormat: input.timeFormat,
        musicTracks: input.musicTracks,
        wallComments,
        settings,
        otherChats
      });

      const now = new Date().toISOString();
      const attachments = input.mediaItems?.length ? input.mediaItems : input.image ? [input.image] : [];
      const userMessage: ChatMessage = {
        id: randomUUID(),
        role: 'user',
        content: input.content,
        imageData: input.image?.dataUrl ?? null,
        imageName: input.image?.name ?? null,
        imageSpoiler: input.image?.spoiler ?? false,
        mediaItems: attachments.map((item) => ({ dataUrl: item.dataUrl, name: item.name ?? null, spoiler: Boolean(item.spoiler) })),
        createdAt: now
      };
      chat.messages.push(userMessage);
      if (chat.messages.length === 1 || chat.title === 'New chat') {
        chat.title = titleFromContent(input.content);
      }

      let updatedSettings: typeof settings | null = null;
      let avatarActionResult = '';
      const avatarDecision = await decideAvatarAction({
        content: input.content,
        attachmentCount: attachments.length,
        hasCurrentAvatar: Boolean(settings.assistant_avatar_data),
        previousAvatarCount: settings.assistant_avatar_history.length,
        recentMessages: chat.messages.map((message) => ({ role: message.role, content: message.content })),
        language: user.language_code
      });

      if (avatarDecision.action === 'set_from_attachment') {
        const index = Math.min(Math.max(avatarDecision.attachmentIndex ?? 0, 0), Math.max(attachments.length - 1, 0));
        const avatarSource = attachments[index]?.dataUrl ?? '';
        if (avatarSource.startsWith('data:image/')) {
          updatedSettings = await upsertAiSettings(req.auth.userId, {
            assistantAvatarData: avatarSource,
            assistantAvatarHistory: avatarHistoryWithCurrent(settings.assistant_avatar_data, settings.assistant_avatar_history)
          });
          avatarActionResult = `The app changed your assistant avatar to newly attached image #${index + 1}.`;
        } else {
          avatarActionResult = 'The user asked for an avatar change, but no usable newly attached image was available.';
        }
      } else if (avatarDecision.action === 'restore_previous') {
        const [previousAvatar, ...remainingHistory] = settings.assistant_avatar_history;
        if (previousAvatar) {
          updatedSettings = await upsertAiSettings(req.auth.userId, {
            assistantAvatarData: previousAvatar,
            assistantAvatarHistory: avatarHistoryWithCurrent(settings.assistant_avatar_data, remainingHistory)
          });
          avatarActionResult = 'The app restored the previous assistant avatar from saved history.';
        } else {
          avatarActionResult = 'The user asked to restore a previous assistant avatar, but there is no saved previous avatar.';
        }
      } else if (avatarDecision.action === 'reset_default') {
        updatedSettings = await upsertAiSettings(req.auth.userId, {
          assistantAvatarData: '',
          assistantAvatarHistory: avatarHistoryWithCurrent(settings.assistant_avatar_data, settings.assistant_avatar_history)
        });
        avatarActionResult = 'The app reset the assistant avatar to the default avatar.';
      }

      const history = chat.messages
        .slice(-MAX_HISTORY)
        .map((message) => ({ role: message.role, content: `${message.content}${formatAttachmentSummary(message)}`.trim() }));

      const reply = await callGroq(
        avatarActionResult
          ? `${systemPrompt}\n\nApp action result for this turn: ${avatarActionResult}\nReply naturally in character. Do not claim you cannot change the avatar if the app action succeeded.`
          : systemPrompt,
        history
      );
      const assistantMessage: ChatMessage = {
        id: randomUUID(),
        role: 'assistant',
        content: reply,
        createdAt: new Date().toISOString()
      };
      chat.messages.push(assistantMessage);

      const updated = await updateAiChat(req.auth.userId, chatId, encryptChatJson(req.auth.userId, chat));

      // Count this request against the daily quota only after a successful reply.
      const quota = await consumeAiQuota(req.auth.userId, dev);

      res.json({
        chat: { id: chatId, ...chat, updatedAt: updated?.updated_at ?? new Date() },
        userMessage,
        assistantMessage,
        quota,
        ...(updatedSettings ? { settings: publicSettings(updatedSettings) } : {})
      });
    })
  );

  return router;
}
