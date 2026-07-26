/**
 * In-memory cache for PublicUser profiles.
 *
 * Eliminates redundant `api.getPublicUser()` calls that previously fired on
 * every incoming messenger notification, call toast, etc.
 *
 * The cache is intentionally simple:
 *  - Entries expire after TTL_MS (2 minutes) so stale avatars/nicknames
 *    are eventually refreshed.
 *  - `invalidate(id)` is called whenever the server emits `desktop:userChanged`
 *    so the next fetch always gets fresh data for that user.
 *  - `getOrFetch` deduplicates concurrent requests for the same userId so a
 *    burst of notifications for the same sender only triggers one HTTP call.
 */
import type { PublicUser } from './types';

const TTL_MS = 2 * 60 * 1000; // 2 minutes
const CURRENT_USER_STORAGE_KEY = 'notoc.currentUser';

type CacheEntry = {
  user: PublicUser;
  expiresAt: number;
};

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<PublicUser>>();

/** Store or refresh a user that was already fetched / received via socket. */
export function cacheUser(user: PublicUser): void {
  cache.set(user.id, { user, expiresAt: Date.now() + TTL_MS });
}

export function cacheCurrentUser(user: PublicUser): void {
  cacheUser(user);
  try {
    localStorage.setItem(CURRENT_USER_STORAGE_KEY, JSON.stringify(user));
  } catch {
    // Persistent cache is only a startup optimization.
  }
}

export function loadCachedCurrentUser(): PublicUser | null {
  try {
    const raw = localStorage.getItem(CURRENT_USER_STORAGE_KEY);
    if (!raw) return null;
    const user = JSON.parse(raw) as PublicUser;
    if (!user || typeof user.id !== 'string') return null;
    cacheUser(user);
    return user;
  } catch {
    return null;
  }
}

export function clearCachedCurrentUser(): void {
  try {
    localStorage.removeItem(CURRENT_USER_STORAGE_KEY);
  } catch {
    // ignore storage errors
  }
}

/**
 * Return the cached user even when the entry has expired. Used to paint
 * heavy fields (profile wallpaper) instantly while a fresh fetch runs —
 * a stale wallpaper beats an empty one.
 */
export function getCachedUser(id: string): PublicUser | null {
  return cache.get(id)?.user ?? null;
}

/** Remove a user from the cache (e.g. after `desktop:userChanged`). */
export function invalidateUser(id: string): void {
  cache.delete(id);
  // Don't cancel inflight — the result will just overwrite the cache entry.
}

/**
 * Return the cached user if fresh, otherwise fetch via the provided fetcher
 * function. Concurrent calls for the same id share a single in-flight request.
 */
export async function getOrFetchUser(
  id: string,
  fetcher: (id: string) => Promise<PublicUser>
): Promise<PublicUser> {
  const entry = cache.get(id);
  if (entry && entry.expiresAt > Date.now()) {
    return entry.user;
  }

  const existing = inflight.get(id);
  if (existing) return existing;

  const promise = fetcher(id).then((user) => {
    cacheUser(user);
    inflight.delete(id);
    return user;
  }).catch((error) => {
    inflight.delete(id);
    throw error;
  });

  inflight.set(id, promise);
  return promise;
}
