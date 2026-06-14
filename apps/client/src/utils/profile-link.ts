// Profile deep-links.
//
// A profile link is a short token of the form `np_<userId>` (np = NotOC profile).
// It is embedded into chat messages so the recipient can render a rich profile
// embed (avatar, nickname, "send message" and "add friend" actions).
//
// The full shareable URL is built from PROFILE_LINK_BASE. Today this resolves to
// the current host (typically an IP address). Later you can point it at a real
// domain by setting VITE_PROFILE_LINK_BASE at build time, without touching the
// embed-parsing logic below.

const TOKEN_PREFIX = 'np_';

// UUID v4, the shape of user ids in this project.
const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

// Matches a bare token (np_<uuid>) or a full URL ending in /p/<uuid> or ?p=<uuid>.
export const PROFILE_LINK_RE = new RegExp(
  `(?:${TOKEN_PREFIX}(${UUID}))|(?:/p/(${UUID}))|(?:[?&]p=(${UUID}))`,
  'g'
);

// Configurable base. Falls back to the current origin (IP-based today).
export function profileLinkBase() {
  const configured = import.meta.env.VITE_PROFILE_LINK_BASE as string | undefined;
  if (configured && configured.trim()) return configured.replace(/\/+$/, '');
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return '';
}

// Builds the full shareable link for a user id.
export function buildProfileLink(userId: string) {
  const base = profileLinkBase();
  return base ? `${base}/p/${userId}` : `${TOKEN_PREFIX}${userId}`;
}

// Extracts the first referenced user id from arbitrary text, or null.
export function extractProfileUserId(text: string) {
  PROFILE_LINK_RE.lastIndex = 0;
  const match = PROFILE_LINK_RE.exec(text);
  if (!match) return null;
  return match[1] ?? match[2] ?? match[3] ?? null;
}
