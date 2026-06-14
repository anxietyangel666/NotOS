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
import { findUserById, normalizeNickname, type UserRecord } from '../../db/users.js';
import { asyncHandler } from '../../http/async-handler.js';
import { HttpError } from '../../http/errors.js';
import { type AuthenticatedRequest, requireAuth } from '../../middleware/require-auth.js';
import { buildSystemPrompt } from './ai-context.js';
import { decryptChatJson, encryptChatJson } from './ai-crypto.js';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MAX_HISTORY = 30;

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
};

type StoredChat = {
  title: string;
  messages: ChatMessage[];
};

function isDevUser(user: UserRecord): boolean {
  return user.role === 'dev' || normalizeNickname(user.nickname) === 'notqqqq';
}

const settingsSchema = z.object({
  assistantName: z.string().trim().min(1).max(40).optional(),
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

const sendSchema = z.object({
  content: z.string().min(1).max(16_000),
  // Client clock context: local time string and 12h/24h (AM/PM) preference.
  localDateTime: z.string().max(120).optional(),
  timeFormat: z.enum(['12h', '24h']).optional(),
  // Music playlist lives in the browser, so the client sends track names.
  musicTracks: z.array(z.object({ name: z.string().max(300) })).max(200).optional()
});

function decode(userId: string, record: { iv: string; tag: string; ciphertext: string }): StoredChat {
  return decryptChatJson<StoredChat>(userId, record);
}

function titleFromContent(content: string) {
  const trimmed = content.trim().replace(/\s+/g, ' ');
  return trimmed.length > 48 ? `${trimmed.slice(0, 48)}…` : trimmed || 'New chat';
}

async function callGroq(
  systemPrompt: string,
  messages: Array<{ role: string; content: string }>
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
      model: config.groqModel,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      temperature: 0.7
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
      const wall = await listDesktopWallMessages(req.auth.userId);
      const wallComments = wall.map((item) => ({
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
      const userMessage: ChatMessage = {
        id: randomUUID(),
        role: 'user',
        content: input.content,
        createdAt: now
      };
      chat.messages.push(userMessage);
      if (chat.messages.length === 1 || chat.title === 'New chat') {
        chat.title = titleFromContent(input.content);
      }

      const history = chat.messages
        .slice(-MAX_HISTORY)
        .map((message) => ({ role: message.role, content: message.content }));

      const reply = await callGroq(systemPrompt, history);
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
        quota
      });
    })
  );

  return router;
}
