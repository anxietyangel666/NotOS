import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import type { Server } from 'socket.io';
import { z } from 'zod';
import { config } from '../../config.js';
import {
  deleteUserConnection,
  listUserConnections,
  toPublicConnection,
  updateConnectionMetadata,
  updateConnectionToken,
  upsertUserConnection,
  type ConnectionProvider,
  type UserConnectionRecord
} from '../../db/connections.js';
import { asyncHandler } from '../../http/async-handler.js';
import { HttpError } from '../../http/errors.js';
import { type AuthenticatedRequest, requireAuth } from '../../middleware/require-auth.js';

const SPOTIFY_SCOPES = ['user-read-currently-playing', 'user-read-playback-state'];
const SPOTIFY_STATE_TTL_MS = 10 * 60 * 1000;
const ACTIVITY_CACHE_TTL_MS = 30 * 1000;
const EXTERNAL_API_TIMEOUT_MS = 5 * 1000;
const spotifyStates = new Map<string, { userId: string; expiresAt: number }>();
const activityCache = new Map<string, { activities: unknown[]; expiresAt: number }>();
const activityInflight = new Map<string, Promise<unknown[]>>();

const riotSchema = z.object({
  gameName: z.string().trim().min(2).max(32),
  tagLine: z.string().trim().min(2).max(16),
  region: z.enum(['br1', 'eun1', 'euw1', 'jp1', 'kr', 'la1', 'la2', 'me1', 'na1', 'oc1', 'ru', 'sg2', 'tr1', 'tw2', 'vn2'])
});

const visibilitySchema = z.object({
  showProfile: z.boolean().optional(),
  showActivity: z.boolean().optional()
});

const riotRoutingByRegion: Record<string, string> = {
  br1: 'americas',
  la1: 'americas',
  la2: 'americas',
  na1: 'americas',
  oc1: 'sea',
  sg2: 'sea',
  tw2: 'sea',
  vn2: 'sea',
  eun1: 'europe',
  euw1: 'europe',
  me1: 'europe',
  ru: 'europe',
  tr1: 'europe',
  jp1: 'asia',
  kr: 'asia'
};

type SpotifyTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
};

type SpotifyProfile = {
  id: string;
  display_name?: string;
};

type SpotifyCurrentlyPlaying = {
  is_playing?: boolean;
  item?: {
    name?: string;
    duration_ms?: number;
    album?: { name?: string; images?: Array<{ url: string }> };
    artists?: Array<{ name: string }>;
    external_urls?: { spotify?: string };
  };
  progress_ms?: number;
};

type RiotAccount = {
  puuid: string;
  gameName: string;
  tagLine: string;
};

type RiotCurrentGame = {
  gameMode?: string;
  gameType?: string;
  gameStartTime?: number;
  participants?: Array<{ puuid?: string; championId?: number; teamId?: number }>;
};

function providerConnected(rows: UserConnectionRecord[], provider: ConnectionProvider) {
  const row = rows.find((item) => item.provider === provider);
  return row ? toPublicConnection(row) : { provider, connected: false, displayName: '', metadata: {}, updatedAt: '' };
}

function connectionFlag(connection: UserConnectionRecord, key: 'showProfile' | 'showActivity') {
  const value = connection.metadata?.[key];
  return typeof value === 'boolean' ? value : true;
}

function publicVisibleConnection(connection: UserConnectionRecord) {
  return {
    provider: connection.provider,
    connected: true,
    displayName: connection.display_name,
    metadata: {
      showProfile: connectionFlag(connection, 'showProfile'),
      showActivity: connectionFlag(connection, 'showActivity')
    },
    updatedAt: connection.updated_at.toISOString()
  };
}

function pruneSpotifyStates() {
  const now = Date.now();
  for (const [state, value] of spotifyStates) {
    if (value.expiresAt <= now) spotifyStates.delete(state);
  }
}

function spotifyConfigured() {
  return Boolean(config.spotifyClientId && config.spotifyClientSecret && config.spotifyRedirectUri);
}

function riotConfigured() {
  return Boolean(config.riotApiKey);
}

function activityCacheKey(userId: string, provider?: 'spotify' | 'riot') {
  return `${userId}:${provider ?? 'all'}`;
}

function invalidateActivityCache(userId: string) {
  const prefix = `${userId}:`;
  for (const key of activityCache.keys()) {
    if (key.startsWith(prefix)) activityCache.delete(key);
  }
}

function pruneExpiredActivityCache() {
  const now = Date.now();
  for (const [key, value] of activityCache) {
    if (value.expiresAt <= now) activityCache.delete(key);
  }
}

async function fetchExternalApi(url: string, init: RequestInit = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EXTERNAL_API_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function spotifyRequest<T>(url: string, init: RequestInit) {
  const response = await fetchExternalApi(url, init);
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new HttpError(response.status, data?.error_description ?? data?.error?.message ?? 'Spotify request failed', 'SPOTIFY_REQUEST_FAILED');
  }
  return data as T;
}

async function refreshSpotifyToken(connection: UserConnectionRecord) {
  if (!connection.refresh_token) throw new HttpError(400, 'Spotify is not connected', 'SPOTIFY_NOT_CONNECTED');
  if (connection.access_token && connection.token_expires_at && connection.token_expires_at.getTime() > Date.now() + 60_000) {
    return connection.access_token;
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: connection.refresh_token
  });
  const token = await spotifyRequest<SpotifyTokenResponse>('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.spotifyClientId}:${config.spotifyClientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });
  await updateConnectionToken(connection.user_id, 'spotify', {
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? null,
    tokenExpiresAt: new Date(Date.now() + token.expires_in * 1000)
  });
  return token.access_token;
}

async function fetchSpotifyActivity(connection: UserConnectionRecord) {
  if (!spotifyConfigured()) return null;
  const accessToken = await refreshSpotifyToken(connection);
  const response = await fetchExternalApi('https://api.spotify.com/v1/me/player/currently-playing', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (response.status === 204 || response.status === 202) return null;
  const text = await response.text();
  if (!response.ok) return null;
  const payload = text ? JSON.parse(text) as SpotifyCurrentlyPlaying : null;
  if (!payload?.is_playing || !payload.item?.name) return null;
  return {
    provider: 'spotify' as const,
    type: 'listening' as const,
    title: payload.item.name,
    subtitle: (payload.item.artists ?? []).map((artist) => artist.name).join(', '),
    album: payload.item.album?.name ?? '',
    imageUrl: payload.item.album?.images?.at(-1)?.url ?? payload.item.album?.images?.[0]?.url ?? '',
    url: payload.item.external_urls?.spotify ?? '',
    progressMs: payload.progress_ms ?? 0,
    durationMs: payload.item.duration_ms ?? 0,
    fetchedAt: Date.now()
  };
}

async function riotRequest<T>(url: string) {
  const response = await fetchExternalApi(url, { headers: { 'X-Riot-Token': config.riotApiKey } });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new HttpError(response.status, data?.status?.message ?? 'Riot request failed', 'RIOT_REQUEST_FAILED');
  }
  return data as T;
}

async function fetchRiotActivity(connection: UserConnectionRecord) {
  if (!riotConfigured()) return null;
  const metadata = connection.metadata ?? {};
  const region = typeof metadata.region === 'string' ? metadata.region : '';
  const puuid = typeof metadata.puuid === 'string' ? metadata.puuid : connection.provider_user_id;
  if (!region || !puuid) return null;
  try {
    const game = await riotRequest<RiotCurrentGame>(`https://${region}.api.riotgames.com/lol/spectator/v5/active-games/by-summoner/${encodeURIComponent(puuid)}`);
    return {
      provider: 'riot' as const,
      type: 'playing' as const,
      title: 'League of Legends',
      subtitle: game.gameMode || game.gameType || 'In game',
      riotId: connection.display_name,
      region,
      gameStartTime: game.gameStartTime ?? null,
      fetchedAt: Date.now()
    };
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) return null;
    throw error;
  }
}

export function createConnectionsRouter(io: Server) {
  const router = Router();

  router.get(
    '/',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const rows = await listUserConnections(req.auth.userId);
      res.json({
        spotifyConfigured: spotifyConfigured(),
        riotConfigured: riotConfigured(),
        connections: [
          providerConnected(rows, 'spotify'),
          providerConnected(rows, 'riot')
        ]
      });
    })
  );

  router.get(
    '/spotify/start',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      if (!spotifyConfigured()) throw new HttpError(503, 'Spotify OAuth is not configured', 'SPOTIFY_NOT_CONFIGURED');
      pruneSpotifyStates();
      const state = randomBytes(24).toString('hex');
      spotifyStates.set(state, { userId: req.auth.userId, expiresAt: Date.now() + SPOTIFY_STATE_TTL_MS });
      const params = new URLSearchParams({
        client_id: config.spotifyClientId,
        response_type: 'code',
        redirect_uri: config.spotifyRedirectUri,
        scope: SPOTIFY_SCOPES.join(' '),
        state,
        show_dialog: 'true'
      });
      res.json({ url: `https://accounts.spotify.com/authorize?${params.toString()}` });
    })
  );

  router.get(
    '/spotify/callback',
    asyncHandler(async (req, res) => {
      const query = z.object({
        code: z.string().optional(),
        state: z.string(),
        error: z.string().optional()
      }).parse(req.query);
      const state = spotifyStates.get(query.state);
      spotifyStates.delete(query.state);
      if (!state || state.expiresAt <= Date.now()) throw new HttpError(400, 'Spotify authorization expired', 'SPOTIFY_STATE_EXPIRED');
      if (query.error || !query.code) throw new HttpError(400, 'Spotify authorization was cancelled', 'SPOTIFY_CANCELLED');

      const token = await spotifyRequest<SpotifyTokenResponse>('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${config.spotifyClientId}:${config.spotifyClientSecret}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: query.code,
          redirect_uri: config.spotifyRedirectUri
        })
      });
      const profile = await spotifyRequest<SpotifyProfile>('https://api.spotify.com/v1/me', {
        headers: { Authorization: `Bearer ${token.access_token}` }
      });
      const connection = await upsertUserConnection({
        userId: state.userId,
        provider: 'spotify',
        providerUserId: profile.id,
        displayName: profile.display_name || profile.id,
        accessToken: token.access_token,
        refreshToken: token.refresh_token ?? null,
        tokenExpiresAt: new Date(Date.now() + token.expires_in * 1000),
        metadata: { spotifyId: profile.id, showProfile: true, showActivity: true }
      });
      invalidateActivityCache(state.userId);
      io.to(state.userId).emit('connections:changed', { connection: toPublicConnection(connection) });
      res.type('html').send('<!doctype html><html><body style="font-family:system-ui;margin:32px"><h2>Spotify connected</h2><p>You can close this window.</p><script>window.close()</script></body></html>');
    })
  );

  router.post(
    '/riot',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      if (!riotConfigured()) throw new HttpError(503, 'Riot API is not configured', 'RIOT_NOT_CONFIGURED');
      const input = riotSchema.parse(req.body);
      const routing = riotRoutingByRegion[input.region];
      const account = await riotRequest<RiotAccount>(
        `https://${routing}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(input.gameName)}/${encodeURIComponent(input.tagLine)}`
      );
      const connection = await upsertUserConnection({
        userId: req.auth.userId,
        provider: 'riot',
        providerUserId: account.puuid,
        displayName: `${account.gameName}#${account.tagLine}`,
        metadata: {
          puuid: account.puuid,
          gameName: account.gameName,
          tagLine: account.tagLine,
          region: input.region,
          routing,
          showProfile: true,
          showActivity: true
        }
      });
      invalidateActivityCache(req.auth.userId);
      io.to(req.auth.userId).emit('connections:changed', { connection: toPublicConnection(connection) });
      res.json({ connection: toPublicConnection(connection) });
    })
  );

  router.delete(
    '/:provider',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const provider = z.enum(['spotify', 'riot']).parse(req.params.provider);
      await deleteUserConnection(req.auth.userId, provider);
      invalidateActivityCache(req.auth.userId);
      io.to(req.auth.userId).emit('connections:changed', { provider, connected: false });
      res.json({ success: true });
    })
  );

  router.patch(
    '/:provider/visibility',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const provider = z.enum(['spotify', 'riot']).parse(req.params.provider);
      const input = visibilitySchema.parse(req.body ?? {});
      const current = (await listUserConnections(req.auth.userId)).find((connection) => connection.provider === provider);
      if (!current) throw new HttpError(404, 'Connection not found', 'CONNECTION_NOT_FOUND');
      const metadata = {
        ...(current.metadata ?? {}),
        ...(input.showProfile === undefined ? {} : { showProfile: input.showProfile }),
        ...(input.showActivity === undefined ? {} : { showActivity: input.showActivity })
      };
      const updated = await updateConnectionMetadata(req.auth.userId, provider, metadata);
      invalidateActivityCache(req.auth.userId);
      res.json({ connection: updated ? toPublicConnection(updated) : null });
    })
  );

  router.get(
    '/users/:userId',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const userId = z.string().uuid().parse(req.params.userId);
      const rows = await listUserConnections(userId);
      res.json({
        connections: rows
          .filter((connection) => connectionFlag(connection, 'showProfile'))
          .map(publicVisibleConnection)
      });
    })
  );

  router.get(
    '/users/:userId/activity',
    requireAuth,
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const userId = z.string().uuid().parse(req.params.userId);
      const query = z.object({ provider: z.enum(['spotify', 'riot']).optional() }).parse(req.query);
      pruneExpiredActivityCache();
      const cacheKey = activityCacheKey(userId, query.provider);
      const cached = activityCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        res.json({ activities: cached.activities });
        return;
      }
      const pending = activityInflight.get(cacheKey);
      if (pending) {
        res.json({ activities: await pending });
        return;
      }

      const refresh = (async () => {
        const rows = await listUserConnections(userId);
        const activities = (await Promise.all(rows
          .filter((connection) => !query.provider || connection.provider === query.provider)
          .map(async (connection) => {
            try {
              if (!connectionFlag(connection, 'showActivity')) return null;
              if (connection.provider === 'spotify') return await fetchSpotifyActivity(connection);
              if (connection.provider === 'riot') return await fetchRiotActivity(connection);
              return null;
            } catch {
              return null;
            }
          }))).filter(Boolean);
        activityCache.set(cacheKey, { activities, expiresAt: Date.now() + ACTIVITY_CACHE_TTL_MS });
        return activities;
      })();

      activityInflight.set(cacheKey, refresh);
      try {
        res.json({ activities: await refresh });
      } finally {
        if (activityInflight.get(cacheKey) === refresh) activityInflight.delete(cacheKey);
      }
    })
  );

  return router;
}
