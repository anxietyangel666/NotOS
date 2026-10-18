// Custom emoji support, modeled on Discord's emoji packs.
//
// Two data sources feed the same store:
//   1. emoji.gg — a public catalog of ~5000 emojis and curated packs, browsed
//      and imported from the desktop settings.
//   2. User-built packs — a user gives a pack a name and drops emojis into it.
//
// Installed packs are persisted locally and surfaced both in the emoji picker
// (a "Custom" tab grouped by pack name) and rendered inline in chat messages
// through a `:shortcode:`-style token.

import { getApiBaseUrl } from '../api/client';
import { loadCachedCurrentUser } from '../api/user-cache';

// ---- emoji.gg API -----------------------------------------------------------

const EMOJI_GG_BASE = 'https://emoji.gg/api';

// Our own server-side scraper for emoji.gg's website. Used to page through the
// full catalogue of packs (the public JSON API caps at ~100 and ignores paging).
function emojiGgProxy() {
  return `${getApiBaseUrl()}/api/emoji-gg`;
}

// emoji.gg can be slow or briefly unavailable. Wrap fetches in a generous
// timeout (its catalog payload is large) and retry once on failure so a single
// slow response does not surface as a hard "could not load" error.
async function fetchJson(url: string, { timeout = 15000, retries = 1 }: { timeout?: number; retries?: number } = {}): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      // No custom headers: keep the request a CORS "simple" request to avoid a
      // preflight that emoji.gg may not answer.
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`emoji.gg responded ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('emoji.gg request failed');
}

// A single custom emoji. `name` is the shortcode (without colons), `url` is the
// image (usually a PNG/GIF served by emoji.gg or a user-provided URL).
export type CustomEmoji = {
  id: string;
  name: string;
  url: string;
  // Optional category from emoji.gg, kept for search/filtering.
  category?: string;
};

// A named collection of custom emojis. `source` distinguishes catalog imports
// from user-authored packs so the UI can label/manage them differently.
export type CustomEmojiPack = {
  id: string;
  name: string;
  source: 'emoji.gg' | 'custom';
  emojis: CustomEmoji[];
  // For packs installed from a shared link, the id of the pack at the source.
  // Lets us detect "this pack is already added" even though the local copy gets
  // a fresh local id.
  origin?: string;
};

// Raw emoji.gg catalog row.
type EmojiGgEmoji = {
  id: number;
  title: string;
  slug: string;
  image: string;
  category?: number | string;
};

// Raw emoji.gg pack row. `emojis` is a comma-separated string of image file
// names (e.g. "516856-uwuwumpus.png,957449-clydewitch.png"), each served from
// the emoji.gg CDN.
type EmojiGgPack = {
  id: number;
  name: string;
  emojis?: string;
};

// Base CDN path that emoji.gg pack image file names hang off of.
const EMOJI_GG_CDN = 'https://cdn3.emoji.gg/emojis';
const EMOJI_GG_CDN_RE = /^https:\/\/cdn3?\.emoji\.gg\/emojis\/([^?#]+)$/i;

function apiAssetUrl(path: string): string {
  return `${getApiBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
}

function emojiGgImageUrl(file: string): string {
  return apiAssetUrl(`/api/emoji-gg/image/${encodeURIComponent(file)}`);
}

export function mirrorCustomEmojiUrl(url: string): string {
  return apiAssetUrl(`/api/emoji-gg/mirror-image?url=${encodeURIComponent(url)}`);
}

export function normalizeCustomEmojiUrl(url: string): string {
  const trimmed = url.trim();
  const cdnMatch = trimmed.match(EMOJI_GG_CDN_RE);
  if (cdnMatch) return emojiGgImageUrl(cdnMatch[1]);
  if (trimmed.startsWith('/api/emoji-gg/image/') || trimmed.startsWith('/api/emoji-gg/mirror-image')) {
    return apiAssetUrl(trimmed);
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.pathname.startsWith('/api/emoji-gg/image/') || parsed.pathname.startsWith('/api/emoji-gg/mirror-image')) {
      return apiAssetUrl(`${parsed.pathname}${parsed.search}`);
    }
  } catch {
    /* keep non-URL values as-is */
  }
  return trimmed;
}

function normalizeCustomEmoji(emoji: CustomEmoji): CustomEmoji {
  return { ...emoji, url: normalizeCustomEmojiUrl(emoji.url) };
}

function normalizePack(pack: CustomEmojiPack): CustomEmojiPack {
  return { ...pack, emojis: pack.emojis.map(normalizeCustomEmoji) };
}

// Turn a pack's comma-separated file-name list into custom emojis. The shortcode
// is derived from the file name (dropping the numeric prefix and extension).
function packEmojis(files: string | undefined): CustomEmoji[] {
  if (!files) return [];
  return files
    .split(',')
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((file) => {
      const base = file.replace(/\.[a-z0-9]+$/i, '');
      const name = base.replace(/^\d+[-_]/, '') || base;
      return { id: `gg-pack-emoji-${file}`, name, url: emojiGgImageUrl(file) } satisfies CustomEmoji;
    });
}

// An emoji.gg category (id + display name), used to filter the catalog.
export type EmojiGgCategory = {
  id: string;
  name: string;
};

function mapEmoji(row: EmojiGgEmoji): CustomEmoji {
  return {
    id: `gg-${row.id}`,
    name: row.slug || row.title,
    url: normalizeCustomEmojiUrl(row.image),
    category: row.category != null ? String(row.category) : undefined
  };
}

// Fetch the full emoji.gg catalog (~5450 emojis). This is the complete public
// catalog: emoji.gg's API ignores `?page=` and `?category=` on this endpoint and
// always returns the same single payload, so there is nothing more to page or
// filter server-side. Category filtering happens client-side over `category`.
export async function fetchEmojiGgCatalog(): Promise<CustomEmoji[]> {
  // The catalog payload is large, so allow it extra time before failing.
  const rows = await fetchJson(`${EMOJI_GG_BASE}/`, { timeout: 20000 });
  return Array.isArray(rows) ? (rows as EmojiGgEmoji[]).map(mapEmoji) : [];
}

// The full emoji.gg category list, taken straight from the website's category
// menu. We now scrape category pages (every one of these returns emojis), so
// unlike the public JSON API none of these are "empty" and unusable. The slug is
// kept so links/labels match the site exactly.
const EMOJI_GG_CATEGORIES: { id: string; name: string; slug: string }[] = [
  { id: '1', name: 'Original Style', slug: 'original-style' },
  { id: '18', name: 'Recolors', slug: 'recolors' },
  { id: '2', name: 'TV / Movie', slug: 'tv-movie' },
  { id: '10', name: 'Gaming', slug: 'gaming' },
  { id: '3', name: 'Meme', slug: 'meme' },
  { id: '4', name: 'Anime', slug: 'anime' },
  { id: '13', name: 'Pepe', slug: 'pepe' },
  { id: '5', name: 'Celebrity', slug: 'celebrity' },
  { id: '21', name: 'Pixel Art', slug: 'pixel-art' },
  { id: '6', name: 'Blobs', slug: 'blobs' },
  { id: '7', name: 'Thinking', slug: 'thinking' },
  { id: '17', name: 'Animals', slug: 'animals' },
  { id: '15', name: 'Cute', slug: 'cute' },
  { id: '23', name: 'Aesthetic', slug: 'aesthetic' },
  { id: '11', name: 'Letters', slug: 'letters' },
  { id: '22', name: 'Reactions', slug: 'reactions' },
  { id: '14', name: 'Logos', slug: 'logos' },
  { id: '16', name: 'Utility', slug: 'utility' },
  { id: '19', name: 'Flags', slug: 'flags' },
  { id: '20', name: 'Hearts', slug: 'hearts' },
  { id: '12', name: 'Other', slug: 'other' },
  { id: '8', name: 'Animated', slug: 'animated' }
];

// The emoji.gg categories. Served from the static, complete site list above so
// every category is selectable (the public JSON API only exposed a subset).
export async function fetchEmojiGgCategories(): Promise<EmojiGgCategory[]> {
  return EMOJI_GG_CATEGORIES.map(({ id, name }) => ({ id, name }));
}

// Shape returned by our server-side emoji.gg scraper.
type ScrapedPackRow = { id: string; slug: string; name: string };
type ScrapedPackEmojis = { slug: string; name: string; emojis: { file: string; url: string }[] };

// Build CustomEmoji[] from the scraper's {file,url} list. The shortcode is the
// file name without its numeric prefix and extension (matching packEmojis()).
function emojisFromFiles(files: { file: string; url: string }[]): CustomEmoji[] {
  return files.map(({ file, url }) => {
    const base = file.replace(/\.[a-z0-9]+$/i, '');
    const name = base.replace(/^\d+[-_]/, '') || base;
    return { id: `gg-pack-emoji-${file}`, name, url: normalizeCustomEmojiUrl(url) } satisfies CustomEmoji;
  });
}

// Run async tasks with a bounded concurrency so we do not fire dozens of
// requests at the scraper at once.
async function mapWithConcurrency<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await task(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

// A page of packs fetched lazily from the site (one listing page = ~24 packs).
// `hasMore` lets the UI decide whether to reveal the next page on demand.
export type EmojiGgPackPage = {
  page: number;
  packs: CustomEmojiPack[];
  hasMore: boolean;
};

// Fetch a SINGLE page of curated packs from emoji.gg via our server-side
// scraper, resolving each pack's emojis with bounded concurrency. Paging the
// site lazily (one page at a time) keeps the Browse tab fast: we no longer pull
// hundreds of packs up front. With a `query`, packs are searched through the
// site's own pack search. The public JSON API is used only as a fallback for an
// unfiltered page 1 when the scraper is unreachable.
export async function fetchEmojiGgPacks(page = 1, query = ''): Promise<EmojiGgPackPage> {
  let rows: ScrapedPackRow[] = [];
  let hasMore = false;
  const search = query.trim();

  try {
    const params = search ? `page=${page}&q=${encodeURIComponent(search)}` : `page=${page}`;
    const payload = (await fetchJson(`${emojiGgProxy()}/packs?${params}`)) as {
      packs?: ScrapedPackRow[];
      hasMore?: boolean;
    };
    rows = Array.isArray(payload?.packs) ? payload.packs : [];
    hasMore = Boolean(payload?.hasMore) && rows.length > 0;
  } catch {
    rows = [];
  }

  // Fallback: if the scraper is down, an unfiltered first page falls back to the
  // public JSON API (≤100 packs, already emoji-resolved) so the tab is never
  // empty. A search with no results simply returns empty.
  if (rows.length === 0) {
    if (page > 1 || search) return { page, packs: [], hasMore: false };
    try {
      const apiRows = (await fetchJson(`${EMOJI_GG_BASE}/packs`)) as EmojiGgPack[];
      if (!Array.isArray(apiRows)) return { page, packs: [], hasMore: false };
      const packs = apiRows.map((pack) => ({
        id: `gg-pack-${pack.id}`,
        name: pack.name,
        source: 'emoji.gg' as const,
        emojis: packEmojis(pack.emojis)
      }));
      return { page, packs, hasMore: false };
    } catch {
      return { page, packs: [], hasMore: false };
    }
  }

  // Resolve each pack's emojis. Packs whose emoji page fails are dropped. These
  // requests hit our own caching proxy (which dedupes and memoizes upstream
  // scrapes), so a higher concurrency just means fewer waves — repeat opens are
  // served from cache almost instantly.
  const resolved = await mapWithConcurrency(rows, 10, async (row): Promise<CustomEmojiPack> => {
    let emojis: CustomEmoji[] = [];
    try {
      const detail = (await fetchJson(`${emojiGgProxy()}/pack?slug=${encodeURIComponent(row.slug)}`)) as ScrapedPackEmojis;
      emojis = emojisFromFiles(Array.isArray(detail?.emojis) ? detail.emojis : []);
    } catch {
      emojis = [];
    }
    return { id: `gg-pack-${row.id}`, name: row.name, source: 'emoji.gg' as const, emojis };
  });

  return { page, packs: resolved.filter((pack) => pack.emojis.length > 0), hasMore };
}

// A page of individual emojis scraped from the site (search results or a
// category listing). `hasMore` mirrors the site's "Next Page" marker.
export type EmojiGgEmojiPage = {
  page: number;
  emojis: CustomEmoji[];
  hasMore: boolean;
};

// Shape returned by the scraper's emoji-grid endpoints.
type ScrapedEmojiRow = { id: string; name: string; url: string };

function mapScrapedEmojis(rows: unknown): CustomEmoji[] {
  if (!Array.isArray(rows)) return [];
  return (rows as ScrapedEmojiRow[])
    .filter((row) => row && row.id && row.url)
    .map((row) => ({ id: row.id, name: row.name, url: normalizeCustomEmojiUrl(row.url) } satisfies CustomEmoji));
}

// Search emojis directly through the emoji.gg website (covers the full ~125k
// catalogue), one page at a time. An empty query returns the site's featured
// grid. The scraper handles the actual HTTP + parsing.
export async function searchEmojiGgEmojis(query: string, page = 1): Promise<EmojiGgEmojiPage> {
  try {
    const payload = (await fetchJson(`${emojiGgProxy()}/emojis?q=${encodeURIComponent(query)}&page=${page}`)) as {
      emojis?: unknown;
      hasMore?: boolean;
    };
    const emojis = mapScrapedEmojis(payload?.emojis);
    return { page, emojis, hasMore: Boolean(payload?.hasMore) && emojis.length > 0 };
  } catch {
    return { page, emojis: [], hasMore: false };
  }
}

// List a category's emojis directly through the website (e.g. /category/1/…),
// one page at a time. The numeric id is what matters; slug is cosmetic.
export async function fetchEmojiGgCategoryEmojis(categoryId: string, page = 1): Promise<EmojiGgEmojiPage> {
  try {
    const payload = (await fetchJson(`${emojiGgProxy()}/category?id=${encodeURIComponent(categoryId)}&page=${page}`)) as {
      emojis?: unknown;
      hasMore?: boolean;
    };
    const emojis = mapScrapedEmojis(payload?.emojis);
    return { page, emojis, hasMore: Boolean(payload?.hasMore) && emojis.length > 0 };
  } catch {
    return { page, emojis: [], hasMore: false };
  }
}

// ---- Installed pack store (persisted locally) -------------------------------

function getPacksKey(userId?: string): string {
  const uid = userId || loadCachedCurrentUser()?.id;
  return uid ? `notoc.custom-emoji.packs.${encodeURIComponent(uid)}` : 'notoc.custom-emoji.packs';
}

function readPacks(userId?: string): CustomEmojiPack[] {
  try {
    const raw = localStorage.getItem(getPacksKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CustomEmojiPack[];
    return Array.isArray(parsed) ? parsed.map(normalizePack) : [];
  } catch {
    return [];
  }
}

function writePacks(packs: CustomEmojiPack[], userId?: string) {
  try {
    localStorage.setItem(getPacksKey(userId), JSON.stringify(packs));
  } catch {
    /* ignore quota errors */
  }
  emitChanged();
}

export function getInstalledPacks(): CustomEmojiPack[] {
  return readPacks();
}

// Lightweight pub/sub so the picker and settings stay in sync when packs change.
type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeCustomEmoji(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emitChanged() {
  listeners.forEach((listener) => listener());
}

export function isPackInstalled(packId: string): boolean {
  return readPacks().some((pack) => pack.id === packId);
}

// Install (or replace) a pack. Re-installing the same id refreshes its emojis.
export function installPack(pack: CustomEmojiPack): CustomEmojiPack[] {
  const normalized = normalizePack(pack);
  const packs = readPacks().filter((item) => item.id !== normalized.id);
  const next = [normalized, ...packs];
  writePacks(next);
  return next;
}

export function removePack(packId: string): CustomEmojiPack[] {
  const next = readPacks().filter((pack) => pack.id !== packId);
  writePacks(next);
  return next;
}

// Create an empty user-authored pack with the given name.
export function createCustomPack(name: string): CustomEmojiPack {
  const pack: CustomEmojiPack = {
    id: `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: name.trim() || 'Pack',
    source: 'custom',
    emojis: []
  };
  installPack(pack);
  return pack;
}

export function renamePack(packId: string, name: string): CustomEmojiPack[] {
  const next = readPacks().map((pack) => (pack.id === packId ? { ...pack, name: name.trim() || pack.name } : pack));
  writePacks(next);
  return next;
}

// Add an emoji to a user-authored pack. Emojis are matched by name within a
// pack so re-adding the same shortcode replaces the image.
export function addEmojiToPack(packId: string, emoji: CustomEmoji): CustomEmojiPack[] {
  const normalized = normalizeCustomEmoji(emoji);
  const next = readPacks().map((pack) => {
    if (pack.id !== packId) return pack;
    const emojis = pack.emojis.filter((item) => item.name !== normalized.name);
    return { ...pack, emojis: [...emojis, normalized] };
  });
  writePacks(next);
  return next;
}

export function removeEmojiFromPack(packId: string, emojiId: string): CustomEmojiPack[] {
  const next = readPacks().map((pack) =>
    pack.id === packId ? { ...pack, emojis: pack.emojis.filter((emoji) => emoji.id !== emojiId) } : pack
  );
  writePacks(next);
  return next;
}

// ---- Inline rendering tokens ------------------------------------------------
//
// A custom emoji is sent into a chat as a self-describing token so the receiver
// can render it even without the pack installed:
//   <ce:shortcode:https://image-url>
// The shortcode is purely cosmetic (alt text / tooltip); the URL drives the
// rendered <img>.

const CE_TOKEN_RE = /<ce:([^:>]+):((?:https?:\/\/|data:image\/(?:png|gif|jpe?g|webp);base64,)[^\s<>]+)>/gi;

export function customEmojiToken(emoji: CustomEmoji): string {
  return `<ce:${emoji.name}:${normalizeCustomEmojiUrl(emoji.url)}>`;
}

// In-composer custom emoji are inserted as readable `:shortcode:` text rather
// than the full token, so the input stays clean. This session registry remembers
// the image URL for every shortcode the user has picked, so the shortcode can be
// expanded back into a full token when the message is sent.
const shortcodeRegistry = new Map<string, string>();

// The compact text inserted into the composer when a custom emoji is chosen.
export function customEmojiShortcode(emoji: CustomEmoji): string {
  shortcodeRegistry.set(emoji.name, normalizeCustomEmojiUrl(emoji.url));
  return `:${emoji.name}:`;
}

// Resolve a `:shortcode:` to its image URL, preferring the session registry and
// falling back to any installed pack that defines the same shortcode.
function lookupShortcodeUrl(name: string): string | undefined {
  const fromRegistry = shortcodeRegistry.get(name);
  if (fromRegistry) return fromRegistry;
  for (const pack of readPacks()) {
    const match = pack.emojis.find((emoji) => emoji.name === name);
    if (match) return match.url;
  }
  return undefined;
}

const SHORTCODE_RE = /:([a-z0-9_+-]+):/gi;

// Expand any known `:shortcode:` in a message body into a full custom-emoji
// token so receivers render it even without the pack installed. Unknown
// shortcodes (e.g. plain unicode aliases) are left untouched.
export function expandCustomEmojiShortcodes(text: string): string {
  // Split out any already-expanded custom-emoji tokens first so we never re-match
  // the `:shortcode:` that lives *inside* a `<ce:name:url>` token. Re-expanding an
  // already-expanded body would otherwise corrupt the token (rendering the emoji
  // together with its name).
  CE_TOKEN_RE.lastIndex = 0;
  const segments: string[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(CE_TOKEN_RE)) {
    const start = match.index ?? 0;
    segments.push(expandPlainShortcodes(text.slice(lastIndex, start)));
    segments.push(match[0]); // keep the existing token verbatim
    lastIndex = start + match[0].length;
  }
  segments.push(expandPlainShortcodes(text.slice(lastIndex)));
  return segments.join('');
}

// Expand `:shortcode:` tokens within a plain (token-free) text segment.
function expandPlainShortcodes(text: string): string {
  SHORTCODE_RE.lastIndex = 0;
  return text.replace(SHORTCODE_RE, (match, name: string) => {
    const url = lookupShortcodeUrl(name);
    return url ? `<ce:${name}:${url}>` : match;
  });
}

export type CustomEmojiPart =
  | { type: 'text'; value: string }
  | { type: 'custom-emoji'; name: string; url: string };

// Split a message body into text and custom-emoji parts. Anything that is not a
// custom-emoji token is returned verbatim so downstream emoji/media parsing
// still runs over it.
export function splitCustomEmoji(text: string): CustomEmojiPart[] {
  const parts: CustomEmojiPart[] = [];
  let lastIndex = 0;
  CE_TOKEN_RE.lastIndex = 0;
  for (const match of text.matchAll(CE_TOKEN_RE)) {
    const start = match.index ?? 0;
    if (start > lastIndex) parts.push({ type: 'text', value: text.slice(lastIndex, start) });
    parts.push({ type: 'custom-emoji', name: match[1], url: normalizeCustomEmojiUrl(match[2]) });
    lastIndex = start + match[0].length;
  }
  if (lastIndex < text.length) parts.push({ type: 'text', value: text.slice(lastIndex) });
  return parts;
}

export function hasCustomEmoji(text: string): boolean {
  CE_TOKEN_RE.lastIndex = 0;
  return CE_TOKEN_RE.test(text);
}

// Replace every custom-emoji token with its plain `:shortcode:` form. Used for
// text-only contexts (e.g. notifications) where an image cannot be rendered.
export function customEmojiToShortcodes(text: string): string {
  CE_TOKEN_RE.lastIndex = 0;
  return text.replace(CE_TOKEN_RE, (_match, name: string) => `:${name}:`);
}

// First custom emoji in a string, if any. Lets list previews show the emoji
// image inline (with its shortcode as the remaining text).
export function firstCustomEmoji(text: string): { name: string; url: string } | null {
  CE_TOKEN_RE.lastIndex = 0;
  const match = CE_TOKEN_RE.exec(text);
  return match ? { name: match[1], url: normalizeCustomEmojiUrl(match[2]) } : null;
}

// ---- Shareable pack links ---------------------------------------------------
//
// Packs live only in the sender's browser, so a shareable link carries the whole
// pack (and a snapshot of who shared it) inside the token itself. The receiver
// can render a rich embed and install the pack with no backend involved.
//
//   cep_<base64url(json)>
//
// where the JSON is { p: <pack>, by: { id, name, avatar } }.

const PACK_TOKEN_PREFIX = 'cep_';
const PACK_LINK_RE = /cep_([A-Za-z0-9_-]+)/g;

export type PackSharer = {
  id: string;
  name: string;
  avatar?: string;
};

export type SharedPack = {
  pack: CustomEmojiPack;
  sharedBy: PackSharer;
};

// UTF-8 safe base64url encode/decode (handles emoji names with non-ASCII chars).
function toBase64Url(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

// Compact wire shape for a shared pack. Most shared emojis are emoji.gg CDN
// images whose name is derivable from the file name, so we store just the file
// (`f`) instead of the full {id, name, url}. Anything else (custom URLs, or a
// non-default shortcode) keeps its url (`u`) and name (`n`). This keeps the
// `cep_…` token small enough to fit a chat message (server caps the body at
// 2000 chars), even for large emoji.gg packs.
type CompactEmoji = { f: string } | { u: string; n: string };
type CompactSharedPack = {
  v: 1;
  n: string; // pack name
  o?: string; // origin id
  e: CompactEmoji[];
  by: { id: string; name: string; avatar?: string };
};

// The shortcode emoji.gg derives from a CDN file name (numeric prefix + ext
// stripped), matching emojisFromFiles()/packEmojis().
function nameFromCdnFile(file: string): string {
  const base = file.replace(/\.[a-z0-9]+$/i, '');
  return base.replace(/^\d+[-_]/, '') || base;
}

// If an emoji is a standard emoji.gg CDN image, return its file name.
function cdnFileOf(emoji: CustomEmoji): string | null {
  const prefix = `${EMOJI_GG_CDN}/`;
  if (emoji.url.startsWith(prefix)) return emoji.url.slice(prefix.length);
  try {
    const parsed = new URL(emoji.url);
    const marker = '/api/emoji-gg/image/';
    if (parsed.pathname.startsWith(marker)) {
      return decodeURIComponent(parsed.pathname.slice(marker.length));
    }
  } catch {
    /* not a URL */
  }
  return null;
}

// The chat server caps a message body at 2000 chars. Keep the whole `cep_…`
// token (which may sit alongside other text) comfortably under that.
const MAX_PACK_TOKEN_LENGTH = 1800;

// Build the shareable `cep_…` link for a pack, embedding a sharer snapshot.
// Emojis beyond what fits in the token budget are dropped so the message is
// always sendable; the receiver still gets a valid, installable pack.
export function buildPackLink(pack: CustomEmojiPack, sharedBy: PackSharer): string {
  // Avatars can be large data URLs; only keep the sharer avatar if it is a URL
  // or a reasonably small data URL so the link stays manageable.
  const avatar = sharedBy.avatar && sharedBy.avatar.length < 60000 ? sharedBy.avatar : undefined;

  const compactEmojis: CompactEmoji[] = pack.emojis.map((emoji) => {
    const file = cdnFileOf(emoji);
    // Store just the file when the name matches the one derivable from it.
    if (file && nameFromCdnFile(file) === emoji.name) return { f: file };
    return { u: emoji.url, n: emoji.name };
  });

  const encode = (emojis: CompactEmoji[]) => {
    const compact: CompactSharedPack = {
      v: 1,
      n: pack.name,
      o: pack.origin ?? pack.id,
      e: emojis,
      by: { id: sharedBy.id, name: sharedBy.name, avatar }
    };
    return `${PACK_TOKEN_PREFIX}${toBase64Url(JSON.stringify(compact))}`;
  };

  let token = encode(compactEmojis);
  // If the pack is too big to fit, trim emojis until the token fits the budget.
  let emojis = compactEmojis;
  while (token.length > MAX_PACK_TOKEN_LENGTH && emojis.length > 1) {
    // Drop roughly proportional to the overflow to converge quickly.
    const keep = Math.max(1, Math.floor(emojis.length * (MAX_PACK_TOKEN_LENGTH / token.length)));
    emojis = emojis.slice(0, keep < emojis.length ? keep : emojis.length - 1);
    token = encode(emojis);
  }
  return token;
}

// Rebuild a full SharedPack from the compact wire shape.
function fromCompact(data: CompactSharedPack): SharedPack {
  const emojis: CustomEmoji[] = data.e.map((item) => {
    if ('f' in item) {
      return { id: `gg-pack-emoji-${item.f}`, name: nameFromCdnFile(item.f), url: emojiGgImageUrl(item.f) };
    }
    return { id: `url-${item.u}`, name: item.n, url: normalizeCustomEmojiUrl(item.u) };
  });
  return {
    pack: { id: data.o || `custom-${Date.now().toString(36)}`, name: data.n, source: 'custom', origin: data.o, emojis },
    sharedBy: { id: data.by.id, name: data.by.name, avatar: data.by.avatar }
  };
}

// Decode a single `cep_…` token back into a SharedPack, or null if invalid.
// Supports both the compact format (v:1) and the older full-pack format.
export function decodePackLink(token: string): SharedPack | null {
  const cleaned = token.startsWith(PACK_TOKEN_PREFIX) ? token.slice(PACK_TOKEN_PREFIX.length) : token;
  try {
    const data = JSON.parse(fromBase64Url(cleaned)) as CompactSharedPack | SharedPack;
    // Compact format.
    if ((data as CompactSharedPack).v === 1 && Array.isArray((data as CompactSharedPack).e)) {
      return fromCompact(data as CompactSharedPack);
    }
    // Legacy full-pack format.
    const legacy = data as SharedPack;
    if (legacy?.pack && Array.isArray(legacy.pack.emojis)) return { ...legacy, pack: normalizePack(legacy.pack) };
    return null;
  } catch {
    return null;
  }
}

// Find the first pack link inside arbitrary text and decode it, or null.
export function extractSharedPack(text: string): SharedPack | null {
  PACK_LINK_RE.lastIndex = 0;
  const match = PACK_LINK_RE.exec(text);
  if (!match) return null;
  return decodePackLink(match[1]);
}

// True if the body contains a pack link (so the bubble can hide the raw token).
export function hasPackLink(text: string): boolean {
  PACK_LINK_RE.lastIndex = 0;
  return PACK_LINK_RE.test(text);
}

// Remove pack-link tokens from a string (used to render the message body
// without the long, ugly token next to the embed).
export function stripPackLinks(text: string): string {
  PACK_LINK_RE.lastIndex = 0;
  return text.replace(PACK_LINK_RE, '').trim();
}

// A content signature for a pack: its name plus the sorted set of emoji URLs.
// Two packs with the same name and the same images are considered "the same"
// pack, regardless of their local ids.
export function packSignature(pack: CustomEmojiPack): string {
  const urls = pack.emojis.map((emoji) => emoji.url).sort();
  return `${pack.name.trim().toLowerCase()}|${urls.join('|')}`;
}

// Find the installed pack that matches a shared pack, if any. Matching is by the
// origin id first (most reliable) and falls back to a content signature so a
// pack added before origins were tracked is still recognised.
export function findInstalledSharedPack(shared: SharedPack): CustomEmojiPack | null {
  const targetSig = packSignature(shared.pack);
  const originId = shared.pack.id;
  for (const pack of readPacks()) {
    if (originId && (pack.origin === originId || pack.id === originId)) return pack;
    if (packSignature(pack) === targetSig) return pack;
  }
  return null;
}

// Install a shared pack under a fresh local id so it lands in "My packs" and can
// be edited independently of the sender's copy. If an identical pack is already
// installed, the existing one is returned unchanged (no duplicate is created).
export function installSharedPack(shared: SharedPack): CustomEmojiPack {
  const existing = findInstalledSharedPack(shared);
  if (existing) return existing;
  const localPack: CustomEmojiPack = {
    id: `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: shared.pack.name,
    source: 'custom',
    origin: shared.pack.id,
    emojis: shared.pack.emojis.map((emoji) => normalizeCustomEmoji(emoji))
  };
  installPack(localPack);
  return localPack;
}
