const WATCH_INVITE_CODE = '[A-Za-z0-9_-]{10}';

export const WATCH_INVITE_LINK_RE = new RegExp(
  `(?:\\[watch:(${WATCH_INVITE_CODE})\\]\\s*([^\\n\\r]*))|(?:[?&]watch=(${WATCH_INVITE_CODE}))|(?:/watch/(${WATCH_INVITE_CODE}))`,
  'g'
);

export type WatchInvite = {
  code: string;
  title?: string;
};

export function watchInviteLinkBase() {
  const configured = import.meta.env.VITE_WATCH_INVITE_LINK_BASE as string | undefined;
  if (configured && configured.trim()) return configured.replace(/\/+$/, '');
  if (typeof window !== 'undefined' && window.location?.origin) {
    const o = window.location.origin;
    if (!o.includes('localhost') && !o.includes('127.0.0.1') && !o.startsWith('file:')) {
      return o;
    }
  }
  return 'https://notos.tech';
}

export function buildWatchInviteLink(inviteCode: string) {
  const base = watchInviteLinkBase();
  return base ? `${base}/?watch=${encodeURIComponent(inviteCode)}` : `[watch:${inviteCode}]`;
}

export function extractWatchInvite(text: string): WatchInvite | null {
  WATCH_INVITE_LINK_RE.lastIndex = 0;
  const match = WATCH_INVITE_LINK_RE.exec(text);
  if (!match) return null;
  const code = match[1] ?? match[3] ?? match[4] ?? null;
  if (!code) return null;
  const title = match[2]?.trim();
  return title ? { code, title } : { code };
}
