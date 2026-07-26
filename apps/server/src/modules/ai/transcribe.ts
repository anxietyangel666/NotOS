// Speech-to-text for voice messages via Groq's Whisper endpoint. Voice
// messages are stored as inline data:audio/... URLs, so the audio never
// leaves the server except to the transcription API.
import { config } from '../../config.js';
import { HttpError } from '../../http/errors.js';

const GROQ_TRANSCRIPTIONS_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

const AUDIO_DATA_URL_RE = /^data:(audio\/[a-z0-9.+-]+)(?:;codecs=[^;]+)?;base64,([A-Za-z0-9+/=]+)$/i;

const EXT_BY_MIME: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/flac': 'flac'
};

export async function transcribeAudioDataUrl(dataUrl: string): Promise<string> {
  if (!config.groqApiKey) {
    throw new HttpError(503, 'AI is not configured on this server', 'AI_NOT_CONFIGURED');
  }

  const match = AUDIO_DATA_URL_RE.exec(dataUrl);
  if (!match) {
    throw new HttpError(400, 'Message has no inline audio to transcribe', 'NOT_AUDIO');
  }
  const mimeType = match[1].toLowerCase();
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length === 0 || buffer.length > MAX_AUDIO_BYTES) {
    throw new HttpError(400, 'Audio is empty or too large to transcribe', 'AUDIO_TOO_LARGE');
  }

  const form = new FormData();
  const extension = EXT_BY_MIME[mimeType] ?? 'webm';
  form.append('file', new Blob([new Uint8Array(buffer)], { type: mimeType }), `voice.${extension}`);
  form.append('model', config.groqWhisperModel);
  form.append('response_format', 'json');

  const response = await fetch(GROQ_TRANSCRIPTIONS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.groqApiKey}` },
    body: form
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error('Groq transcription failed', response.status, detail);
    throw new HttpError(502, 'Transcription request failed', 'AI_UPSTREAM_ERROR');
  }

  const data = (await response.json()) as { text?: string };
  const text = data.text?.trim();
  if (!text) {
    throw new HttpError(502, 'Transcription returned no text', 'AI_EMPTY_RESPONSE');
  }
  return text.slice(0, 8000);
}
