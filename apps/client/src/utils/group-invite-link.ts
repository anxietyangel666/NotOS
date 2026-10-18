// Group invite deep-links.
//
// Bare invite codes still work for old messages, but newly shared invites use
// /g/<code> so the same message can later live behind a real domain by setting
// VITE_GROUP_INVITE_LINK_BASE at build time.

const INVITE_CODE = 'gc_[A-Za-z0-9]{12}';

export const GROUP_INVITE_LINK_RE = new RegExp(
  `(?:(${INVITE_CODE}))|(?:notoc://invite/(${INVITE_CODE}))|(?:/g/(${INVITE_CODE}))|(?:[?&](?:g|invite)=(${INVITE_CODE}))`,
  'g'
);

export function groupInviteLinkBase() {
  const configured = import.meta.env.VITE_GROUP_INVITE_LINK_BASE as string | undefined;
  if (configured && configured.trim()) return configured.replace(/\/+$/, '');
  if (typeof window !== 'undefined' && window.location?.origin) {
    const o = window.location.origin;
    if (!o.includes('localhost') && !o.includes('127.0.0.1') && !o.startsWith('file:')) {
      return o;
    }
  }
  return 'https://notos.tech';
}

export function buildGroupInviteLink(inviteCode: string, channelId?: string | null) {
  const base = groupInviteLinkBase();
  const channelQuery = channelId ? `?channelId=${encodeURIComponent(channelId)}` : '';
  return base ? `${base}/g/${inviteCode}${channelQuery}` : `${inviteCode}${channelQuery}`;
}

export function extractGroupInviteCode(text: string) {
  GROUP_INVITE_LINK_RE.lastIndex = 0;
  const match = GROUP_INVITE_LINK_RE.exec(text);
  if (!match) return null;
  return match[1] ?? match[2] ?? match[3] ?? match[4] ?? null;
}

export function extractGroupInviteChannelId(text: string) {
  const match = /[?&]channelId=([0-9a-fA-F-]{36})/.exec(text);
  return match?.[1] ?? null;
}
