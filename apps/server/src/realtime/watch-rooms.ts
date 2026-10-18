import type { Server, Socket } from 'socket.io';
import { randomUUID, createHash, randomBytes } from 'node:crypto';
import { findUserById, toPublicUser, type PublicUser } from '../db/users.js';

/**
 * Watch Together — synchronized media rooms ("WatchTogether"-style).
 *
 * Users create or join rooms to watch the same media (YouTube/films/etc.)
 * together. One member is the host whose player state (source, playing/paused,
 * playback position) is the source of truth and is broadcast to every other
 * member so everyone stays in sync. Each room has an ephemeral chat (with the
 * same emoji/GIF support as the rest of the app) rendered on the right.
 *
 * Rooms can be public (listed in the public lobby, like a server browser) or
 * private (password protected and/or only reachable via an invite code/link).
 *
 * State is fully in-memory and ephemeral: a room is destroyed once the last
 * member leaves. This mirrors the design of `voice-rooms.ts`.
 */

type WatchMember = {
  userId: string;
  user: PublicUser;
  sockets: Set<string>;
  joinedAt: number;
  // The member's last reported playback position (seconds) and whether their
  // player is currently playing. Used to render the per-member sync panel so
  // everyone can see who is in sync with the host and resync on demand.
  position: number;
  playing: boolean;
  // Server timestamp (ms) of the last position report; lets clients extrapolate
  // a member's live position the same way they do for the host.
  reportedAt: number;
};

type WatchSource = {
  // 'youtube' | 'url' (direct video file) | 'embed' (generic iframe).
  kind: 'youtube' | 'url' | 'embed';
  // The canonical id/url used by the client player.
  value: string;
  // Human-readable title shown above the player.
  title: string;
  addedBy: string;
};

type PlayerState = {
  source: WatchSource | null;
  playing: boolean;
  // Playback position (seconds) at the moment `updatedAt` was captured.
  position: number;
  // Server timestamp (ms) of the last player update; used so a late joiner can
  // extrapolate the live position (position + elapsed) while playing.
  updatedAt: number;
};

type WatchChatMessage = {
  id: string;
  roomId: string;
  senderId: string;
  senderNickname: string;
  senderAvatar: string;
  senderNameStyle?: unknown;
  body: string;
  // Optional GIF attachment (Tenor url), mirroring the messenger composer.
  gifUrl?: string;
  createdAt: string;
};

export type WatchQueueItem = {
  id: string;
  source: WatchSource;
  addedByUserId: string;
  addedByNickname: string;
  addedByNameStyle?: unknown;
  thumbnailUrl?: string;
  createdAt: number;
};

type WatchRoom = {
  id: string;
  name: string;
  // Bcrypt-free lightweight hash; rooms are ephemeral so a salted sha256 is
  // sufficient to avoid storing plaintext passwords in memory.
  passwordHash: string | null;
  isPublic: boolean;
  inviteCode: string;
  hostId: string;
  // Who is allowed to drive playback (play/pause/seek/change source):
  // 'host' = only the host; 'everyone' = any member in the room.
  controlMode: 'host' | 'everyone';
  createdAt: number;
  members: Map<string, WatchMember>;
  player: PlayerState;
  queue: WatchQueueItem[];
  chat: WatchChatMessage[];
};

const MAX_CHAT_HISTORY = 200;
const MAX_ROOM_NAME = 60;
const PASSWORD_SALT = randomBytes(16).toString('hex');

// roomId -> room
const rooms = new Map<string, WatchRoom>();
// inviteCode -> roomId (fast invite lookup)
const inviteIndex = new Map<string, string>();
// socketId -> roomId (so a disconnect cleans up the right room)
const socketRoom = new Map<string, string>();

// Whether a given user may drive playback in a room (play/pause/seek/source).
function canControl(room: WatchRoom, userId: string): boolean {
  if (!room.members.has(userId)) return false;
  return room.controlMode === 'everyone' || room.hostId === userId;
}

function hashPassword(password: string): string {
  return createHash('sha256').update(`${PASSWORD_SALT}:${password}`).digest('hex');
}

function makeInviteCode(): string {
  // 10 url-safe chars, unique across active rooms.
  let code = '';
  do {
    code = randomBytes(8).toString('base64url').slice(0, 10);
  } while (inviteIndex.has(code));
  return code;
}

function sanitizeSource(value: unknown): WatchSource | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  const kind = raw.kind;
  if (kind !== 'youtube' && kind !== 'url' && kind !== 'embed') return null;
  if (typeof raw.value !== 'string' || !raw.value.trim()) return null;
  const cleanValue = raw.value.trim().slice(0, 2000);
  // Only allow http(s) for url/embed kinds; youtube carries a video id.
  if ((kind === 'url' || kind === 'embed') && !/^https?:\/\//i.test(cleanValue)) return null;
  return {
    kind,
    value: cleanValue,
    title: typeof raw.title === 'string' ? raw.title.trim().slice(0, 200) : '',
    addedBy: ''
  };
}

function publicMembers(room: WatchRoom) {
  return [...room.members.values()].map((m) => ({
    userId: m.userId,
    user: m.user,
    joinedAt: m.joinedAt,
    isHost: m.userId === room.hostId,
    position: m.position,
    playing: m.playing,
    reportedAt: m.reportedAt
  }));
}

// The shape sent to clients for the public lobby / server-browser list.
function publicRoomSummary(room: WatchRoom) {
  return {
    id: room.id,
    name: room.name,
    isPublic: room.isPublic,
    locked: room.passwordHash !== null,
    memberCount: room.members.size,
    hostId: room.hostId,
    nowPlaying: room.player.source?.title || (room.player.source ? room.player.source.value : ''),
    createdAt: room.createdAt
  };
}

// The full room snapshot sent to a member on join.
function roomSnapshot(room: WatchRoom) {
  return {
    id: room.id,
    name: room.name,
    isPublic: room.isPublic,
    locked: room.passwordHash !== null,
    inviteCode: room.inviteCode,
    hostId: room.hostId,
    controlMode: room.controlMode,
    members: publicMembers(room),
    player: room.player,
    queue: room.queue,
    chat: room.chat
  };
}

function broadcastMembers(io: Server, room: WatchRoom) {
  io.to(`watch:${room.id}`).emit('watch:members', {
    roomId: room.id,
    hostId: room.hostId,
    controlMode: room.controlMode,
    members: publicMembers(room)
  });
}

// Broadcast the live public lobby to anyone currently browsing it.
function broadcastLobby(io: Server) {
  const list = [...rooms.values()].filter((r) => r.isPublic).map(publicRoomSummary);
  io.to('watch:lobby').emit('watch:lobby', { rooms: list });
}

// All users currently inside any Watch Together room (for presence activity
// badges).
export function listWatchActiveUserIds(): string[] {
  const ids = new Set<string>();
  for (const room of rooms.values()) {
    for (const member of room.members.values()) ids.add(member.userId);
  }
  return [...ids];
}

export function registerWatchHandlers(io: Server, socket: Socket, userId: string) {
  function leaveRoom(roomId: string) {
    const room = rooms.get(roomId);
    if (!room) return;
    const member = room.members.get(userId);
    if (!member) return;

    member.sockets.delete(socket.id);
    socketRoom.delete(socket.id);
    void socket.leave(`watch:${roomId}`);

    // Only fully gone once all of the user's sockets left the room.
    if (member.sockets.size > 0) return;

    room.members.delete(userId);
    io.to(`watch:${roomId}`).emit('watch:memberLeft', { roomId, userId });

    if (room.members.size === 0) {
      rooms.delete(roomId);
      inviteIndex.delete(room.inviteCode);
      broadcastLobby(io);
      return;
    }

    // Reassign host if the host left, picking the earliest joiner.
    if (room.hostId === userId) {
      const next = [...room.members.values()].sort((a, b) => a.joinedAt - b.joinedAt)[0];
      if (next) {
        room.hostId = next.userId;
        // The new host's player becomes authoritative; ask it to publish state.
        io.to(next.userId).emit('watch:hostPromoted', { roomId });
      }
    }

    broadcastMembers(io, room);
    broadcastLobby(io);
  }

  async function joinRoomInternal(room: WatchRoom) {
    const record = await findUserById(userId);
    if (!record) return;
    const user = toPublicUser(record);

    const previousRoomId = socketRoom.get(socket.id);
    if (previousRoomId && previousRoomId !== room.id) {
      leaveRoom(previousRoomId);
    }

    socketRoom.set(socket.id, room.id);
    void socket.join(`watch:${room.id}`);

    let member = room.members.get(userId);
    if (!member) {
      const now = Date.now();
      member = { userId, user, sockets: new Set(), joinedAt: now, position: room.player.position, playing: room.player.playing, reportedAt: now };
      room.members.set(userId, member);
      socket.to(`watch:${room.id}`).emit('watch:memberJoined', { roomId: room.id, member: { userId, user, joinedAt: member.joinedAt, isHost: room.hostId === userId, position: member.position, playing: member.playing, reportedAt: member.reportedAt } });
    }
    member.sockets.add(socket.id);
    member.user = user;

    // Refresh the live position so the joiner starts in sync.
    if (room.player.playing) {
      const elapsed = (Date.now() - room.player.updatedAt) / 1000;
      room.player.position = Math.max(0, room.player.position + elapsed);
      room.player.updatedAt = Date.now();
    }

    socket.emit('watch:joined', { room: roomSnapshot(room) });
    broadcastMembers(io, room);
    broadcastLobby(io);
  }

  // --- Public lobby (server browser) ---

  socket.on('watch:lobbyWatch', () => {
    void socket.join('watch:lobby');
    const list = [...rooms.values()].filter((r) => r.isPublic).map(publicRoomSummary);
    socket.emit('watch:lobby', { rooms: list });
  });

  socket.on('watch:lobbyUnwatch', () => {
    void socket.leave('watch:lobby');
  });

  // --- Room lifecycle ---

  socket.on('watch:create', async (payload: { name?: unknown; isPublic?: unknown; password?: unknown; source?: unknown }) => {
    const name = typeof payload?.name === 'string' && payload.name.trim()
      ? payload.name.trim().slice(0, MAX_ROOM_NAME)
      : 'Watch room';
    const isPublic = payload?.isPublic !== false;
    const password = typeof payload?.password === 'string' && payload.password.trim()
      ? payload.password.trim().slice(0, 128)
      : null;
    const source = sanitizeSource(payload?.source);
    if (source) source.addedBy = userId;

    const roomId = randomUUID();
    const inviteCode = makeInviteCode();
    const room: WatchRoom = {
      id: roomId,
      name,
      passwordHash: password ? hashPassword(password) : null,
      isPublic,
      inviteCode,
      hostId: userId,
      controlMode: 'host',
      createdAt: Date.now(),
      members: new Map(),
      player: { source, playing: false, position: 0, updatedAt: Date.now() },
      queue: [],
      chat: []
    };
    rooms.set(roomId, room);
    inviteIndex.set(inviteCode, roomId);

    await joinRoomInternal(room);
  });

  socket.on('watch:join', async (payload: { roomId?: unknown; inviteCode?: unknown; password?: unknown }) => {
    let room: WatchRoom | undefined;
    if (typeof payload?.roomId === 'string') room = rooms.get(payload.roomId);
    else if (typeof payload?.inviteCode === 'string') {
      const id = inviteIndex.get(payload.inviteCode);
      room = id ? rooms.get(id) : undefined;
    }
    if (!room) {
      socket.emit('watch:error', { code: 'ROOM_NOT_FOUND' });
      return;
    }
    const alreadyIn = room.members.has(userId);
    if (!alreadyIn && room.passwordHash) {
      const provided = typeof payload?.password === 'string' ? payload.password : '';
      if (hashPassword(provided) !== room.passwordHash) {
        socket.emit('watch:error', { code: 'BAD_PASSWORD', roomId: room.id });
        return;
      }
    }
    await joinRoomInternal(room);
  });

  socket.on('watch:leave', (payload: { roomId?: unknown }) => {
    if (typeof payload?.roomId !== 'string') return;
    leaveRoom(payload.roomId);
  });

  // --- Room settings & host transfer (host only) ---

  socket.on('watch:settings', (payload: { roomId?: unknown; controlMode?: unknown }) => {
    if (typeof payload?.roomId !== 'string') return;
    const room = rooms.get(payload.roomId);
    if (!room || room.hostId !== userId) return; // only the host edits settings
    if (payload.controlMode === 'host' || payload.controlMode === 'everyone') {
      room.controlMode = payload.controlMode;
    }
    broadcastMembers(io, room);
  });

  socket.on('watch:transferHost', (payload: { roomId?: unknown; userId?: unknown }) => {
    if (typeof payload?.roomId !== 'string' || typeof payload?.userId !== 'string') return;
    const room = rooms.get(payload.roomId);
    if (!room || room.hostId !== userId) return; // only the host hands off
    const target = room.members.get(payload.userId);
    if (!target || target.userId === room.hostId) return;
    room.hostId = target.userId;
    // The new host's player becomes authoritative; ask it to publish state.
    io.to(target.userId).emit('watch:hostPromoted', { roomId: room.id });
    broadcastMembers(io, room);
    broadcastLobby(io);
  });

  // --- Player synchronization (host authoritative) ---

  socket.on('watch:setSource', (payload: { roomId?: unknown; source?: unknown }) => {
    if (typeof payload?.roomId !== 'string') return;
    const room = rooms.get(payload.roomId);
    if (!room || !room.members.has(userId)) return;
    if (!canControl(room, userId)) return; // host (or anyone, per controlMode)
    const source = sanitizeSource(payload.source);
    if (!source) return;
    source.addedBy = userId;
    room.player = { source, playing: true, position: 0, updatedAt: Date.now() };
    io.to(`watch:${room.id}`).emit('watch:player', { roomId: room.id, player: room.player });
    broadcastLobby(io);
  });

  socket.on('watch:addToQueue', (payload: { roomId?: unknown; source?: unknown }) => {
    if (typeof payload?.roomId !== 'string') return;
    const room = rooms.get(payload.roomId);
    if (!room || !room.members.has(userId)) return;
    const source = sanitizeSource(payload.source);
    if (!source) return;
    const member = room.members.get(userId);
    const addedByNickname = member?.user.nickname ?? 'Гость';
    source.addedBy = addedByNickname;
    let thumbnailUrl: string | undefined;
    if (source.kind === 'youtube') {
      thumbnailUrl = `https://img.youtube.com/vi/${source.value}/mqdefault.jpg`;
    }
    const item: WatchQueueItem = {
      id: randomUUID(),
      source,
      addedByUserId: userId,
      addedByNickname,
      addedByNameStyle: member?.user.nameStyle ?? null,
      thumbnailUrl,
      createdAt: Date.now()
    };
    room.queue.push(item);
    io.to(`watch:${room.id}`).emit('watch:queue', { roomId: room.id, queue: room.queue });
  });

  socket.on('watch:removeFromQueue', (payload: { roomId?: unknown; itemId?: unknown }) => {
    if (typeof payload?.roomId !== 'string' || typeof payload?.itemId !== 'string') return;
    const room = rooms.get(payload.roomId);
    if (!room || !room.members.has(userId)) return;
    const item = room.queue.find((i) => i.id === payload.itemId);
    if (!item) return;
    if (!canControl(room, userId) && item.addedByUserId !== userId) return;
    room.queue = room.queue.filter((i) => i.id !== payload.itemId);
    io.to(`watch:${room.id}`).emit('watch:queue', { roomId: room.id, queue: room.queue });
  });

  socket.on('watch:playQueueItem', (payload: { roomId?: unknown; itemId?: unknown }) => {
    if (typeof payload?.roomId !== 'string' || typeof payload?.itemId !== 'string') return;
    const room = rooms.get(payload.roomId);
    if (!room || !room.members.has(userId)) return;
    if (!canControl(room, userId)) return;
    const idx = room.queue.findIndex((i) => i.id === payload.itemId);
    if (idx === -1) return;
    const [item] = room.queue.splice(idx, 1);
    room.player = { source: item.source, playing: true, position: 0, updatedAt: Date.now() };
    io.to(`watch:${room.id}`).emit('watch:player', { roomId: room.id, player: room.player });
    io.to(`watch:${room.id}`).emit('watch:queue', { roomId: room.id, queue: room.queue });
    broadcastLobby(io);
  });

  socket.on('watch:playNextInQueue', (payload: { roomId?: unknown }) => {
    if (typeof payload?.roomId !== 'string') return;
    const room = rooms.get(payload.roomId);
    if (!room || !room.members.has(userId)) return;
    if (!canControl(room, userId) || room.queue.length === 0) return;
    const item = room.queue.shift()!;
    room.player = { source: item.source, playing: true, position: 0, updatedAt: Date.now() };
    io.to(`watch:${room.id}`).emit('watch:player', { roomId: room.id, player: room.player });
    io.to(`watch:${room.id}`).emit('watch:queue', { roomId: room.id, queue: room.queue });
    broadcastLobby(io);
  });

  socket.on('watch:clearQueue', (payload: { roomId?: unknown }) => {
    if (typeof payload?.roomId !== 'string') return;
    const room = rooms.get(payload.roomId);
    if (!room || !room.members.has(userId)) return;
    if (!canControl(room, userId)) return;
    room.queue = [];
    io.to(`watch:${room.id}`).emit('watch:queue', { roomId: room.id, queue: room.queue });
  });

  socket.on('watch:control', (payload: { roomId?: unknown; playing?: unknown; position?: unknown }) => {
    if (typeof payload?.roomId !== 'string') return;
    const room = rooms.get(payload.roomId);
    if (!room || !room.members.has(userId)) return;
    if (!canControl(room, userId)) return; // host (or anyone, per controlMode)
    if (typeof payload.playing === 'boolean') room.player.playing = payload.playing;
    if (typeof payload.position === 'number' && Number.isFinite(payload.position) && payload.position >= 0) {
      room.player.position = payload.position;
    }
    room.player.updatedAt = Date.now();
    socket.to(`watch:${room.id}`).emit('watch:player', { roomId: room.id, player: room.player });
  });

  // A member can request the current authoritative state (e.g. after buffering).
  socket.on('watch:sync', (payload: { roomId?: unknown }) => {
    if (typeof payload?.roomId !== 'string') return;
    const room = rooms.get(payload.roomId);
    if (!room || !room.members.has(userId)) return;
    if (room.player.playing) {
      const elapsed = (Date.now() - room.player.updatedAt) / 1000;
      const live = { ...room.player, position: Math.max(0, room.player.position + elapsed), updatedAt: Date.now() };
      socket.emit('watch:player', { roomId: room.id, player: live });
    } else {
      socket.emit('watch:player', { roomId: room.id, player: room.player });
    }
  });

  // Each member periodically reports its own playback position so everyone can
  // see, in the member panel, who is in sync with the host. The update is fanned
  // out to the whole room as a compact snapshot.
  socket.on('watch:position', (payload: { roomId?: unknown; position?: unknown; playing?: unknown }) => {
    if (typeof payload?.roomId !== 'string') return;
    const room = rooms.get(payload.roomId);
    if (!room) return;
    const member = room.members.get(userId);
    if (!member) return;
    if (typeof payload.position === 'number' && Number.isFinite(payload.position) && payload.position >= 0) {
      member.position = payload.position;
    }
    if (typeof payload.playing === 'boolean') member.playing = payload.playing;
    member.reportedAt = Date.now();
    io.to(`watch:${room.id}`).emit('watch:positions', {
      roomId: room.id,
      positions: [...room.members.values()].map((m) => ({
        userId: m.userId,
        position: m.position,
        playing: m.playing,
        reportedAt: m.reportedAt
      }))
    });
  });

  // The promoted host publishes its current player position to seed everyone.
  socket.on('watch:hostState', (payload: { roomId?: unknown; playing?: unknown; position?: unknown }) => {
    if (typeof payload?.roomId !== 'string') return;
    const room = rooms.get(payload.roomId);
    if (!room || room.hostId !== userId) return;
    if (typeof payload.playing === 'boolean') room.player.playing = payload.playing;
    if (typeof payload.position === 'number' && Number.isFinite(payload.position) && payload.position >= 0) {
      room.player.position = payload.position;
    }
    room.player.updatedAt = Date.now();
    io.to(`watch:${room.id}`).emit('watch:player', { roomId: room.id, player: room.player });
  });

  // --- Ephemeral room chat ---

  socket.on('watch:chat', (payload: { roomId?: unknown; body?: unknown; gifUrl?: unknown }) => {
    if (typeof payload?.roomId !== 'string') return;
    const room = rooms.get(payload.roomId);
    if (!room) return;
    const member = room.members.get(userId);
    if (!member) return;
    const body = typeof payload.body === 'string' ? payload.body.trim().slice(0, 2000) : '';
    const gifUrl = typeof payload.gifUrl === 'string' && /^https?:\/\//i.test(payload.gifUrl)
      ? payload.gifUrl.slice(0, 2000)
      : undefined;
    if (!body && !gifUrl) return;
    const message: WatchChatMessage = {
      id: randomUUID(),
      roomId: room.id,
      senderId: userId,
      senderNickname: member.user.nickname,
      senderAvatar: member.user.avatarData,
      senderNameStyle: member.user.nameStyle ?? null,
      body,
      gifUrl,
      createdAt: new Date().toISOString()
    };
    room.chat.push(message);
    if (room.chat.length > MAX_CHAT_HISTORY) room.chat.splice(0, room.chat.length - MAX_CHAT_HISTORY);
    io.to(`watch:${room.id}`).emit('watch:chatMessage', { message });
  });

  socket.on('watch:chatDelete', (payload: { roomId?: unknown; messageId?: unknown }) => {
    if (typeof payload?.roomId !== 'string' || typeof payload?.messageId !== 'string') return;
    const room = rooms.get(payload.roomId);
    if (!room || !room.members.has(userId)) return;
    const index = room.chat.findIndex((m) => m.id === payload.messageId);
    if (index === -1) return;
    if (room.chat[index].senderId !== userId && room.hostId !== userId) return;
    room.chat.splice(index, 1);
    io.to(`watch:${room.id}`).emit('watch:chatDeleted', { roomId: room.id, messageId: payload.messageId });
  });

  socket.on('disconnect', () => {
    const roomId = socketRoom.get(socket.id);
    if (roomId) leaveRoom(roomId);
  });
}
