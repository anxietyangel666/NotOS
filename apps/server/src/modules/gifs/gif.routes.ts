import { Router } from 'express';
import { z } from 'zod';
import { config } from '../../config.js';
import { asyncHandler } from '../../http/async-handler.js';
import { HttpError } from '../../http/errors.js';

const TENOR_BASE = 'https://tenor.googleapis.com/v2';
const GIPHY_BASE = 'https://api.giphy.com/v1/gifs';
const CLIENT_KEY = 'notoc';
const DEFAULT_LIMIT = 24;

type GifItem = {
  id: string;
  url: string;
  previewUrl: string;
  description: string;
  width: number;
  height: number;
};

type GifPage = {
  gifs: GifItem[];
  next: string;
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

const gifQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  locale: z.string().trim().max(16).optional(),
  pos: z.string().trim().max(128).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional()
});

function mapTenorResults(results: TenorResult[]): GifItem[] {
  return results
    .map((item) => {
      const formats = item.media_formats ?? {};
      const full = formats.tinygif ?? formats.gif ?? formats.mediumgif;
      const preview = formats.nanogif ?? formats.tinygif ?? full;
      if (!full?.url || !preview?.url) return null;
      const [width, height] = full.dims ?? [0, 0];
      return {
        id: item.id,
        url: full.url,
        previewUrl: preview.url,
        description: item.content_description ?? 'GIF',
        width,
        height
      };
    })
    .filter((item): item is GifItem => item !== null);
}

function mapGiphyResults(results: GiphyResult[]): GifItem[] {
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
      };
    })
    .filter((item): item is GifItem => item !== null);
}

async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
      }
    });
    if (!response.ok) throw new HttpError(502, `GIF provider responded ${response.status}`, 'UPSTREAM_ERROR');
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, 'Failed to reach GIF provider', 'UPSTREAM_ERROR');
  } finally {
    clearTimeout(timer);
  }
}

async function tenorRequest(path: 'featured' | 'search', input: z.infer<typeof gifQuerySchema>): Promise<GifPage> {
  const query = new URLSearchParams({
    key: config.tenorApiKey,
    client_key: CLIENT_KEY,
    media_filter: 'tinygif,nanogif,gif',
    limit: String(input.limit ?? DEFAULT_LIMIT),
    locale: input.locale ?? 'en_US'
  });
  if (input.pos) query.set('pos', input.pos);
  if (path === 'search') query.set('q', input.q ?? '');

  const data = await fetchJson<{ results?: TenorResult[]; next?: string }>(`${TENOR_BASE}/${path}?${query.toString()}`);
  return { gifs: mapTenorResults(data.results ?? []), next: data.next ?? '' };
}

async function giphyRequest(path: 'trending' | 'search', input: z.infer<typeof gifQuerySchema>): Promise<GifPage> {
  const offset = input.pos?.startsWith('giphy:') ? Number(input.pos.slice(6)) || 0 : 0;
  const query = new URLSearchParams({
    api_key: config.giphyApiKey,
    limit: String(input.limit ?? DEFAULT_LIMIT),
    offset: String(offset),
    rating: 'pg-13',
    lang: input.locale?.slice(0, 2) || 'en'
  });
  if (path === 'search') query.set('q', input.q ?? '');

  const data = await fetchJson<{ data?: GiphyResult[]; pagination?: { total_count?: number; offset?: number; count?: number } }>(
    `${GIPHY_BASE}/${path}?${query.toString()}`
  );
  const gifs = mapGiphyResults(data.data ?? []);
  const pagination = data.pagination;
  const nextOffset = (pagination?.offset ?? offset) + (pagination?.count ?? gifs.length);
  const total = pagination?.total_count ?? nextOffset;
  return { gifs, next: nextOffset < total ? `giphy:${nextOffset}` : '' };
}

async function gifRequest(path: 'featured' | 'search', input: z.infer<typeof gifQuerySchema>): Promise<GifPage> {
  if (input.pos?.startsWith('giphy:')) return giphyRequest(path === 'featured' ? 'trending' : 'search', input);

  try {
    const page = await tenorRequest(path, input);
    if (page.gifs.length > 0) return page;
  } catch {
    // Giphy covers cases where Tenor is rate-limited or blocked by the runtime.
  }

  return giphyRequest(path === 'featured' ? 'trending' : 'search', input);
}

export function createGifRouter() {
  const router = Router();

  router.get(
    '/featured',
    asyncHandler(async (req, res) => {
      const input = gifQuerySchema.parse(req.query);
      res.json(await gifRequest('featured', input));
    })
  );

  router.get(
    '/search',
    asyncHandler(async (req, res) => {
      const input = gifQuerySchema.parse(req.query);
      res.json(await gifRequest('search', input));
    })
  );

  return router;
}
