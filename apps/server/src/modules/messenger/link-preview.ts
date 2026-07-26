// OpenGraph link previews for chat messages.
//
// The first http(s) URL in a message body is fetched server-side (the client
// never talks to the target site), parsed for og:* meta tags and cached in
// Postgres. Fetching is defensive: DNS results are validated against private
// ranges on every redirect hop (SSRF), responses are size- and time-capped and
// only text/html is parsed.
import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { pool } from '../../db/pool.js';

export type LinkPreview = {
  url: string;
  title: string;
  description: string;
  imageUrl: string;
  siteName: string;
};

const MAX_URL_LENGTH = 2048;
const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 5000;
const MAX_HTML_BYTES = 512 * 1024;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const USER_AGENT = 'Mozilla/5.0 (compatible; NotOSBot/1.0; +link-preview)';

const URL_RE = /https?:\/\/[^\s<>"'\)\]]+/i;

export function extractFirstUrl(body: string): string | null {
  const match = URL_RE.exec(body);
  if (!match) return null;
  const url = match[0].replace(/[.,!?;:]+$/, '');
  return url.length <= MAX_URL_LENGTH ? url : null;
}

function isPrivateIpv4(address: string) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4) return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

function isPrivateIpv6(address: string) {
  const lower = address.toLowerCase();
  if (lower === '::' || lower === '::1') return true;
  if (lower.startsWith('::ffff:')) return isPrivateIpv4(lower.slice(7));
  // fc00::/7 (unique local), fe80::/10 (link local)
  return lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb');
}

function isPrivateAddress(address: string) {
  const version = isIP(address);
  if (version === 4) return isPrivateIpv4(address);
  if (version === 6) return isPrivateIpv6(address);
  return true;
}

async function assertPublicHost(hostname: string) {
  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw new Error('private address');
    return;
  }
  const results = await lookup(hostname, { all: true });
  if (results.length === 0) throw new Error('unresolvable host');
  for (const result of results) {
    if (isPrivateAddress(result.address)) throw new Error('private address');
  }
}

async function readBodyCapped(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    chunks.push(value);
    if (total >= maxBytes) {
      void reader.cancel().catch(() => undefined);
      break;
    }
  }
  return Buffer.concat(chunks, Math.min(total, maxBytes)).toString('utf8');
}

function decodeEntities(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

function metaContent(html: string, key: string): string {
  // <meta property="og:title" content="..."> in either attribute order.
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["']`, 'i')
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match?.[1]) return decodeEntities(match[1]).trim();
  }
  return '';
}

function parsePreview(html: string, finalUrl: string): LinkPreview | null {
  const title = metaContent(html, 'og:title') || decodeEntities(/<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] ?? '').trim();
  if (!title) return null;
  const description = (metaContent(html, 'og:description') || metaContent(html, 'description')).slice(0, 300);
  let imageUrl = metaContent(html, 'og:image') || metaContent(html, 'twitter:image');
  if (imageUrl) {
    try {
      const resolved = new URL(imageUrl, finalUrl);
      imageUrl = resolved.protocol === 'http:' || resolved.protocol === 'https:' ? resolved.toString() : '';
    } catch {
      imageUrl = '';
    }
  }
  const siteName = metaContent(html, 'og:site_name') || new URL(finalUrl).hostname.replace(/^www\./, '');
  return {
    url: finalUrl,
    title: title.slice(0, 200),
    description,
    imageUrl: imageUrl.slice(0, MAX_URL_LENGTH),
    siteName: siteName.slice(0, 100)
  };
}

async function fetchPreview(url: string): Promise<LinkPreview | null> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const parsed = new URL(current);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    await assertPublicHost(parsed.hostname);

    const response = await fetch(current, {
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml' }
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      void response.body?.cancel().catch(() => undefined);
      if (!location) return null;
      current = new URL(location, current).toString();
      continue;
    }

    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      return null;
    }
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('text/html')) {
      void response.body?.cancel().catch(() => undefined);
      return null;
    }
    const html = await readBodyCapped(response, MAX_HTML_BYTES);
    return parsePreview(html, current);
  }
  return null;
}

function urlHash(url: string) {
  return createHash('sha256').update(url).digest('hex');
}

// Fetch a preview for the first URL in `body`, using the Postgres cache.
// Returns null on any failure — previews are strictly best-effort.
export async function getLinkPreviewForBody(body: string): Promise<LinkPreview | null> {
  const url = extractFirstUrl(body);
  if (!url) return null;

  try {
    const hash = urlHash(url);
    const cached = await pool.query<{ data: LinkPreview | null; fetched_at: Date }>(
      'SELECT data, fetched_at FROM link_previews WHERE url_hash = $1',
      [hash]
    );
    const row = cached.rows[0];
    if (row && Date.now() - row.fetched_at.getTime() < CACHE_TTL_MS) {
      return row.data;
    }

    let preview: LinkPreview | null = null;
    try {
      preview = await fetchPreview(url);
    } catch {
      preview = null;
    }

    // Cache failures too (data = NULL) so a dead link is not re-fetched on
    // every message that repeats it.
    await pool.query(
      `
        INSERT INTO link_previews (url_hash, url, data, fetched_at)
        VALUES ($1, $2, $3::jsonb, NOW())
        ON CONFLICT (url_hash) DO UPDATE SET data = EXCLUDED.data, fetched_at = NOW()
      `,
      [hash, url.slice(0, MAX_URL_LENGTH), preview ? JSON.stringify(preview) : null]
    );
    return preview;
  } catch {
    return null;
  }
}
