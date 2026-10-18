import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { uploadRoot } from '../messenger/upload-storage.js';

const MAX_AUDIO_BYTES = 80 * 1024 * 1024; // 80MB

function safeName(value: string | undefined) {
  return (value || 'track')
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .slice(0, 120);
}

function extFromMime(mime: string, originalName?: string): string {
  if (originalName) {
    const ext = path.extname(originalName).replace('.', '').toLowerCase();
    if (['mp3', 'ogg', 'wav', 'm4a', 'aac', 'flac', 'webm', 'opus'].includes(ext)) {
      return ext;
    }
  }
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('wav')) return 'wav';
  if (mime.includes('flac')) return 'flac';
  if (mime.includes('aac')) return 'aac';
  if (mime.includes('m4a') || mime.includes('mp4')) return 'm4a';
  if (mime.includes('webm')) return 'webm';
  return 'mp3';
}

export async function saveAudioDataUrl(dataUrl: string, name?: string) {
  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex === -1) {
    const error = new Error('Invalid data URL');
    (error as Error & { code?: string }).code = 'UNSUPPORTED_MEDIA';
    throw error;
  }

  const meta = dataUrl.slice(0, commaIndex);
  const base64Data = dataUrl.slice(commaIndex + 1);
  const mimeType = meta.split(';')[0].replace(/^data:/, '').trim() || 'audio/mpeg';

  const buffer = Buffer.from(base64Data, 'base64');
  if (buffer.length === 0 || buffer.length > MAX_AUDIO_BYTES) {
    const error = new Error('Audio file exceeds size limit');
    (error as Error & { code?: string }).code = 'FILE_TOO_LARGE';
    throw error;
  }

  const ext = extFromMime(mimeType, name);
  const fileName = `${randomUUID()}.${ext}`;
  const relativeDir = 'audio';
  const absoluteDir = path.join(uploadRoot, relativeDir);
  const absolutePath = path.join(absoluteDir, fileName);

  await mkdir(absoluteDir, { recursive: true });
  await writeFile(absolutePath, buffer);

  return {
    urlPath: `/uploads/${relativeDir}/${fileName}`,
    name: safeName(name),
    mimeType,
    size: buffer.length
  };
}
