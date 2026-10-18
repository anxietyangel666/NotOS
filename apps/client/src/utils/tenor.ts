// Minimal Tenor (GIF search) client used by the combined emoji/GIF picker.
//
// Tenor's v2 API returns curated/searched GIFs. A demo/anonymous key ships as a
// sensible default so the feature works out of the box, but a production build
// should provide its own key via `VITE_TENOR_KEY` to avoid rate limits.

import { getApiBaseUrl } from '../api/client';

const TENOR_BASE = 'https://tenor.googleapis.com/v2';
const GIPHY_BASE = 'https://api.giphy.com/v1/gifs';

// Tenor's well-known public demo key. Override at build time with VITE_TENOR_KEY.
const TENOR_KEY = (import.meta.env.VITE_TENOR_KEY as string | undefined) ?? 'AIzaSyAyimkuYQYF_FXVALexPuGQctUWRURdCYQ';

// A stable client key keeps anonymous usage attributable per the Tenor ToS.
const CLIENT_KEY = 'notoc';
const GIPHY_KEY = (import.meta.env.VITE_GIPHY_KEY as string | undefined) ?? 'dc6zaTOxFJmzC';
const GIF_PAGE_SIZE = 24;

export type TenorGif = {
  id: string;
  // Full-size animated GIF URL, used when the GIF is sent into a chat.
  url: string;
  // Smaller animated preview URL, shown inside the picker grid.
  previewUrl: string;
  description: string;
  width: number;
  height: number;
};

type TenorMediaFormat = { url: string; dims?: [number, number] };
type TenorResult = {
  id: string;
  content_description?: string;
  media_formats?: Record<string, TenorMediaFormat>;
};

type GiphyImage = { url?: string; width?: string; height?: string };
type GiphyResult = {
  id: string;
  title?: string;
  images?: {
    fixed_width_small?: GiphyImage;
    fixed_width?: GiphyImage;
    original?: GiphyImage;
    downsized?: GiphyImage;
  };
};

function mapResults(results: TenorResult[]): TenorGif[] {
  return results
    .map((item) => {
      const formats = item.media_formats ?? {};
      // Prefer compact formats for sending; fall back through the size ladder.
      const full = formats.tinygif ?? formats.gif ?? formats.mediumgif;
      const preview = formats.nanogif ?? formats.tinygif ?? full;
      if (!full?.url || !preview?.url) return null;
      const [w, h] = full.dims ?? [0, 0];
      return {
        id: item.id,
        url: full.url,
        previewUrl: preview.url,
        description: item.content_description ?? 'GIF',
        width: w,
        height: h
      } satisfies TenorGif;
    })
    .filter((gif): gif is TenorGif => gif !== null);
}

// A page of GIF results plus Tenor's opaque `next` cursor. Pass the cursor back
// as `pos` to load the following page (infinite scroll). An empty `next` means
// there are no more results to load.
export type GifPage = {
  gifs: TenorGif[];
  next: string;
};

async function tenorRequest(path: string, params: Record<string, string>): Promise<GifPage> {
  const query = new URLSearchParams({
    key: TENOR_KEY,
    client_key: CLIENT_KEY,
    media_filter: 'tinygif,nanogif,gif',
    limit: String(GIF_PAGE_SIZE),
    ...params
  });
  const response = await fetch(`${TENOR_BASE}/${path}?${query.toString()}`);
  if (!response.ok) throw new Error(`Tenor request failed: ${response.status}`);
  const data = (await response.json()) as { results?: TenorResult[]; next?: string };
  return { gifs: mapResults(data.results ?? []), next: data.next ?? '' };
}

function mapGiphyResults(results: GiphyResult[]): TenorGif[] {
  return results
    .map((item) => {
      const images = item.images ?? {};
      const full = images.fixed_width ?? images.downsized ?? images.original;
      const preview = images.fixed_width_small ?? full;
      if (!full?.url || !preview?.url) return null;
      return {
        id: `giphy:${item.id}`,
        url: full.url,
        previewUrl: preview.url,
        description: item.title || 'GIF',
        width: Number(full.width ?? 0) || 0,
        height: Number(full.height ?? 0) || 0
      } satisfies TenorGif;
    })
    .filter((gif): gif is TenorGif => gif !== null);
}

async function giphyRequest(path: 'trending' | 'search', params: Record<string, string>): Promise<GifPage> {
  const offset = params.pos?.startsWith('giphy:') ? Number(params.pos.slice(6)) || 0 : 0;
  const limit = params.limit ?? String(GIF_PAGE_SIZE);
  const query = new URLSearchParams({
    api_key: GIPHY_KEY,
    limit,
    offset: String(offset),
    rating: 'pg-13',
    lang: params.locale?.slice(0, 2) || 'en'
  });
  if (path === 'search') query.set('q', params.q ?? '');
  const response = await fetch(`${GIPHY_BASE}/${path}?${query.toString()}`);
  if (!response.ok) throw new Error(`Giphy request failed: ${response.status}`);
  const data = (await response.json()) as { data?: GiphyResult[]; pagination?: { total_count?: number; offset?: number; count?: number } };
  const gifs = mapGiphyResults(data.data ?? []);
  const pagination = data.pagination;
  const nextOffset = (pagination?.offset ?? offset) + (pagination?.count ?? gifs.length);
  const total = pagination?.total_count ?? nextOffset;
  return { gifs, next: nextOffset < total ? `giphy:${nextOffset}` : '' };
}

async function gifRequest(path: 'featured' | 'search', params: Record<string, string>): Promise<GifPage> {
  try {
    const query = new URLSearchParams(params);
    const response = await fetch(`${getApiBaseUrl()}/api/gifs/${path}?${query.toString()}`);
    if (response.ok) return (await response.json()) as GifPage;
  } catch {
    /* fall through to direct providers when the API server is not reachable */
  }

  if (params.pos?.startsWith('giphy:')) {
    return giphyRequest(path === 'featured' ? 'trending' : 'search', params);
  }
  try {
    const page = await tenorRequest(path, params);
    if (page.gifs.length > 0) return page;
  } catch {
    /* fall through to Giphy */
  }
  return giphyRequest(path === 'featured' ? 'trending' : 'search', params);
}

/**
 * Trending GIFs shown when the search box is empty. Pass `pos` (the `next`
 * cursor from a previous page) to fetch the following page.
 */
export function fetchTrendingGifs(locale = 'en_US', pos = ''): Promise<GifPage> {
  return gifRequest('featured', pos ? { locale, pos } : { locale });
}

/**
 * Search GIFs by a free-text query. Pass `pos` (the `next` cursor from a
 * previous page) to fetch the following page.
 */
export function searchGifs(query: string, locale = 'en_US', pos = ''): Promise<GifPage> {
  const trimmed = query.trim();
  if (!trimmed) return fetchTrendingGifs(locale, pos);
  return gifRequest('search', pos ? { q: trimmed, locale, pos } : { q: trimmed, locale });
}

// Discord-style fixed category tiles. Each tile searches Tenor for its term and
// uses the first result as the preview thumbnail shown on the category grid.
export type GifCategory = { id: string; term: string };

export const GIF_CATEGORIES: GifCategory[] = [
  { id: 'reactions', term: 'reaction' },
  { id: 'happy', term: 'happy' },
  { id: 'sad', term: 'sad' },
  { id: 'love', term: 'love' },
  { id: 'angry', term: 'angry' },
  { id: 'laugh', term: 'laughing' },
  { id: 'dance', term: 'dance' },
  { id: 'cute', term: 'cute' },
  { id: 'wow', term: 'surprised' },
  { id: 'thumbsup', term: 'thumbs up' },
  { id: 'facepalm', term: 'facepalm' },
  { id: 'hug', term: 'hug' },
  { id: 'cat', term: 'cat' },
  { id: 'dog', term: 'dog' },
  { id: 'meme', term: 'meme' },
  { id: 'gaming', term: 'gaming' },
  { id: 'anime', term: 'anime' },
  { id: 'sports', term: 'sports' }
];

// Fetch a single representative GIF for a category tile thumbnail.
export async function fetchCategoryPreview(term: string, locale = 'en_US'): Promise<TenorGif | null> {
  const page = await gifRequest('search', { q: term, locale, limit: '1' });
  return page.gifs[0] ?? null;
}

// ---- Favorite GIFs (persisted locally, like Discord's GIF favorites) --------

const FAVORITES_KEY = 'notoc.gif.favorites';

function readFavorites(): TenorGif[] {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as TenorGif[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function getFavoriteGifs(): TenorGif[] {
  return readFavorites();
}

// Two GIFs are considered the same favorite when their id OR their playable URL
// match. This keeps favorites consistent whether a GIF was starred from the
// picker (real Tenor id) or from a chat message (URL only).
function sameGif(a: TenorGif, b: TenorGif): boolean {
  return a.id === b.id || a.url === b.url;
}

// Build a TenorGif from a bare URL (used for chat messages that only carry the
// GIF URL). The URL doubles as a stable id.
export function gifFromUrl(url: string, description = 'GIF'): TenorGif {
  return { id: url, url, previewUrl: url, description, width: 0, height: 0 };
}

export function isFavoriteGif(gif: TenorGif): boolean {
  return readFavorites().some((item) => sameGif(item, gif));
}

export function isFavoriteGifUrl(url: string): boolean {
  return isFavoriteGif(gifFromUrl(url));
}

// Lightweight pub/sub so every mounted star (picker + chat bubbles) updates the
// moment favorites change anywhere in the app.
type FavoritesListener = () => void;
const favoriteListeners = new Set<FavoritesListener>();

export function subscribeFavoriteGifs(listener: FavoritesListener): () => void {
  favoriteListeners.add(listener);
  return () => {
    favoriteListeners.delete(listener);
  };
}

function emitFavoritesChanged() {
  favoriteListeners.forEach((listener) => listener());
}

// Toggle a GIF's favorite state and return the resulting favorites list. New
// favorites are prepended so the most recently starred GIF shows first.
export function toggleFavoriteGif(gif: TenorGif): TenorGif[] {
  const current = readFavorites();
  const exists = current.some((item) => sameGif(item, gif));
  const next = exists ? current.filter((item) => !sameGif(item, gif)) : [gif, ...current];
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota errors */
  }
  emitFavoritesChanged();
  return next;
}

// Map the app's language code to a Tenor locale string.
export function tenorLocale(language: string): string {
  switch (language) {
    case 'ru':
      return 'ru_RU';
    case 'uk':
      return 'uk_UA';
    case 'zh':
      return 'zh_CN';
    case 'zh-TW':
      return 'zh_TW';
    default:
      return 'en_US';
  }
}
