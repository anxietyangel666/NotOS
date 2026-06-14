import type { Language, MessengerMessage } from '../api/types';
import { t } from '../i18n';

// Call log messages are persisted server-side with a machine-readable marker body
// like "[call:ended:125]" so every client can render them in its own language.
export type CallMarker = {
  kind: 'ended' | 'missed' | 'declined' | 'cancelled';
  duration: number;
};

const CALL_MARKER_RE = /^\[call:(ended|missed|declined|cancelled):(\d+)\]$/;

export function parseCallMarker(body: string | null | undefined): CallMarker | null {
  if (!body) return null;
  const match = CALL_MARKER_RE.exec(body.trim());
  if (!match) return null;
  return {
    kind: match[1] as CallMarker['kind'],
    duration: Number(match[2])
  };
}

export function formatCallDuration(seconds: number) {
  const safe = Math.max(0, Math.round(seconds));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Returns the localized label for a call log message, or null when the message
// is a regular chat message. The sender of a call message is always the caller.
export function callMessageLabel(
  message: Pick<MessengerMessage, 'body' | 'senderId'>,
  currentUserId: string,
  language: Language
): string | null {
  const marker = parseCallMarker(message.body);
  if (!marker) return null;
  const callerIsMe = message.senderId === currentUserId;
  if (marker.kind === 'ended') return t(language, 'callEndedDuration', { duration: formatCallDuration(marker.duration) });
  if (marker.kind === 'missed') return callerIsMe ? t(language, 'callNoAnswer') : t(language, 'callMissed');
  if (marker.kind === 'declined') return t(language, 'callDeclined');
  return t(language, 'callCancelled');
}
