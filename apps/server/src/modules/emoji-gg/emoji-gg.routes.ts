import { Router } from 'express';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { asyncHandler } from '../../http/async-handler.js';
import { HttpError } from '../../http/errors.js';

// Server-side proxy/scraper for emoji.gg.
//
// emoji.gg's public JSON API caps out at ~100 packs (its `/api/packs` endpoint
// ignores `?page=`) and its category filter is unusable. The website itself,
// however, paginates through the full catalogue of packs at /packs?page=N and
// lists every emoji on each pack's page. Browsers cannot scrape those HTML pages
// directly (no CORS headers), so we do it here on the server and hand the client
// clean JSON in the same shape the existing emoji.gg client code already uses.

const SITE_BASE = 'https://emoji.gg';
const CDN_BASE = 'https://cdn3.emoji.gg/emojis';

// ── In-memory response cache ──────────────────────────────────────────────
// emoji.gg's catalogue barely changes minute-to-minute, but scraping it is the
// slow part (a network round-trip + HTML parse per request, and the pack
// browser fires one request PER pack). Caching the finished JSON payloads makes
// repeat opens near-instant and collapses concurrent identical scrapes into a
// single upstream fetch (so 24 simultaneous /pack calls for the same slug only
// hit emoji.gg once). Entries are small JSON; we cap the map and evict the
// oldest to keep memory bounded.
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const CACHE_MAX_ENTRIES = 1000;
const IMAGE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const IMAGE_CACHE_MAX_ENTRIES = 2000;
const MAX_MIRROR_IMAGE_BYTES = 1_250_000;

type CacheEntry = { expires: number; value: unknown };
const responseCache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<unknown>>();
type ImageCacheEntry = { expires: number; contentType: string; bytes: Buffer };
const imageCache = new Map<string, ImageCacheEntry>();
const imageInflight = new Map<string, Promise<ImageCacheEntry>>();

function readCache<T>(key: string): T | undefined {
  const hit = responseCache.get(key);
  if (!hit) return undefined;
  if (hit.expires <= Date.now()) {
    responseCache.delete(key);
    return undefined;
  }
  return hit.value as T;
}

function writeCache(key: string, value: unknown): void {
  if (responseCache.size >= CACHE_MAX_ENTRIES) {
    const oldest = responseCache.keys().next().value;
    if (oldest !== undefined) responseCache.delete(oldest);
  }
  responseCache.set(key, { expires: Date.now() + CACHE_TTL_MS, value });
}

// Return a cached payload for `key`, or run `produce()` once — deduping any
// concurrent callers asking for the same key onto a single in-flight promise.
async function cached<T>(key: string, produce: () => Promise<T>): Promise<T> {
  const hit = readCache<T>(key);
  if (hit !== undefined) return hit;

  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;

  const promise = (async () => {
    const value = await produce();
    writeCache(key, value);
    return value;
  })();
  inflight.set(key, promise);
  try {
    return await promise;
  } finally {
    inflight.delete(key);
  }
}

// A short, polite timeout + a browser-like UA so emoji.gg serves the full page.
async function fetchHtml(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml'
      }
    });
    if (!response.ok) throw new HttpError(502, `emoji.gg responded ${response.status}`, 'UPSTREAM_ERROR');
    return await response.text();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, 'Failed to reach emoji.gg', 'UPSTREAM_ERROR');
  } finally {
    clearTimeout(timer);
  }
}

function imageContentType(value: string | null): string {
  const type = value?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  return /^image\/(?:png|gif|jpe?g|webp)$/.test(type) ? type : '';
}

function readImageCache(key: string): ImageCacheEntry | undefined {
  const hit = imageCache.get(key);
  if (!hit) return undefined;
  if (hit.expires <= Date.now()) {
    imageCache.delete(key);
    return undefined;
  }
  return hit;
}

function writeImageCache(key: string, entry: ImageCacheEntry): ImageCacheEntry {
  if (imageCache.size >= IMAGE_CACHE_MAX_ENTRIES) {
    const oldest = imageCache.keys().next().value;
    if (oldest !== undefined) imageCache.delete(oldest);
  }
  imageCache.set(key, entry);
  return entry;
}

async function fetchImage(url: string, options: { validateHost?: boolean } = {}): Promise<ImageCacheEntry> {
  const cachedImage = readImageCache(url);
  if (cachedImage) return cachedImage;

  const existing = imageInflight.get(url);
  if (existing) return existing;

  const promise = (async () => {
    if (options.validateHost) await assertPublicHttpUrl(url);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
          Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
        }
      });
      if (!response.ok) throw new HttpError(502, `Image responded ${response.status}`, 'UPSTREAM_ERROR');
      const contentType = imageContentType(response.headers.get('content-type'));
      if (!contentType) throw new HttpError(415, 'Unsupported image type', 'UNSUPPORTED_IMAGE_TYPE');

      const length = Number(response.headers.get('content-length') ?? 0);
      if (length > MAX_MIRROR_IMAGE_BYTES) throw new HttpError(413, 'Image is too large', 'IMAGE_TOO_LARGE');

      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.byteLength > MAX_MIRROR_IMAGE_BYTES) throw new HttpError(413, 'Image is too large', 'IMAGE_TOO_LARGE');

      return writeImageCache(url, { expires: Date.now() + IMAGE_CACHE_TTL_MS, contentType, bytes });
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(502, 'Failed to fetch image', 'UPSTREAM_ERROR');
    } finally {
      clearTimeout(timer);
    }
  })();

  imageInflight.set(url, promise);
  try {
    return await promise;
  } finally {
    imageInflight.delete(url);
  }
}

function isPrivateIp(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      a === 0;
  }
  const normalized = address.toLowerCase();
  return normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80:') ||
    normalized === '::';
}

async function assertPublicHttpUrl(rawUrl: string) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new HttpError(400, 'Invalid image URL', 'INVALID_URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new HttpError(400, 'Only http(s) images are supported', 'INVALID_URL');
  }
  if (!url.hostname || url.username || url.password) {
    throw new HttpError(400, 'Invalid image URL', 'INVALID_URL');
  }
  if (isPrivateIp(url.hostname)) throw new HttpError(400, 'Private hosts are not allowed', 'INVALID_URL');

  const addresses = await lookup(url.hostname, { all: true }).catch(() => []);
  if (addresses.length === 0 || addresses.some((entry) => isPrivateIp(entry.address))) {
    throw new HttpError(400, 'Private hosts are not allowed', 'INVALID_URL');
  }
}

function emojiGgImageUrl(file: string) {
  return `${CDN_BASE}/${file}`;
}

type ScrapedPack = {
  id: string;
  slug: string;
  name: string;
};

// Decode common HTML entities that show up in pack names (e.g. &amp;, &#039;).
function decodeEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&rsquo;|&#8217;/g, '\u2019')
    .replace(/&nbsp;/g, ' ');
}

// Turn a slug like "430039-cats" into a readable fallback name ("Cats").
function nameFromSlug(slug: string): string {
  const withoutId = slug.replace(/^\d+-/, '');
  const words = withoutId.replace(/[-_]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : slug;
}

// Parse a /packs listing page into a de-duplicated list of packs. Each pack is
// linked twice (a "View" button and the titled link); we keep the first
// readable, non-"View" anchor text as the name and fall back to the slug.
function parsePacksListing(html: string): ScrapedPack[] {
  const anchorRe = /<a[^>]+href="(?:https:\/\/emoji\.gg)?\/pack\/([A-Za-z0-9_-]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const bySlug = new Map<string, ScrapedPack>();
  let match: RegExpExecArray | null;

  while ((match = anchorRe.exec(html)) !== null) {
    const slug = match[1];
    const text = decodeEntities(match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    const idMatch = slug.match(/^(\d+)/);
    const id = idMatch ? idMatch[1] : slug;
    const existing = bySlug.get(slug);
    const isUsableName = text && text.toLowerCase() !== 'view';

    if (!existing) {
      bySlug.set(slug, { id, slug, name: isUsableName ? text : nameFromSlug(slug) });
    } else if (isUsableName && (existing.name === nameFromSlug(slug) || !existing.name)) {
      existing.name = text;
    }
  }

  return Array.from(bySlug.values());
}

// CDN images that appear on every page's chrome (ad-block / Android banners,
// store badges) rather than belonging to the pack. They must be excluded so
// packs do not gain a few bogus "emojis".
const PACK_NOISE_FILES = new Set(['play-store.png', '1114-annoyed2.png', '517918-wechat-ok.png']);

// Parse a single pack page into its emoji image file list. The page references
// every emoji via its CDN URL (https://cdn3.emoji.gg/emojis/<file>).
function parsePackEmojis(html: string): string[] {
  const urlRe = /https:\/\/cdn3?\.emoji\.gg\/emojis\/([A-Za-z0-9_.\-]+\.(?:png|gif|jpg|jpeg|webp))/gi;
  const files = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = urlRe.exec(html)) !== null) {
    if (PACK_NOISE_FILES.has(match[1])) continue;
    files.add(match[1]);
  }
  return Array.from(files);
}

type ScrapedEmoji = {
  id: string;
  name: string;
  url: string;
};

// Parse an emoji grid page (the homepage, a search results page like
// /emojis/<query>, or a category page like /category/<id>/<slug>) into a list of
// emojis. Each card carries a `.png/.gif` extension badge, a /emoji/<id>-<slug>
// link and a titled <a class="… h4">Name</a>; the CDN image URL is rebuilt from
// the id, slug and extension. Cards are matched individually so the extension
// badge always pairs with the right emoji.
function parseEmojiGrid(html: string): ScrapedEmoji[] {
  const cards: ScrapedEmoji[] = [];
  const seen = new Set<string>();
  const cardRe = /<div class="card asset-card">([\s\S]*?)<div class="card-body">([\s\S]*?)<\/div>/g;
  let match: RegExpExecArray | null;

  while ((match = cardRe.exec(html)) !== null) {
    const block = match[1] + match[2];
    const link = block.match(/\/emoji\/(\d+)-([A-Za-z0-9_-]+)/);
    if (!link) continue;
    const id = link[1];
    const slug = link[2];
    if (seen.has(id)) continue;
    seen.add(id);

    const extMatch = block.match(/item-badge-left">\.(png|gif|jpg|jpeg|webp)/i);
    const ext = (extMatch ? extMatch[1] : 'png').toLowerCase();
    const titleMatch = block.match(/class="fw-semibold[^"]*h4">([^<]+)</);
    const name = titleMatch ? decodeEntities(titleMatch[1].trim()) : nameFromSlug(`${id}-${slug}`);

    cards.push({ id: `gg-${id}`, name, url: `${CDN_BASE}/${id}-${slug}.${ext}` });
  }

  return cards;
}

// Whether an emoji grid page advertises a "Next Page" link (its infinite-scroll
// pagination marker). Lets the client know if it can keep paging.
function hasNextPage(html: string): boolean {
  return /class="next-page/.test(html) || /id="pagination"[\s\S]{0,400}page=\d+/.test(html);
}

// The site serves only ~25 emojis per page, which feels sparse in the picker, so
// each logical "client page" aggregates several site pages into one response.
const SITE_PAGES_PER_BATCH = 4;

// Fetch and merge SITE_PAGES_PER_BATCH consecutive site pages starting at the
// 1-based `clientPage`, returning the de-duplicated emoji list plus whether more
// pages likely exist. `buildUrl(sitePage)` produces the URL for a given site
// page so this works for both search and category grids.
async function fetchEmojiBatch(
  clientPage: number,
  buildUrl: (sitePage: number) => string
): Promise<{ emojis: ScrapedEmoji[]; hasMore: boolean }> {
  const firstSitePage = (clientPage - 1) * SITE_PAGES_PER_BATCH + 1;
  const sitePages = Array.from({ length: SITE_PAGES_PER_BATCH }, (_, index) => firstSitePage + index);

  // Fetch the pages in parallel; a failed page yields an empty grid rather than
  // aborting the whole batch.
  const htmls = await Promise.all(
    sitePages.map(async (sitePage) => {
      try {
        return await fetchHtml(buildUrl(sitePage));
      } catch {
        return '';
      }
    })
  );

  const seen = new Set<string>();
  const emojis: ScrapedEmoji[] = [];
  let lastHasNext = false;
  for (const html of htmls) {
    if (!html) continue;
    lastHasNext = hasNextPage(html);
    for (const emoji of parseEmojiGrid(html)) {
      if (seen.has(emoji.id)) continue;
      seen.add(emoji.id);
      emojis.push(emoji);
    }
  }

  return { emojis, hasMore: emojis.length > 0 && lastHasNext };
}

export function createEmojiGgRouter(): Router {
  const router = Router();

  // List packs from a listing page. `?page=N` (1-based) maps straight to the
  // site's own pagination. With `?q=<query>` it searches packs through the
  // site's own pack search (`/packs/<query>`), which also paginates.
  router.get(
    '/packs',
    asyncHandler(async (req, res) => {
      const pageRaw = Number(req.query.page ?? 1);
      const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1;
      const query = String(req.query.q ?? '').trim();
      // Pack search lives at /packs/<query>; keep the query URL-safe the same way
      // emoji.gg slugs are (lowercase words separated by hyphens).
      const safeQuery = query.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

      const base = safeQuery ? `${SITE_BASE}/packs/${encodeURIComponent(safeQuery)}` : `${SITE_BASE}/packs`;
      const url = page > 1 ? `${base}?page=${page}` : base;
      const payload = await cached(`packs:${url}`, async () => {
        const html = await fetchHtml(url);
        const packs = parsePacksListing(html);
        // The packs listing has no explicit "next" marker, so a non-empty page is
        // treated as "there may be more"; the client stops when a page is empty.
        return { page, query: safeQuery, packs, hasMore: packs.length > 0 };
      });
      res.set('Cache-Control', 'public, max-age=600');
      res.json(payload);
    })
  );

  // Fetch the emojis for a single pack by its slug (e.g. "430039-cats").
  router.get(
    '/pack',
    asyncHandler(async (req, res) => {
      const slug = String(req.query.slug ?? '').trim();
      if (!/^[A-Za-z0-9_-]+$/.test(slug)) {
        throw new HttpError(400, 'Invalid pack slug', 'INVALID_SLUG');
      }
      const payload = await cached(`pack:${slug}`, async () => {
        const html = await fetchHtml(`${SITE_BASE}/pack/${slug}`);
        const files = parsePackEmojis(html);
        const titleMatch = html.match(/<title>([^<]*)<\/title>/);
        const name = titleMatch ? decodeEntities(titleMatch[1].replace(/\s*-\s*Emoji Pack.*/i, '').trim()) : nameFromSlug(slug);
        const emojis = files.map((file) => ({ file, url: `/api/emoji-gg/image/${encodeURIComponent(file)}` }));
        return { slug, name, emojis };
      });
      res.set('Cache-Control', 'public, max-age=600');
      res.json(payload);
    })
  );

  router.get(
    '/image/:file',
    asyncHandler(async (req, res) => {
      const file = String(req.params.file ?? '');
      if (!/^[A-Za-z0-9_.-]+\.(?:png|gif|jpg|jpeg|webp)$/i.test(file) || file.includes('..')) {
        throw new HttpError(400, 'Invalid image file', 'INVALID_IMAGE_FILE');
      }
      const image = await fetchImage(emojiGgImageUrl(file));
      res.set('Cache-Control', 'public, max-age=86400, immutable');
      res.type(image.contentType);
      res.send(image.bytes);
    })
  );

  router.get(
    '/mirror-image',
    asyncHandler(async (req, res) => {
      const url = String(req.query.url ?? '').trim();
      const image = await fetchImage(url, { validateHost: true });
      res.set('Cache-Control', 'public, max-age=86400');
      res.type(image.contentType);
      res.send(image.bytes);
    })
  );

  router.post(
    '/mirror',
    asyncHandler(async (req, res) => {
      const url = String((req.body as { url?: unknown } | undefined)?.url ?? '').trim();
      const image = await fetchImage(url, { validateHost: true });
      res.set('Cache-Control', 'no-store');
      res.json({
        dataUrl: `data:${image.contentType};base64,${image.bytes.toString('base64')}`
      });
    })
  );

  // Search emojis straight through the website (`/emojis/<query>?page=N`), which
  // covers the full ~125k catalogue rather than the capped public JSON API. An
  // empty query falls back to the homepage's featured/recent grid.
  router.get(
    '/emojis',
    asyncHandler(async (req, res) => {
      const query = String(req.query.q ?? '').trim();
      const pageRaw = Number(req.query.page ?? 1);
      const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1;
      // Keep the query URL-safe; emoji.gg slugs are lowercase words separated by
      // hyphens, so collapse whitespace to single hyphens and drop odd chars.
      const safeQuery = query.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

      const base = safeQuery ? `${SITE_BASE}/emojis/${encodeURIComponent(safeQuery)}` : SITE_BASE;
      const payload = await cached(`emojis:${safeQuery}:${page}`, async () => {
        const { emojis, hasMore } = await fetchEmojiBatch(page, (sitePage) =>
          sitePage > 1 ? `${base}?page=${sitePage}` : base
        );
        return { query: safeQuery, page, emojis, hasMore };
      });
      res.set('Cache-Control', 'public, max-age=600');
      res.json(payload);
    })
  );

  // List emojis for a category page (`/category/<id>/<slug>?page=N`). Only the
  // numeric id matters; the slug is cosmetic, so a stable placeholder is fine.
  router.get(
    '/category',
    asyncHandler(async (req, res) => {
      const idRaw = Number(req.query.id);
      if (!Number.isFinite(idRaw) || idRaw < 1) {
        throw new HttpError(400, 'Invalid category id', 'INVALID_CATEGORY');
      }
      const id = Math.floor(idRaw);
      const pageRaw = Number(req.query.page ?? 1);
      const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1;
      const slug = String(req.query.slug ?? 'category').replace(/[^A-Za-z0-9_-]/g, '') || 'category';

      const base = `${SITE_BASE}/category/${id}/${slug}`;
      const payload = await cached(`category:${id}:${page}`, async () => {
        const { emojis, hasMore } = await fetchEmojiBatch(page, (sitePage) =>
          sitePage > 1 ? `${base}?page=${sitePage}` : base
        );
        return { id, page, emojis, hasMore };
      });
      res.set('Cache-Control', 'public, max-age=600');
      res.json(payload);
    })
  );

  return router;
}
