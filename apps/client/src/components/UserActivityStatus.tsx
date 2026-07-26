import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import type { UserActivity } from '../api/types';

type ActivityProvider = 'spotify' | 'riot';

type ActivityCacheEntry = {
  activities: UserActivity[];
  loadedAt: number;
  promise?: Promise<UserActivity[]>;
};

const ACTIVITY_CACHE_TTL_MS = 15_000;
const activityCache = new Map<string, ActivityCacheEntry>();

function cacheKey(token: string, userId: string, provider?: ActivityProvider) {
  return `${token.slice(0, 12)}:${userId}:${provider ?? 'all'}`;
}

async function loadActivities(token: string, userId: string, force = false, provider?: ActivityProvider) {
  const key = cacheKey(token, userId, provider);
  const cached = activityCache.get(key);
  const now = Date.now();
  if (!force && cached && now - cached.loadedAt < ACTIVITY_CACHE_TTL_MS) return cached.activities;
  if (cached?.promise) return cached.promise;

  const promise = api.getUserActivity(token, userId, provider).then((payload) => {
    const loadedAt = Date.now();
    const activities = payload.activities.map((activity) => ({ ...activity, fetchedAt: activity.fetchedAt ?? loadedAt }));
    activityCache.set(key, { activities, loadedAt });
    return activities;
  }).catch((error) => {
    activityCache.delete(key);
    throw error;
  });
  activityCache.set(key, { activities: cached?.activities ?? [], loadedAt: cached?.loadedAt ?? 0, promise });
  return promise;
}

export function useUserActivities(
  token: string,
  userId: string | null | undefined,
  refreshMs = 30_000,
  provider?: ActivityProvider
) {
  const key = userId ? cacheKey(token, userId, provider) : '';
  const cached = key ? activityCache.get(key) : undefined;
  const [activities, setActivities] = useState<UserActivity[]>(cached?.activities ?? []);
  const [loadedAt, setLoadedAt] = useState(cached?.loadedAt ?? 0);

  useEffect(() => {
    if (!userId) {
      setActivities([]);
      setLoadedAt(0);
      return;
    }

    let alive = true;
    const load = (force = false) => {
      loadActivities(token, userId, force, provider)
        .then((next) => {
          if (!alive) return;
          const entry = activityCache.get(cacheKey(token, userId, provider));
          setActivities(next);
          setLoadedAt(entry?.loadedAt ?? Date.now());
        })
        .catch(() => {
          if (alive) {
            setActivities([]);
            setLoadedAt(0);
          }
        });
    };

    load(false);
    const timer = window.setInterval(() => load(true), refreshMs);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [token, userId, refreshMs, provider]);

  return { activities, loadedAt };
}

export function currentActivityProgressMs(activity: UserActivity, loadedAt: number, now: number) {
  if (activity.provider !== 'spotify') return 0;
  const baseAt = activity.fetchedAt ?? loadedAt;
  const elapsed = Math.max(0, now - baseAt);
  return Math.min(activity.durationMs || activity.progressMs, activity.progressMs + elapsed);
}

export function SpotifyActivityLine({ token, userId, className = '' }: { token: string; userId: string; className?: string }) {
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const [isNearViewport, setIsNearViewport] = useState(false);

  useEffect(() => {
    const target = anchorRef.current?.parentElement;
    if (!target || typeof IntersectionObserver === 'undefined') {
      setIsNearViewport(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => setIsNearViewport(Boolean(entry?.isIntersecting)),
      { rootMargin: '160px 0px' }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  const { activities } = useUserActivities(token, isNearViewport ? userId : null, 30_000, 'spotify');
  const spotify = useMemo(() => activities.find((activity) => activity.provider === 'spotify'), [activities]);
  if (!spotify || spotify.provider !== 'spotify') {
    return <span ref={anchorRef} style={{ display: 'contents' }} aria-hidden="true" />;
  }
  return (
    <>
      <span ref={anchorRef} style={{ display: 'contents' }} aria-hidden="true" />
      <span className={className ? `spotify-activity-line ${className}` : 'spotify-activity-line'}>
      <span className="spotify-activity-note" aria-hidden="true">♪</span>
      <span>{spotify.title}</span>
      </span>
    </>
  );
}
