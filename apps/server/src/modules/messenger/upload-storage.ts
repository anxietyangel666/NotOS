import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DATA_URL_RE = /^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/=]+)$/;
const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif'
};

const MAX_CHAT_IMAGE_BYTES = 10 * 1024 * 1024;

export const uploadRoot = path.resolve(process.cwd(), 'uploads');

function safeName(value: string | undefined) {
  return (value || 'image')
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .slice(0, 120);
}

function matchesImageSignature(buffer: Buffer, mimeType: string) {
  if (mimeType === 'image/png') {
    return buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (mimeType === 'image/jpeg') {
    return buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[buffer.length - 2] === 0xff && buffer[buffer.length - 1] === 0xd9;
  }
  if (mimeType === 'image/gif') {
    const header = buffer.subarray(0, 6).toString('ascii');
    return header === 'GIF87a' || header === 'GIF89a';
  }
  if (mimeType === 'image/webp') {
    return buffer.length > 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  }
  return false;
}

export async function saveChatImageDataUrl(dataUrl: string, name?: string) {
  const match = DATA_URL_RE.exec(dataUrl);
  if (!match) {
    const error = new Error('Unsupported image data URL');
    (error as Error & { code?: string }).code = 'UNSUPPORTED_MEDIA';
    throw error;
  }

  const mimeType = match[1] === 'image/jpg' ? 'image/jpeg' : match[1];
  const ext = MIME_EXT[mimeType] ?? 'bin';
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length === 0 || buffer.length > MAX_CHAT_IMAGE_BYTES || !matchesImageSignature(buffer, mimeType)) {
    const error = new Error('Unsupported image data URL');
    (error as Error & { code?: string }).code = 'UNSUPPORTED_MEDIA';
    throw error;
  }
  const now = new Date();
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const relativeDir = path.join('chat', year, month);
  const fileName = `${randomUUID()}.${ext}`;
  const absoluteDir = path.join(uploadRoot, relativeDir);
  const absolutePath = path.join(absoluteDir, fileName);

  await mkdir(absoluteDir, { recursive: true });
  await writeFile(absolutePath, buffer);

  return {
    urlPath: `/uploads/${relativeDir.replace(/\\/g, '/')}/${fileName}`,
    name: safeName(name),
    mimeType,
    size: buffer.length
  };
}
