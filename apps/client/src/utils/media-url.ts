// Helpers for recognising image / GIF URLs embedded in a chat message body so
// they can be rendered inline (used on the desktop wall and the temporary voice
// chat, where messages are plain text and GIFs are sent as raw URLs).

// Matches http(s) URLs without surrounding whitespace.
const URL_RE = /https?:\/\/[^\s<>"')]+/gi;

// Hosts that always serve animated GIFs/images even without a file extension.
const MEDIA_HOSTS = [
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

const IMAGE_EXT_RE = /\.(gif|png|jpe?g|webp|avif|bmp|svg)(\?|#|$)/i;

/** True when a URL points at an image/GIF we can render with an <img>. */
export function isMediaUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  if (MEDIA_HOSTS.some((media) => host === media || host.endsWith(`.${media}`))) return true;
  return IMAGE_EXT_RE.test(parsed.pathname) || IMAGE_EXT_RE.test(parsed.href);
}

export type MessagePart =
  | { type: 'text'; value: string }
  | { type: 'media'; value: string };

// Split a message body into text and media-URL parts. Adjacent text keeps its
// original spacing so emoji parsing downstream still works.
export function splitMediaText(text: string): MessagePart[] {
  const parts: MessagePart[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(URL_RE)) {
    const url = match[0];
    const start = match.index ?? 0;
    if (isMediaUrl(url)) {
      if (start > lastIndex) parts.push({ type: 'text', value: text.slice(lastIndex, start) });
      parts.push({ type: 'media', value: url });
      lastIndex = start + url.length;
    }
  }
  if (lastIndex < text.length) parts.push({ type: 'text', value: text.slice(lastIndex) });
  return parts;
}
