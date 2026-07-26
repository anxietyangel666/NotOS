// Forwarded-message encoding.
//
// Forwards are stored inside the normal message body (no server/schema change)
// using a compact, parseable marker so the recipient client can render a clean
// "Forwarded" card (Discord-style) instead of a raw "Forwarded from X:" line.
//
// Wire format (first line is the marker, the rest is the forwarded content):
//
//   notoc://forward/<base64(senderName)>[~<sourceId>]
//   <forwarded body...>
//   <forwarded body...>
//
// An optional caption typed by the forwarder is kept separate from the marker
// blob via a blank-line + sentinel so it renders as the forwarder's own text
// below the card.

const FORWARD_PREFIX = 'notoc://forward/';
const CAPTION_SENTINEL = '\n\u0000caption\u0000\n';

function encodeName(name: string): string {
  try {
    return btoa(unescape(encodeURIComponent(name)));
  } catch {
    return '';
  }
}

function decodeName(encoded: string): string {
  try {
    return decodeURIComponent(escape(atob(encoded)));
  } catch {
    return '';
  }
}

// Build the message body for a forwarded message.
export function encodeForward(senderName: string, body: string, caption: string, sourceId?: string | null): string {
  const marker = `${FORWARD_PREFIX}${encodeName(senderName)}${sourceId ? `~${sourceId}` : ''}`;
  const core = `${marker}\n${body}`;
  const trimmedCaption = caption.trim();
  return trimmedCaption ? `${core}${CAPTION_SENTINEL}${trimmedCaption}` : core;
}

export type ParsedForward = {
  senderName: string;
  sourceId: string | null;
  body: string;
  caption: string;
};

// Parse a message body. Returns null when the body is not a forward.
export function parseForward(rawBody: string): ParsedForward | null {
  if (!rawBody || !rawBody.startsWith(FORWARD_PREFIX)) return null;
  const newlineIndex = rawBody.indexOf('\n');
  if (newlineIndex === -1) return null;
  const encodedMarker = rawBody.slice(FORWARD_PREFIX.length, newlineIndex);
  const sourceIndex = encodedMarker.lastIndexOf('~');
  const encodedName = sourceIndex === -1 ? encodedMarker : encodedMarker.slice(0, sourceIndex);
  const sourceId = sourceIndex === -1 ? null : encodedMarker.slice(sourceIndex + 1) || null;
  let rest = rawBody.slice(newlineIndex + 1);
  let caption = '';
  const captionIndex = rest.indexOf(CAPTION_SENTINEL);
  if (captionIndex !== -1) {
    caption = rest.slice(captionIndex + CAPTION_SENTINEL.length);
    rest = rest.slice(0, captionIndex);
  }
  return { senderName: decodeName(encodedName), sourceId, body: rest, caption };
}

export function isForward(rawBody: string): boolean {
  return typeof rawBody === 'string' && rawBody.startsWith(FORWARD_PREFIX);
}
