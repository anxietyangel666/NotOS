import type { AuthFileBundle } from '../api/types';

export function downloadAuthFile(authFile: AuthFileBundle) {
  if (window.notoc?.platform === 'electron') {
    return window.notoc.saveAuthFile(authFile);
  }

  const blob = new Blob([authFile.content], { type: authFile.mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = authFile.filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);

  return Promise.resolve({ canceled: false as const, filePath: authFile.filename });
}

export async function openNativeAuthFile() {
  if (!window.notoc?.openAuthFile) return null;

  const result = await window.notoc.openAuthFile();
  if (result.canceled) return null;
  return result;
}

export async function openNativeImageFile() {
  if (!window.notoc?.openImageFile) return null;

  const result = await window.notoc.openImageFile();
  if (result.canceled) return null;
  return result;
}

export function readFileAsText(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.readAsText(file);
  });
}

export function readImageAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Не удалось прочитать изображение'));
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.readAsDataURL(file);
  });
}

export function createGeneratedAvatar(nickname: string) {
  const initials = nickname
    .trim()
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || 'NO';
  const hue = Array.from(nickname).reduce((sum, char) => sum + char.charCodeAt(0), 210) % 360;
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="hsl(${hue}, 85%, 60%)"/>
          <stop offset="1" stop-color="hsl(${(hue + 80) % 360}, 85%, 34%)"/>
        </linearGradient>
      </defs>
      <rect width="256" height="256" rx="72" fill="url(#g)"/>
      <text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle" fill="white" font-family="Inter, Arial" font-size="84" font-weight="800">${initials}</text>
    </svg>`;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
