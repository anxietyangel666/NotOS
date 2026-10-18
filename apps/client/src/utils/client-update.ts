import clientPackage from '../../package.json';
import { getApiBaseUrl } from '../api/client';

export type ClientUpdateManifest = {
  version?: string;
  url?: string;
  bundleUrl?: string;
  installerUrl?: string;
  notes?: string;
  required?: boolean;
  publishedAt?: string;
};

export type ClientUpdateStatus =
  | {
      state: 'available';
      currentVersion: string;
      latestVersion: string;
      url: string;
      installerUrl: string;
      notes: string;
      required: boolean;
      publishedAt: string;
    }
  | {
      state: 'current';
      currentVersion: string;
      latestVersion: string;
      notes: string;
      publishedAt: string;
    }
  | {
      state: 'error';
      currentVersion: string;
      message: string;
    };

function parseVersion(version: string) {
  return version
    .split(/[.-]/)
    .map((part) => Number.parseInt(part.replace(/\D+/g, ''), 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}

export function compareVersions(a: string, b: string) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  const length = Math.max(left.length, right.length, 3);
  for (let index = 0; index < length; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export async function getCurrentClientVersion() {
  try {
    const version = await window.notoc?.getAppVersion?.();
    if (version) return version;
  } catch {
    // Browser/dev fallback below.
  }
  return clientPackage.version;
}

export async function checkServerConnection() {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${getApiBaseUrl()}/health`, {
      cache: 'no-store',
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return true;
  } finally {
    window.clearTimeout(timeout);
  }
}

function resolveUpdateUrl(url: string | undefined): string {
  if (!url) return '';
  const trimmed = url.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }
  const base = getApiBaseUrl().replace(/\/+$/, '');
  return `${base}${trimmed.startsWith('/') ? '' : '/'}${trimmed}`;
}

export async function checkClientUpdate(): Promise<ClientUpdateStatus> {
  const currentVersion = await getCurrentClientVersion();
  try {
    const isElectronWithUpdater = typeof window !== 'undefined' && Boolean(window.notoc?.startUpdate);
    const query = isElectronWithUpdater ? '?type=bundle' : '?type=installer';
    const response = await fetch(`${getApiBaseUrl()}/api/client/update${query}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const manifest = (await response.json()) as ClientUpdateManifest;
    const latestVersion = manifest.version?.trim() || currentVersion;
    const notes = manifest.notes?.trim() || '';
    const publishedAt = manifest.publishedAt?.trim() || '';

    if (compareVersions(latestVersion, currentVersion) > 0) {
      const rawUrl = manifest.url?.trim() || '';
      const rawBundle = manifest.bundleUrl?.trim() || (rawUrl.endsWith('.zip') ? rawUrl : '');
      const rawInstaller = manifest.installerUrl?.trim() || (rawUrl.endsWith('.exe') ? rawUrl : '');

      const bundleUrl = resolveUpdateUrl(rawBundle);
      const installerUrl = resolveUpdateUrl(rawInstaller);
      const fallbackUrl = resolveUpdateUrl(rawUrl);

      return {
        state: 'available',
        currentVersion,
        latestVersion,
        url: bundleUrl || fallbackUrl || installerUrl,
        installerUrl: installerUrl || fallbackUrl,
        notes,
        required: Boolean(manifest.required),
        publishedAt
      };
    }

    return {
      state: 'current',
      currentVersion,
      latestVersion,
      notes,
      publishedAt
    };
  } catch (error) {
    return {
      state: 'error',
      currentVersion,
      message: error instanceof Error ? error.message : 'Update check failed'
    };
  }
}
