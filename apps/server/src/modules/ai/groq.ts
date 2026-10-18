// Shared AI chat-completions client (AnyModel / OpenAI-compatible) used by
// the AI Chat routes, channel summaries, translation, and assistants.
import { config } from '../../config.js';
import { HttpError } from '../../http/errors.js';

export async function callAi(
  systemPrompt: string,
  messages: Array<{ role: string; content: string | any[] }>,
  // Optional model override. Defaults to the main AI Chat model (gcli/grok-4.7);
  // the translate route passes the dedicated translation model instead.
  options: { model?: string; temperature?: number } = {}
) {
  const apiKey = config.aiApiKey;
  if (!apiKey) {
    throw new HttpError(503, 'AI is not configured on this server', 'AI_NOT_CONFIGURED');
  }

  const endpoint = config.aiChatEndpoint || `${config.aiBaseUrl}/chat/completions`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: options.model ?? config.aiModel,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      temperature: options.temperature ?? 0.7
    })
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error('AnyModel request failed', response.status, detail);
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

// Backwards-compatible alias for existing imports
export const callGroq = callAi;
