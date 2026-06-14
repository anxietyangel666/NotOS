import type { Server, Socket } from 'socket.io';
import { randomUUID } from 'node:crypto';
import { getGroupChannelById, isGroupMember, listGroupMembers } from '../db/groups.js';
import { findUserById, toPublicUser, type PublicUser } from '../db/users.js';
import { pool } from '../db/pool.js';

type Participant = {
  userId: string;
  user: PublicUser;
  sockets: Set<string>;
  muted: boolean;
  screen: boolean;
  talking: boolean;
  joinedAt: number;
};

type EphemeralMessage = {
  id: string;
  channelId: string;
  senderId: string;
  senderNickname: string;
  senderAvatar: string;
  body: string;
  createdAt: string;
};

// channelId -> participants
const rooms = new Map<string, Map<string, Participant>>();
// channelId -> ephemeral chat history (cleared when the room empties)
const roomChats = new Map<string, EphemeralMessage[]>();
// socketId -> channelId (so a disconnect can clean up the right room)
const socketChannel = new Map<string, string>();
// channelId -> groupId. Cached so the hot paths (voice:state, requestRooms,
// broadcasts) don't re-query the channel row on every mute/screen toggle.
const channelGroup = new Map<string, string>();

const MAX_CHAT_HISTORY = 200;

// Short-lived cache of a group's member ids. Mute/screen toggles fan out to
// every group member, and previously each toggle hit the DB (often twice).
// Caching for a few seconds collapses bursts of toggles into a single query
// while staying fresh enough for membership changes.
const GROUP_MEMBERS_TTL_MS = 5000;
const groupMembersCache = new Map<string, { ids: string[]; at: number }>();

async function getGroupMemberIds(groupId: string): Promise<string[]> {
  const cached = groupMembersCache.get(groupId);
  const now = Date.now();
  if (cached && now - cached.at < GROUP_MEMBERS_TTL_MS) return cached.ids;
  const members = await listGroupMembers(groupId);
  const ids = members.map((m) => m.user_id);
  groupMembersCache.set(groupId, { ids, at: now });
  return ids;
}

// Resolve a channel's group id, using the cache and falling back to the DB
// (and populating the cache) on a miss.
async function resolveGroupId(channelId: string): Promise<string | undefined> {
  const cached = channelGroup.get(channelId);
  if (cached) return cached;
  const channel = await getGroupChannelById(channelId);
  if (channel?.group_id) {
    channelGroup.set(channelId, channel.group_id);
    return channel.group_id;
  }
  return undefined;
}

function publicParticipants(channelId: string) {
  const room = rooms.get(channelId);
  if (!room) return [];
  return [...room.values()].map((p) => ({
    userId: p.userId,
    user: p.user,
    muted: p.muted,
    screen: p.screen,
    talking: p.talking,
    joinedAt: p.joinedAt
  }));
}

function broadcastParticipants(io: Server, groupId: string, channelId: string) {
  // Everyone in the group should see live counts (for the x/N badge) and the
  // bottom participant list, so broadcast to all group members.
  void getGroupMemberIds(groupId).then((ids) => {
    const payload = { groupId, channelId, participants: publicParticipants(channelId) };
    for (const id of ids) io.to(id).emit('voice:participants', payload);
  });
}

async function isGroupAdmin(groupId: string, userId: string): Promise<boolean> {
  const members = await listGroupMembers(groupId);
  const member = members.find((m) => m.user_id === userId);
  if (!member) return false;
  if (member.role === 'Owner') return true;
  if (!member.role_id) return false;
  const roleRow = (
    await pool.query('SELECT is_owner, permissions FROM group_roles WHERE id = $1', [member.role_id])
  ).rows[0];
  if (!roleRow) return false;
  if (roleRow.is_owner) return true;
  const perms: string[] = roleRow.permissions ?? [];
  return perms.includes('ManageChannels') || perms.includes('ManageRoles') || perms.includes('KickMembers');
}

export function registerVoiceHandlers(io: Server, socket: Socket, userId: string) {
  async function leaveRoom(channelId: string, reason: 'leave' | 'disconnect') {
    const room = rooms.get(channelId);
    if (!room) return;
    const participant = room.get(userId);
    if (!participant) return;

    participant.sockets.delete(socket.id);
    socketChannel.delete(socket.id);
    void socket.leave(`voice:${channelId}`);

    // The user is only fully gone once all of their sockets left the room.
    if (participant.sockets.size > 0) return;

    room.delete(userId);
    const groupId = await resolveGroupId(channelId);
    io.to(`voice:${channelId}`).emit('voice:peerLeft', { channelId, userId });

    if (room.size === 0) {
      rooms.delete(channelId);
      // Ephemeral chat is destroyed when the room empties.
      roomChats.delete(channelId);
      // The room is gone; drop its group mapping so the cache cannot grow
      // unbounded. It is re-populated on the next join.
      channelGroup.delete(channelId);
      if (groupId) io.to(`voice:${channelId}`).emit('voice:chatCleared', { channelId });
    }
    if (groupId) broadcastParticipants(io, groupId, channelId);
  }

  socket.on('voice:join', async (payload: { channelId?: unknown }) => {
    if (typeof payload?.channelId !== 'string') return;
    const channelId = payload.channelId;
    const channel = await getGroupChannelById(channelId);
    if (!channel || channel.type !== 'voice') {
      socket.emit('voice:error', { channelId, code: 'INVALID_CHANNEL' });
      return;
    }
    const groupId = channel.group_id;
    // Cache the channel->group mapping so later mute/screen toggles and room
    // queries don't have to hit the DB again.
    channelGroup.set(channelId, groupId);
    if (!(await isGroupMember(groupId, userId))) {
      socket.emit('voice:error', { channelId, code: 'NOT_MEMBER' });
      return;
    }

    let room = rooms.get(channelId);
    const alreadyIn = room?.has(userId) ?? false;

    // Enforce the member limit, but admins bypass it.
    if (!alreadyIn && channel.user_limit != null && room && room.size >= channel.user_limit) {
      const admin = await isGroupAdmin(groupId, userId);
      if (!admin) {
        socket.emit('voice:error', { channelId, code: 'ROOM_FULL' });
        return;
      }
    }

    const record = await findUserById(userId);
    if (!record) return;
    const user = toPublicUser(record);

    if (!room) {
      room = new Map();
      rooms.set(channelId, room);
    }

    socketChannel.set(socket.id, channelId);
    void socket.join(`voice:${channelId}`);

    let participant = room.get(userId);
    if (!participant) {
      participant = {
        userId,
        user,
        sockets: new Set(),
        muted: false,
        screen: false,
        talking: false,
        joinedAt: Date.now()
      };
      room.set(userId, participant);
      // Tell existing peers a new participant joined so they create a peer
      // connection. The "polite" flag lets the new joiner make the offers.
      socket.to(`voice:${channelId}`).emit('voice:peerJoined', { channelId, userId, user });
    }
    participant.sockets.add(socket.id);
    participant.user = user;

    // Send the joining socket the current peer list it should connect to.
    const existingPeers = publicParticipants(channelId).filter((p) => p.userId !== userId);
    socket.emit('voice:joined', {
      channelId,
      peers: existingPeers,
      chat: roomChats.get(channelId) ?? []
    });
    broadcastParticipants(io, groupId, channelId);
  });

  socket.on('voice:leave', (payload: { channelId?: unknown }) => {
    if (typeof payload?.channelId !== 'string') return;
    void leaveRoom(payload.channelId, 'leave');
  });

  // Send the current occupancy of every active voice room in a group so the
  // client can show participants and x/N badges before the user joins.
  socket.on('voice:requestRooms', async (payload: { groupId?: unknown }) => {
    if (typeof payload?.groupId !== 'string') return;
    const groupId = payload.groupId;
    if (!(await isGroupMember(groupId, userId))) return;
    // Iterate the in-memory rooms and resolve each channel's group from the
    // cache (falling back to a single DB lookup only on a cache miss) instead
    // of querying every active channel's row every time a group is opened.
    for (const [channelId, room] of rooms.entries()) {
      if (room.size === 0) continue;
      const roomGroupId = await resolveGroupId(channelId);
      if (roomGroupId !== groupId) continue;
      socket.emit('voice:participants', { groupId, channelId, participants: publicParticipants(channelId) });
    }
  });

  // Targeted WebRTC signaling for the mesh: relay to a specific peer.
  socket.on('voice:signal', (payload: { channelId?: unknown; targetId?: unknown; data?: unknown }) => {
    if (typeof payload?.channelId !== 'string' || typeof payload?.targetId !== 'string') return;
    if (typeof payload.data !== 'object' || payload.data === null) return;
    const room = rooms.get(payload.channelId);
    if (!room || !room.has(userId) || !room.has(payload.targetId)) return;
    io.to(payload.targetId).emit('voice:signal', {
      channelId: payload.channelId,
      from: userId,
      data: payload.data
    });
  });

  socket.on('voice:state', async (payload: { channelId?: unknown; muted?: unknown; screen?: unknown; talking?: unknown }) => {
    if (typeof payload?.channelId !== 'string') return;
    const room = rooms.get(payload.channelId);
    const participant = room?.get(userId);
    if (!participant) return;
    if (typeof payload.muted === 'boolean') participant.muted = payload.muted;
    if (typeof payload.screen === 'boolean') participant.screen = payload.screen;
    if (typeof payload.talking === 'boolean') participant.talking = payload.talking;
    const statePayload = {
      channelId: payload.channelId,
      userId,
      muted: participant.muted,
      screen: participant.screen,
      talking: participant.talking
    };
    // Tell everyone in the room (they need the live talking/muted indicators
    // for the voice stage).
    io.to(`voice:${payload.channelId}`).emit('voice:state', statePayload);
    // Also tell every group member (their left-side channel list shows the
    // mic/screen icons even when they are not currently in the channel).
    // Skip the 'talking' updates here to avoid flooding non-room sockets.
    //
    // This used to do up to three DB queries per toggle (getGroupChannelById +
    // listGroupMembers, plus another listGroupMembers inside
    // broadcastParticipants), which is what made the mic/screen icons appear
    // with a visible delay. Now the group id and member list both come from the
    // in-memory caches. We resolve the member ids once and reuse them for both
    // the full participants snapshot and the incremental state fan-out.
    if (typeof payload.muted === 'boolean' || typeof payload.screen === 'boolean') {
      const groupId = await resolveGroupId(payload.channelId);
      if (groupId) {
        const memberIds = await getGroupMemberIds(groupId);
        const participantsPayload = {
          groupId,
          channelId: payload.channelId,
          participants: publicParticipants(payload.channelId)
        };
        // A full participants snapshot guarantees the left-side channel list
        // updates the mic/screen icons even for members whose client had not
        // yet cached this channel's participants, plus the incremental state
        // event for clients that track it directly.
        for (const id of memberIds) {
          io.to(id).emit('voice:participants', participantsPayload);
          io.to(id).emit('voice:state', statePayload);
        }
      }
    }
  });

  // Ephemeral text chat tied to the active voice room.
  socket.on('voice:chat', async (payload: { channelId?: unknown; body?: unknown }) => {
    if (typeof payload?.channelId !== 'string' || typeof payload?.body !== 'string') return;
    const body = payload.body.trim().slice(0, 2000);
    if (!body) return;
    const room = rooms.get(payload.channelId);
    if (!room || !room.has(userId)) return;
    const participant = room.get(userId)!;
    const message: EphemeralMessage = {
      id: randomUUID(),
      channelId: payload.channelId,
      senderId: userId,
      senderNickname: participant.user.nickname,
      senderAvatar: participant.user.avatarData,
      body,
      createdAt: new Date().toISOString()
    };
    let history = roomChats.get(payload.channelId);
    if (!history) {
      history = [];
      roomChats.set(payload.channelId, history);
    }
    history.push(message);
    if (history.length > MAX_CHAT_HISTORY) history.splice(0, history.length - MAX_CHAT_HISTORY);
    io.to(`voice:${payload.channelId}`).emit('voice:chatMessage', { message });
  });

  // Delete an ephemeral voice-chat message. Only the original sender may do it.
  socket.on('voice:chatDelete', (payload: { channelId?: unknown; messageId?: unknown }) => {
    if (typeof payload?.channelId !== 'string' || typeof payload?.messageId !== 'string') return;
    const room = rooms.get(payload.channelId);
    if (!room || !room.has(userId)) return;
    const history = roomChats.get(payload.channelId);
    if (!history) return;
    const index = history.findIndex((m) => m.id === payload.messageId);
    if (index === -1) return;
    if (history[index].senderId !== userId) return;
    history.splice(index, 1);
    io.to(`voice:${payload.channelId}`).emit('voice:chatDeleted', {
      channelId: payload.channelId,
      messageId: payload.messageId
    });
  });

  // Edit an ephemeral voice-chat message. Only the original sender may do it.
  socket.on('voice:chatEdit', (payload: { channelId?: unknown; messageId?: unknown; body?: unknown }) => {
    if (
      typeof payload?.channelId !== 'string' ||
      typeof payload?.messageId !== 'string' ||
      typeof payload?.body !== 'string'
    ) {
      return;
    }
    const body = payload.body.trim().slice(0, 2000);
    if (!body) return;
    const room = rooms.get(payload.channelId);
    if (!room || !room.has(userId)) return;
    const history = roomChats.get(payload.channelId);
    if (!history) return;
    const message = history.find((m) => m.id === payload.messageId);
    if (!message || message.senderId !== userId) return;
    message.body = body;
    io.to(`voice:${payload.channelId}`).emit('voice:chatEdited', {
      channelId: payload.channelId,
      messageId: payload.messageId,
      body
    });
  });

  socket.on('disconnect', () => {
    const channelId = socketChannel.get(socket.id);
    if (channelId) void leaveRoom(channelId, 'disconnect');
  });
}
