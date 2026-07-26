// ---- Recently used emoji (persisted locally, like Discord's "Frequently used")
//
// Both unicode emoji (e.g. "😀") and custom-emoji tokens (e.g.
// "<ce:name:https://.../emoji.png>") are stored as plain strings in a single
// most-recently-used list. The emoji picker renders a "Recent" category from
// this list and every selection (regular or custom) records into it.

const RECENT_KEY = 'notoc.emoji.recent';
const MAX_RECENT = 36;

function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as string[];
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string' && item.length > 0) : [];
  } catch {
    return [];
  }
}

export function getRecentEmoji(): string[] {
  return readRecent();
}

// Lightweight pub/sub so an open picker updates the moment a new emoji is used.
type RecentListener = () => void;
const recentListeners = new Set<RecentListener>();

export function subscribeRecentEmoji(listener: RecentListener): () => void {
  recentListeners.add(listener);
  return () => {
    recentListeners.delete(listener);
  };
}

function emitRecentChanged() {
  recentListeners.forEach((listener) => listener());
}

// Record an emoji use. The value is moved to the front (most recent first),
// de-duplicated, and the list is capped to MAX_RECENT entries.
export function recordRecentEmoji(value: string): void {
  const trimmed = value.trim();
  if (!trimmed) return;
  const current = readRecent();
  const next = [trimmed, ...current.filter((item) => item !== trimmed)].slice(0, MAX_RECENT);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota errors */
  }
  emitRecentChanged();
}
