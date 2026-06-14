// Extracts a dominant color from an avatar image so the call stage panels can be
// tinted with a hue taken from the avatar (Discord-spotlight style).

const cache = new Map<string, string>();

function clamp(n: number) {
  return Math.max(0, Math.min(255, Math.round(n)));
}

// Average the image's pixels, weighting towards more saturated/non-grey colors so
// the tint stays vivid instead of collapsing into a muddy grey.
function computeColor(image: HTMLImageElement): string {
  const size = 24;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return 'rgb(88, 101, 242)';
  ctx.drawImage(image, 0, 0, size, size);

  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, size, size).data;
  } catch {
    // Tainted canvas (cross-origin avatar); fall back to a neutral accent.
    return 'rgb(88, 101, 242)';
  }

  let r = 0;
  let g = 0;
  let b = 0;
  let weightSum = 0;
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (alpha < 16) continue;
    const pr = data[i];
    const pg = data[i + 1];
    const pb = data[i + 2];
    const max = Math.max(pr, pg, pb);
    const min = Math.min(pr, pg, pb);
    // Weight = how far the pixel is from grey, plus a small base so flat avatars
    // still contribute.
    const weight = (max - min) + 12;
    r += pr * weight;
    g += pg * weight;
    b += pb * weight;
    weightSum += weight;
  }

  if (weightSum === 0) return 'rgb(88, 101, 242)';
  return `rgb(${clamp(r / weightSum)}, ${clamp(g / weightSum)}, ${clamp(b / weightSum)})`;
}

// Resolve the dominant color of an avatar (data URL or remote URL). Cached so the
// same avatar is only sampled once.
export function getAvatarColor(src: string | undefined | null): Promise<string> {
  if (!src) return Promise.resolve('rgb(88, 101, 242)');
  const cached = cache.get(src);
  if (cached) return Promise.resolve(cached);

  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      const color = computeColor(image);
      cache.set(src, color);
      resolve(color);
    };
    image.onerror = () => resolve('rgb(88, 101, 242)');
    image.src = src;
  });
}
