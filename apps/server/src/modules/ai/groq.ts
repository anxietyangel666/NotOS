// Shared Groq chat-completions client used by the AI Chat routes and other
// AI-powered features (channel summaries, translation, transcription).
import { config } from '../../config.js';
import { HttpError } from '../../http/errors.js';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

export async function callGroq(
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
