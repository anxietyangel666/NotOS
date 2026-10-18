import type { Server } from 'socket.io';
import { verifyAccessToken } from '../modules/auth/token.js';
import { findUserById } from '../db/users.js';
import { createMessage, toPublicMessage, toPublicMessageEnriched, blockExistsBetween, releaseAwaitingOnlineMessages } from '../db/messenger.js';
import { isGroupMember, listGroupMemberIds } from '../db/groups.js';
import { listVoiceActiveUserIds, registerVoiceHandlers } from './voice-rooms.js';
import { listWatchActiveUserIds, registerWatchHandlers } from './watch-rooms.js';

type PresenceStatus = 'online' | 'idle' | 'dnd' | 'invisible';

const activeUsers = new Map<string, number>();
const presenceStatuses = new Map<string, PresenceStatus>();
const desktopWatchers = new Map<string, Set<string>>();
const desktopScreens = new Map<string, { width: number; height: number }>();
const pinnedPositions = new Map<string, { x: number; y: number; width: number; height: number }>();

// A live snapshot of every user's pinned cards (positions/sizes), keyed by
// ownerId. Stored so a watcher that joins mid-session immediately receives the
// current layout without waiting for the next move event.
type PinnedCardState = { id: string; x: number; y: number; width: number; height: number };
const pinnedCards = new Map<string, PinnedCardState[]>();

type EmojiBurstState = {
  x: number;
  y: number;
  messageId?: string;
  emojiIndex?: number;
  payload:
    | { type: 'image'; src: string; label: string }
    | { type: 'text'; value: string };
};

function sanitizePinnedCards(value: unknown): PinnedCardState[] | null {
  if (!Array.isArray(value)) return null;
  const cards: PinnedCardState[] = [];
  for (const entry of value.slice(0, 50)) {
    if (typeof entry !== 'object' || entry === null) continue;
    const card = entry as Record<string, unknown>;
    if (typeof card.id !== 'string') continue;
    if (typeof card.x !== 'number' || typeof card.y !== 'number') continue;
    if (!Number.isFinite(card.x) || !Number.isFinite(card.y)) continue;
    cards.push({
      id: card.id.slice(0, 120),
      x: card.x,
      y: card.y,
      width: typeof card.width === 'number' && Number.isFinite(card.width) ? card.width : 200,
      height: typeof card.height === 'number' && Number.isFinite(card.height) ? card.height : 160
    });
  }
  return cards;
}

function sanitizeEmojiBurst(value: unknown): EmojiBurstState | null {
  if (typeof value !== 'object' || value === null) return null;
  const item = value as Record<string, unknown>;
  if (typeof item.x !== 'number' || typeof item.y !== 'number') return null;
  if (!Number.isFinite(item.x) || !Number.isFinite(item.y)) return null;
  if (item.x < -2000 || item.x > 12000 || item.y < -2000 || item.y > 12000) return null;

  const rawPayload = item.payload;
  if (typeof rawPayload !== 'object' || rawPayload === null) return null;
  const payload = rawPayload as Record<string, unknown>;

  if (payload.type === 'image') {
    if (typeof payload.src !== 'string' || typeof payload.label !== 'string') return null;
    if (payload.src.length < 1 || payload.src.length > 8192 || payload.label.length > 120) return null;
    if (!/^https?:\/\//i.test(payload.src) && !payload.src.startsWith('data:image/')) return null;
    const burst: EmojiBurstState = {
      x: Math.round(item.x),
      y: Math.round(item.y),
      payload: {
        type: 'image',
        src: payload.src,
        label: payload.label
      }
    };
    if (typeof item.messageId === 'string' && item.messageId.length <= 80) burst.messageId = item.messageId;
    if (typeof item.emojiIndex === 'number' && Number.isInteger(item.emojiIndex) && item.emojiIndex >= 0 && item.emojiIndex <= 200) burst.emojiIndex = item.emojiIndex;
    return burst;
  }

  if (payload.type === 'text') {
    if (typeof payload.value !== 'string') return null;
    const value = payload.value.slice(0, 24);
    if (!value.trim()) return null;
    const burst: EmojiBurstState = {
      x: Math.round(item.x),
      y: Math.round(item.y),
      payload: { type: 'text', value }
    };
    if (typeof item.messageId === 'string' && item.messageId.length <= 80) burst.messageId = item.messageId;
    if (typeof item.emojiIndex === 'number' && Number.isInteger(item.emojiIndex) && item.emojiIndex >= 0 && item.emojiIndex <= 200) burst.emojiIndex = item.emojiIndex;
    return burst;
  }

  return null;
}

type CallState = {
  id: string;
  caller: string;
  callee: string;
  status: 'ringing' | 'active';
  startedAt: number | null;
  createdAt: number;
  timeout: NodeJS.Timeout | null;
};

// Active 1:1 calls keyed by callId. A user can only be in one call at a time.
const calls = new Map<string, CallState>();
const userCall = new Map<string, string>();

const RING_TIMEOUT_MS = 45_000;

function clearCall(callId: string) {
  const call = calls.get(callId);
  if (!call) return;
  if (call.timeout) clearTimeout(call.timeout);
  calls.delete(callId);
  if (userCall.get(call.caller) === callId) userCall.delete(call.caller);
  if (userCall.get(call.callee) === callId) userCall.delete(call.callee);
}

function callDurationSeconds(call: CallState) {
  if (!call.startedAt) return 0;
  return Math.max(0, Math.round((Date.now() - call.startedAt) / 1000));
}

function isVisibleOnline(userId: string) {
  return (activeUsers.get(userId) ?? 0) > 0 && presenceStatuses.get(userId) !== 'invisible';
}

function visibleOnlineUserIds() {
  return Array.from(activeUsers.keys()).filter(isVisibleOnline);
}

// What visible users are currently doing (in a voice channel / watch room),
// shown as a small badge on their avatar. Voice wins when both apply.
function presenceActivitiesPayload() {
  const activities: Record<string, 'voice' | 'watch'> = {};
  for (const id of listWatchActiveUserIds()) activities[id] = 'watch';
  for (const id of listVoiceActiveUserIds()) activities[id] = 'voice';
  return activities;
}

function presenceSnapshotPayload() {
  const onlineUserIds = visibleOnlineUserIds();
  const statuses = Object.fromEntries(
    onlineUserIds.map((userId) => [userId, presenceStatuses.get(userId) ?? 'online'])
  );
  return { onlineUserIds, statuses, activities: presenceActivitiesPayload() };
}

function setUserOnline(io: Server, userId: string) {
  const count = activeUsers.get(userId) ?? 0;
  activeUsers.set(userId, count + 1);
  if (count === 0 && isVisibleOnline(userId)) io.emit('presence:changed', { userId, online: true, status: presenceStatuses.get(userId) ?? 'online' });
}

function setUserOffline(io: Server, userId: string) {
  const count = activeUsers.get(userId) ?? 0;
  const wasVisible = isVisibleOnline(userId);
  if (count <= 1) {
    activeUsers.delete(userId);
    presenceStatuses.delete(userId);
    if (wasVisible) io.emit('presence:changed', { userId, online: false });
    return;
  }

  activeUsers.set(userId, count - 1);
}

function isPresenceStatus(value: unknown): value is PresenceStatus {
  return value === 'online' || value === 'idle' || value === 'dnd' || value === 'invisible';
}

function setPresenceStatus(io: Server, userId: string, status: PresenceStatus) {
  const wasVisible = isVisibleOnline(userId);
  presenceStatuses.set(userId, status);
  const nowVisible = isVisibleOnline(userId);
  io.emit('presence:changed', { userId, online: nowVisible, status: nowVisible ? status : undefined });
}

function emitWatcherCount(io: Server, ownerId: string) {
  const count = desktopWatchers.get(ownerId)?.size ?? 0;
  io.to(ownerId).emit('desktop:watchers', { ownerId, count });
}

function removeWatcher(io: Server, ownerId: string, socketId: string, userId: string) {
  const set = desktopWatchers.get(ownerId);
  if (!set) return;
  set.delete(socketId);
  if (set.size === 0) desktopWatchers.delete(ownerId);
  emitWatcherCount(io, ownerId);
  io.to(`desktop:${ownerId}`).emit('desktop:cursorLeave', { ownerId, userId });
}

export function setupRealtime(io: Server) {
  // Broadcast activity changes (voice/watch membership) on a short poll — the
  // room modules keep their state private, so diffing here is the simplest
  // way to stay decoupled from their join/leave paths.
  let lastActivitiesJson = '';
  const activityTimer = setInterval(() => {
    const activities = presenceActivitiesPayload();
    const json = JSON.stringify(activities);
    if (json === lastActivitiesJson) return;
    lastActivitiesJson = json;
    io.emit('presence:activities', { activities });
  }, 5000);
  activityTimer.unref();

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;

    if (typeof token !== 'string') {
      next(new Error('UNAUTHORIZED'));
      return;
    }

    const payload = verifyAccessToken(token);
    if (!payload) {
      next(new Error('UNAUTHORIZED'));
      return;
    }

    socket.data.userId = payload.userId;
    next();
  });

  io.on('connection', (socket) => {
    const userId = socket.data.userId as string;
    const watching = new Set<string>();
    let nickname = '';
    const initialPresenceStatus = socket.handshake.auth?.presenceStatus;
    if (isPresenceStatus(initialPresenceStatus)) presenceStatuses.set(userId, initialPresenceStatus);
    void findUserById(userId).then((record) => {
      if (record) nickname = record.nickname;
    });

    setUserOnline(io, userId);

    // Deliver anything the peers queued with "send when they are online".
    void releaseAwaitingOnlineMessages(userId)
      .then(async (records) => {
        for (const record of records) {
          const message = await toPublicMessageEnriched(record);
          io.to(record.recipient_id).emit('messenger:message', { message });
          io.to(record.sender_id).emit('messenger:message', { message });
          io.to(record.sender_id).emit('messenger:scheduledSent', { message });
        }
      })
      .catch(() => undefined);

    socket.join(userId);
    socket.join(`desktop:${userId}`);
    socket.emit('system:ready', { serverTime: new Date().toISOString() });
    socket.emit('presence:activities', { activities: presenceActivitiesPayload() });

    // Multi-party group voice channels (WebRTC mesh + ephemeral chat).
    registerVoiceHandlers(io, socket, userId);

    // Watch Together — synchronized media rooms with public lobby + chat.
    registerWatchHandlers(io, socket, userId);

    socket.on('messenger:typing', (payload: { recipientId?: unknown; typing?: unknown }) => {
      if (typeof payload.recipientId !== 'string' || typeof payload.typing !== 'boolean') return;
      io.to(payload.recipientId).emit('messenger:typing', { userId, typing: payload.typing });
    });

    socket.on('presence:setStatus', (payload: { status?: unknown }) => {
      if (!isPresenceStatus(payload.status)) return;
      setPresenceStatus(io, userId, payload.status);
    });

    socket.on('presence:getSnapshot', () => {
      socket.emit('presence:snapshot', presenceSnapshotPayload());
    });

    socket.on('emoji:burst', (payload: unknown) => {
      const burst = sanitizeEmojiBurst(payload);
      if (!burst) return;
      socket.broadcast.emit('emoji:burst', burst);
    });

    socket.on('group:typing', async (payload: { groupId?: unknown; channelId?: unknown; typing?: unknown }) => {
      if (typeof payload.groupId !== 'string' || typeof payload.typing !== 'boolean') return;
      const groupId = payload.groupId;
      const channelId = typeof payload.channelId === 'string' ? payload.channelId : null;
      try {
        if (!(await isGroupMember(groupId, userId))) return;
        const memberIds = await listGroupMemberIds(groupId);
        for (const id of memberIds) {
          if (id !== userId) io.to(id).emit('group:typing', { groupId, channelId, userId, typing: payload.typing });
        }
      } catch {
        // Typing indicators are ephemeral; ignore DB/socket fan-out failures.
      }
    });

    socket.on('desktop:watch', (payload: { ownerId?: unknown }) => {
      if (typeof payload?.ownerId !== 'string' || payload.ownerId === userId) return;
      const ownerId = payload.ownerId;
      void socket.join(`desktop:${ownerId}`);
      watching.add(ownerId);
      let set = desktopWatchers.get(ownerId);
      if (!set) {
        set = new Set();
        desktopWatchers.set(ownerId, set);
      }
      set.add(socket.id);
      emitWatcherCount(io, ownerId);
      const pos = pinnedPositions.get(ownerId);
      if (pos) socket.emit('desktop:pinnedImageMoved', { ownerId, ...pos });
      const cards = pinnedCards.get(ownerId);
      if (cards) socket.emit('desktop:pinnedCards', { ownerId, cards });
      const screen = desktopScreens.get(ownerId);
      if (screen) socket.emit('desktop:screen', { ownerId, ...screen });
    });

    socket.on('desktop:unwatch', (payload: { ownerId?: unknown }) => {
      if (typeof payload?.ownerId !== 'string') return;
      const ownerId = payload.ownerId;
      void socket.leave(`desktop:${ownerId}`);
      watching.delete(ownerId);
      removeWatcher(io, ownerId, socket.id, userId);
    });

    socket.on('desktop:cursor', (payload: { ownerId?: unknown; x?: unknown; y?: unknown }) => {
      if (typeof payload?.ownerId !== 'string' || typeof payload.x !== 'number' || typeof payload.y !== 'number') return;
      if (!Number.isFinite(payload.x) || !Number.isFinite(payload.y)) return;
      const ownerId = payload.ownerId;
      if (ownerId !== userId && !watching.has(ownerId)) return;
      socket.to(`desktop:${ownerId}`).emit('desktop:cursor', { ownerId, userId, nickname, x: payload.x, y: payload.y });
    });

    socket.on('desktop:pinnedImageMove', (payload: { x?: unknown; y?: unknown; width?: unknown; height?: unknown }) => {
      if (typeof payload?.x !== 'number' || typeof payload?.y !== 'number') return;
      if (!Number.isFinite(payload.x) || !Number.isFinite(payload.y)) return;
      const pos = {
        x: payload.x,
        y: payload.y,
        width: typeof payload.width === 'number' && Number.isFinite(payload.width) ? payload.width : 200,
        height: typeof payload.height === 'number' && Number.isFinite(payload.height) ? payload.height : 160
      };
      pinnedPositions.set(userId, pos);
      socket.to(`desktop:${userId}`).emit('desktop:pinnedImageMoved', { ownerId: userId, ...pos });
    });

    // Live broadcast of the full set of pinned cards (add/move/resize/remove).
    socket.on('desktop:pinnedCards', (payload: { cards?: unknown }) => {
      const cards = sanitizePinnedCards(payload?.cards);
      if (!cards) return;
      pinnedCards.set(userId, cards);
      socket.to(`desktop:${userId}`).emit('desktop:pinnedCards', { ownerId: userId, cards });
    });

    socket.on('desktop:screen', (payload: { width?: unknown; height?: unknown }) => {
      if (typeof payload?.width !== 'number' || typeof payload?.height !== 'number') return;
      if (!Number.isFinite(payload.width) || payload.width <= 0 || !Number.isFinite(payload.height) || payload.height <= 0) return;
      const screen = { width: Math.round(payload.width), height: Math.round(payload.height) };
      desktopScreens.set(userId, screen);
      socket.to(`desktop:${userId}`).emit('desktop:screen', { ownerId: userId, ...screen });
    });

    // --- Voice/screen call signaling (1:1, WebRTC) ---

    function endCall(callId: string, reason: 'hangup' | 'declined' | 'missed' | 'cancelled' | 'disconnect', byUserId: string) {
      const call = calls.get(callId);
      if (!call) return;
      const duration = callDurationSeconds(call);
      const wasConnected = call.status === 'active';
      const targets = [call.caller, call.callee];
      clearCall(callId);
      for (const target of targets) {
        io.to(target).emit('call:ended', { callId, reason, by: byUserId, duration, connected: wasConnected, caller: call.caller, callee: call.callee });
      }

      // Persist a call log entry in the DM history (sender is always the caller)
      // so it survives reloads. Clients render the marker in their own language.
      const kind = wasConnected ? 'ended' : reason === 'missed' ? 'missed' : reason === 'declined' ? 'declined' : 'cancelled';
      void createMessage(call.caller, call.callee, `[call:${kind}:${duration}]`)
        .then((record) => {
          const message = toPublicMessage(record);
          io.to(call.caller).emit('messenger:message', { message });
          io.to(call.callee).emit('messenger:message', { message });
        })
        .catch(() => undefined);
    }

    socket.on('call:invite', async (payload: { calleeId?: unknown }) => {
      if (typeof payload?.calleeId !== 'string' || payload.calleeId === userId) return;
      const calleeId = payload.calleeId;
      // Reject if either side is already busy.
      if (userCall.has(userId) || userCall.has(calleeId)) {
        socket.emit('call:busy', { calleeId });
        return;
      }
      // A block in either direction forbids calling.
      if (await blockExistsBetween(userId, calleeId)) {
        socket.emit('call:unavailable', { calleeId });
        return;
      }
      const online = isVisibleOnline(calleeId);
      if (!online) {
        socket.emit('call:unavailable', { calleeId });
        return;
      }
      const callId = `call_${userId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const call: CallState = {
        id: callId,
        caller: userId,
        callee: calleeId,
        status: 'ringing',
        startedAt: null,
        createdAt: Date.now(),
        timeout: null
      };
      call.timeout = setTimeout(() => endCall(callId, 'missed', userId), RING_TIMEOUT_MS);
      calls.set(callId, call);
      userCall.set(userId, callId);
      userCall.set(calleeId, callId);
      io.to(calleeId).emit('call:incoming', { callId, callerId: userId, callerNickname: nickname });
      socket.emit('call:ringing', { callId, calleeId });
    });

    socket.on('call:accept', (payload: { callId?: unknown }) => {
      if (typeof payload?.callId !== 'string') return;
      const call = calls.get(payload.callId);
      if (!call || call.callee !== userId || call.status !== 'ringing') return;
      if (call.timeout) { clearTimeout(call.timeout); call.timeout = null; }
      call.status = 'active';
      call.startedAt = Date.now();
      // Broadcast to ALL sockets of both users (the callee's desktop window also
      // shows an incoming-call toast that must be dismissed on accept).
      io.to(call.caller).emit('call:accepted', { callId: call.id, byId: userId });
      io.to(call.callee).emit('call:accepted', { callId: call.id, byId: userId });
    });

    socket.on('call:decline', (payload: { callId?: unknown }) => {
      if (typeof payload?.callId !== 'string') return;
      const call = calls.get(payload.callId);
      if (!call || (call.callee !== userId && call.caller !== userId)) return;
      const reason = call.caller === userId ? 'cancelled' : 'declined';
      endCall(call.id, reason, userId);
    });

    socket.on('call:hangup', (payload: { callId?: unknown }) => {
      if (typeof payload?.callId !== 'string') return;
      const call = calls.get(payload.callId);
      if (!call || (call.callee !== userId && call.caller !== userId)) return;
      endCall(call.id, 'hangup', userId);
    });

    // Relay WebRTC signaling messages to the other peer.
    function peerOf(callId: string): string | null {
      const call = calls.get(callId);
      if (!call) return null;
      if (call.caller === userId) return call.callee;
      if (call.callee === userId) return call.caller;
      return null;
    }

    socket.on('call:signal', (payload: { callId?: unknown; data?: unknown }) => {
      if (typeof payload?.callId !== 'string' || typeof payload.data !== 'object' || payload.data === null) return;
      const peer = peerOf(payload.callId);
      if (!peer) return;
      io.to(peer).emit('call:signal', { callId: payload.callId, from: userId, data: payload.data });
    });

    // Notify peer about media state changes (mute, deafen, screen share, camera, talking).
    socket.on('call:state', (payload: { callId?: unknown; muted?: unknown; deafened?: unknown; screen?: unknown; camera?: unknown; talking?: unknown; cameraStreamId?: unknown; screenStreamId?: unknown }) => {
      if (typeof payload?.callId !== 'string') return;
      const peer = peerOf(payload.callId);
      if (!peer) return;
      io.to(peer).emit('call:state', {
        callId: payload.callId,
        from: userId,
        muted: typeof payload.muted === 'boolean' ? payload.muted : undefined,
        deafened: typeof payload.deafened === 'boolean' ? payload.deafened : undefined,
        screen: typeof payload.screen === 'boolean' ? payload.screen : undefined,
        camera: typeof payload.camera === 'boolean' ? payload.camera : undefined,
        talking: typeof payload.talking === 'boolean' ? payload.talking : undefined,
        cameraStreamId: typeof payload.cameraStreamId === 'string' ? payload.cameraStreamId : undefined,
        screenStreamId: typeof payload.screenStreamId === 'string' ? payload.screenStreamId : undefined
      });
    });

    socket.on('disconnect', () => {
      setUserOffline(io, userId);
      const activeCallId = userCall.get(userId);
      if (activeCallId && (activeUsers.get(userId) ?? 0) === 0) {
        endCall(activeCallId, 'disconnect', userId);
      }
      for (const ownerId of watching) {
        removeWatcher(io, ownerId, socket.id, userId);
      }
      io.to(`desktop:${userId}`).emit('desktop:cursorLeave', { ownerId: userId, userId });
    });
  });
}
