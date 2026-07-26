import { z } from 'zod';
import { config } from '../../config.js';

// Hosts allowed for remote chat media (animated GIFs picked from the in-app GIF
// browser). Other chat media must be an inline image/audio/video data URL.
const TRUSTED_MEDIA_HOSTS = [
  'tenor.com',
  'media.tenor.com',
  'c.tenor.com',
  'media1.tenor.com',
  'giphy.com',
  'media.giphy.com',
  'media0.giphy.com',
  'media1.giphy.com',
  'media2.giphy.com',
  'media3.giphy.com',
  'media4.giphy.com',
  'i.giphy.com'
];

const TRUSTED_UPLOAD_ORIGINS = new Set([
  config.publicApiUrl,
  'http://localhost:4000',
  'http://127.0.0.1:4000'
].map((origin) => {
  try {
    return new URL(origin).origin;
  } catch {
    return '';
  }
}).filter(Boolean));

function isTrustedUploadPath(pathname: string) {
  return /^\/uploads\/chat\/\d{4}\/\d{2}\/[0-9a-f-]+\.(?:png|jpe?g|webp|gif)$/i.test(pathname);
}

// A chat media payload is valid when it is either an inline image/audio/video
// data URL (uploads, voice messages, video circles) or an https URL on a trusted
// GIF provider, so GIFs can be shared by reference without re-uploading bytes.
export function isTrustedMediaUrl(value: string): boolean {
  if (value.startsWith('data:image/') || value.startsWith('data:audio/') || value.startsWith('data:video/')) return true;
  if (value.startsWith('/uploads/chat/')) return isTrustedUploadPath(value);
  try {
    const parsed = new URL(value);
    if (isTrustedUploadPath(parsed.pathname)) return TRUSTED_UPLOAD_ORIGINS.has(parsed.origin);
    if (parsed.protocol !== 'https:') return false;
    return TRUSTED_MEDIA_HOSTS.some((host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

// Shared schema for an optional chat image, GIF, voice, or video-circle attachment.
export const chatImageSchema = z.object({
  dataUrl: z.string().max(24_000_000).refine(isTrustedMediaUrl, {
    message: 'Media must be an image/audio/video data URL or a trusted GIF URL'
  }),
  name: z.string().trim().max(240).optional(),
  spoiler: z.boolean().optional()
});

export const chatMediaItemsSchema = z.array(chatImageSchema).max(10);
