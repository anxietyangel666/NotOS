import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const FETCH_TIMEOUT_MS = 8000;
const MAX_BODY_BYTES = 512 * 1024; // 512 KB

function isPrivateIpv4(address: string) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return true;
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

export type DetectPlayerResult = {
  detected: boolean;
  kind: 'youtube' | 'url' | 'embed';
  value: string;
  title: string;
  originalUrl: string;
};

const YT_PATTERNS = [
  /(?:youtube\.com\/(?:watch\?.*v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/i
];

const DIRECT_VIDEO_EXTS = /\.(mp4|webm|ogg|ogv|mov|m4v|m3u8)(\?|$)/i;

const PLAYER_CDN_KEYWORDS = [
  'kodik',
  'alloha',
  'videocdn',
  'collaps',
  'lumex',
  'vidsrc',
  'streamguard',
  'cdnmovies',
  'nextembed',
  'voidboost',
  'hdrezka',
  'rutube.ru/play/embed',
  'rutube.ru/play',
  'vk.com/video_ext',
  'vkvideo.ru/video_ext',
  'vimeo.com/video',
  'youtube.com/embed',
  'dailymotion.com/embed',
  'video',
  'player',
  'embed',
  'stream',
  'movie',
  'film',
  'serial'
];

export async function detectPlayerFromUrl(rawUrl: string): Promise<DetectPlayerResult | null> {
  let targetUrl = rawUrl.trim();
  if (!/^https?:\/\//i.test(targetUrl)) {
    targetUrl = `https://${targetUrl}`;
  }

  // 1. Direct YouTube match
  for (const pattern of YT_PATTERNS) {
    const match = targetUrl.match(pattern);
    if (match) {
      return {
        detected: true,
        kind: 'youtube',
        value: match[1],
        title: 'YouTube Video',
        originalUrl: targetUrl
      };
    }
  }

  // 2. Direct VK Video match
  const vkMatch = targetUrl.match(/(?:vk\.com|vkvideo\.ru)\/(?:[^\/]*[?&]z=video|video|clip)?(-?\d+)_(\d+)/i);
  if (vkMatch) {
    const hashMatch = targetUrl.match(/[?&]hash=([a-zA-Z0-9]+)/i);
    const hashPart = hashMatch ? `&hash=${hashMatch[1]}` : '';
    return {
      detected: true,
      kind: 'embed',
      value: `https://vk.com/video_ext.php?oid=${vkMatch[1]}&id=${vkMatch[2]}${hashPart}&hd=2&autoplay=1`,
      title: 'VK Video',
      originalUrl: targetUrl
    };
  }

  // 3. Direct Rutube match
  const rutubeMatch = targetUrl.match(/rutube\.ru\/video\/([a-zA-Z0-9]+)/i);
  if (rutubeMatch) {
    return {
      detected: true,
      kind: 'embed',
      value: `https://rutube.ru/play/embed/${rutubeMatch[1]}/?autoplay=1`,
      title: 'Rutube Video',
      originalUrl: targetUrl
    };
  }

  // 4. Direct video file
  if (DIRECT_VIDEO_EXTS.test(targetUrl)) {
    return {
      detected: true,
      kind: 'url',
      value: targetUrl,
      title: targetUrl.split('/').pop()?.split('?')[0] || 'Video',
      originalUrl: targetUrl
    };
  }

  try {
    const parsed = new URL(targetUrl);
    await assertPublicHost(parsed.hostname);

    const response = await fetch(targetUrl, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7'
      },
      redirect: 'follow'
    });

    const finalUrl = response.url || targetUrl;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.startsWith('video/')) {
      return {
        detected: true,
        kind: 'url',
        value: finalUrl,
        title: 'Video',
        originalUrl: targetUrl
      };
    }

    const html = await readBodyCapped(response, MAX_BODY_BYTES);
    if (!html) return null;

    // Extract title
    let title = '';
    const titleMatch = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
    if (titleMatch?.[1]) {
      title = decodeEntities(titleMatch[1]).trim();
    }
    const ogTitleMatch = /<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']*)["']/i.exec(html) ||
      /<meta[^>]+content=["']([^"']*)["'][^>]*property=["']og:title["']/i.exec(html);
    if (ogTitleMatch?.[1]) {
      title = decodeEntities(ogTitleMatch[1]).trim();
    }

    // 5. OpenGraph / Twitter video tags (skip self-referencing links)
    const ogVideoPatterns = [
      /<meta[^>]+(?:property|name)=["'](?:og:video:secure_url|og:video:url|og:video|twitter:player)["'][^>]*content=["']([^"']+)["']/gi,
      /<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:video:secure_url|og:video:url|og:video|twitter:player)["']/gi
    ];
    for (const pattern of ogVideoPatterns) {
      let ogMatch: RegExpExecArray | null;
      while ((ogMatch = pattern.exec(html)) !== null) {
        let embedCandidate = decodeEntities(ogMatch[1]).trim();
        if (embedCandidate.startsWith('//')) embedCandidate = `https:${embedCandidate}`;
        try {
          const resolved = new URL(embedCandidate, finalUrl);
          // Ignore self-referencing og:video that points back to the website page itself
          if (resolved.hostname === parsed.hostname && resolved.pathname === parsed.pathname) {
            continue;
          }
          const resolvedStr = resolved.toString();
          // Check if YouTube
          for (const p of YT_PATTERNS) {
            const ytMatch = resolvedStr.match(p);
            if (ytMatch) return { detected: true, kind: 'youtube', value: ytMatch[1], title: title || 'YouTube', originalUrl: targetUrl };
          }
          if (DIRECT_VIDEO_EXTS.test(resolvedStr)) {
            return { detected: true, kind: 'url', value: resolvedStr, title: title || 'Video', originalUrl: targetUrl };
          }
          return { detected: true, kind: 'embed', value: resolvedStr, title: title || 'Video Player', originalUrl: targetUrl };
        } catch {}
      }
    }

    // 6. Look for iframes (both src and data-src for lazy-loaded players)
    const iframeRegex = /<iframe[^>]+(?:src|data-src)=["']([^"']+)["']/gi;
    let iframeMatch: RegExpExecArray | null;
    const candidates: string[] = [];

    while ((iframeMatch = iframeRegex.exec(html)) !== null) {
      let src = decodeEntities(iframeMatch[1]).trim();
      if (src.startsWith('//')) src = `https:${src}`;
      try {
        const resolved = new URL(src, finalUrl).toString();
        candidates.push(resolved);
      } catch {}
    }

    // Prioritize candidates with known player / embed keywords
    for (const candidate of candidates) {
      const lower = candidate.toLowerCase();
      if (PLAYER_CDN_KEYWORDS.some((kw) => lower.includes(kw))) {
        for (const p of YT_PATTERNS) {
          const ytMatch = candidate.match(p);
          if (ytMatch) return { detected: true, kind: 'youtube', value: ytMatch[1], title: title || 'YouTube', originalUrl: targetUrl };
        }
        if (DIRECT_VIDEO_EXTS.test(candidate)) {
          return { detected: true, kind: 'url', value: candidate, title: title || 'Video', originalUrl: targetUrl };
        }
        return { detected: true, kind: 'embed', value: candidate, title: title || 'Video Player', originalUrl: targetUrl };
      }
    }

    // 7. Look for direct video / source tags
    const videoSrcRegex = /<(?:video|source)[^>]+src=["']([^"']+)["']/i;
    const videoMatch = videoSrcRegex.exec(html);
    if (videoMatch?.[1]) {
      let src = decodeEntities(videoMatch[1]).trim();
      if (src.startsWith('//')) src = `https:${src}`;
      try {
        const resolved = new URL(src, finalUrl).toString();
        return { detected: true, kind: 'url', value: resolved, title: title || 'Video', originalUrl: targetUrl };
      } catch {}
    }

    // 8. Look for m3u8 / mp4 in script tags (Playerjs, Alloha, etc.)
    const scriptFileMatch = /file:\s*["']([^"']+\.(?:m3u8|mp4|webm)(?:\?[^"']*)?)["']/i.exec(html);
    if (scriptFileMatch?.[1]) {
      let src = decodeEntities(scriptFileMatch[1]).trim();
      if (src.startsWith('//')) src = `https:${src}`;
      try {
        const resolved = new URL(src, finalUrl).toString();
        return { detected: true, kind: 'url', value: resolved, title: title || 'Video', originalUrl: targetUrl };
      } catch {}
    }

    // 9. If candidates has any iframe at all, take the first one
    if (candidates.length > 0) {
      return {
        detected: true,
        kind: 'embed',
        value: candidates[0],
        title: title || 'Video Player',
        originalUrl: targetUrl
      };
    }

    return null;
  } catch (error) {
    return null;
  }
}
