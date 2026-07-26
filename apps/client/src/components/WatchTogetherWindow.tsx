import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Language, PublicUser } from '../api/types';
import { t } from '../i18n';
import { WindowFrame } from './WindowFrame';
import { EmojiPicker } from './EmojiPicker';
import { EmojiInlineInput, type EmojiInlineInputHandle } from './EmojiInlineInput';
import { EmojiToggleIcon, GifIcon } from './ChatComposeIcons';
import { MessageText } from './Twemoji';
import { useSocket } from '../hooks/use-socket';
import type { TenorGif } from '../utils/tenor';
import { loadYouTubeApi, YT_STATE, type YTPlayer } from '../utils/youtube';
import { buildWatchInviteLink } from '../utils/watch-invite-link';
import { expandCustomEmojiShortcodes, splitCustomEmoji } from '../utils/custom-emoji';
import { assetUrl } from '../utils/assets';

/**
 * WatchTogetherWindow — a "Watch Together" app (like watch2gether / WatchTogether):
 * create or join a room, watch YouTube / direct video links in sync, and chat
 * on the right with the same emoji + GIF picker used across the app.
 *
 * The lobby is a server browser of public rooms (name, open/locked, member
 * count). Rooms can be password-protected and joined via an invite link. The
 * host's playback is authoritative and synchronized to everyone in the room.
 */

type WatchMemberView = {
  userId: string;
  user: PublicUser;
  joinedAt: number;
  isHost: boolean;
  position?: number;
  playing?: boolean;
  reportedAt?: number;
};

type MemberPosition = {
  userId: string;
  position: number;
  playing: boolean;
  reportedAt: number;
};

// Format a number of seconds as m:ss (or h:mm:ss) for the member panel.
function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

type WatchSource = {
  kind: 'youtube' | 'url' | 'embed';
  value: string;
  title: string;
  addedBy: string;
};

type PlayerState = {
  source: WatchSource | null;
  playing: boolean;
  position: number;
  updatedAt: number;
};

type WatchChatMessage = {
  id: string;
  roomId: string;
  senderId: string;
  senderNickname: string;
  senderAvatar: string;
  body: string;
  gifUrl?: string;
  createdAt: string;
};

type RoomSnapshot = {
  id: string;
  name: string;
  isPublic: boolean;
  locked: boolean;
  inviteCode: string;
  hostId: string;
  controlMode: ControlMode;
  members: WatchMemberView[];
  player: PlayerState;
  chat: WatchChatMessage[];
};

type ControlMode = 'host' | 'everyone';
type WatchView = 'home' | 'rooms' | 'room';
const HOME_ICON = assetUrl('Emoji/home.png');

type LobbyRoom = {
  id: string;
  name: string;
  isPublic: boolean;
  locked: boolean;
  memberCount: number;
  hostId: string;
  nowPlaying: string;
  createdAt: number;
};

type Props = {
  language: Language;
  currentUser: PublicUser;
  token: string;
  minimized: boolean;
  maximized: boolean;
  zIndex: number;
  initialInvite?: { code: string; requestId: number } | null;
  onFocus: () => void;
  onClose: () => void;
  onMinimize: () => void;
  onToggleMaximize: () => void;
};

const YT_PATTERNS = [
  /(?:youtube\.com\/watch\?[^#]*\bv=)([\w-]{11})/i,
  /(?:youtu\.be\/)([\w-]{11})/i,
  /(?:youtube\.com\/embed\/)([\w-]{11})/i,
  /(?:youtube\.com\/shorts\/)([\w-]{11})/i
];

function youtubeWidgetReferrer(): string {
  if (typeof window !== 'undefined' && /^https?:\/\//i.test(window.location.origin)) {
    return window.location.origin;
  }
  return 'https://www.youtube.com';
}

// Turn arbitrary user input into a canonical source the player can render.
function parseSource(input: string): WatchSource | null {
  const value = input.trim();
  if (!value) return null;
  for (const pattern of YT_PATTERNS) {
    const match = value.match(pattern);
    if (match) return { kind: 'youtube', value: match[1], title: '', addedBy: '' };
  }
  if (/^https?:\/\//i.test(value)) {
    if (/\.(mp4|webm|ogg|ogv|mov|m4v)(\?|$)/i.test(value)) {
      return { kind: 'url', value, title: '', addedBy: '' };
    }
    // Anything else http(s) is embedded in an iframe (e.g. a film host page).
    return { kind: 'embed', value, title: '', addedBy: '' };
  }
  return null;
}

// Matches http(s) URLs anywhere in a chat body.
const CHAT_URL_RE = /https?:\/\/[^\s<>"')]+/gi;

// Renders a chat message body: plain text + emoji via MessageText, with http(s)
// links turned into clickable anchors and a rich embed card for the first link
// the player can open (YouTube/video/site). When a member is allowed to control
// playback, the card offers a one-tap "play in room" button so a link dropped
// in chat can be loaded for everyone.
function WatchChatBody({
  text,
  language,
  canControl,
  onPlay
}: {
  text: string;
  language: Language;
  canControl: boolean;
  onPlay: (url: string) => void;
}) {
  const parts: Array<{ type: 'text' | 'url' | 'custom-emoji'; value: string }> = [];
  splitCustomEmoji(text).forEach((customPart) => {
    if (customPart.type === 'custom-emoji') {
      parts.push({ type: 'custom-emoji', value: `<ce:${customPart.name}:${customPart.url}>` });
      return;
    }

    let last = 0;
    CHAT_URL_RE.lastIndex = 0;
    for (const match of customPart.value.matchAll(CHAT_URL_RE)) {
      const url = match[0];
      const start = match.index ?? 0;
      if (start > last) parts.push({ type: 'text', value: customPart.value.slice(last, start) });
      parts.push({ type: 'url', value: url });
      last = start + url.length;
    }
    if (last < customPart.value.length) parts.push({ type: 'text', value: customPart.value.slice(last) });
  });

  // The first playable link (if any) gets a rich embed card under the message.
  const firstPlayable = parts.find((p) => p.type === 'url' && parseSource(p.value));

  return (
    <>
      <p className="message-text">
        {parts.map((part, i) =>
          part.type === 'url' ? (
            <a key={i} href={part.value} target="_blank" rel="noreferrer noopener" className="watch-msg-link">
              {part.value}
            </a>
          ) : (
            <MessageText key={i} text={part.value} />
          )
        )}
      </p>
      {firstPlayable ? (
        <WatchLinkEmbed url={firstPlayable.value} language={language} canControl={canControl} onPlay={onPlay} />
      ) : null}
    </>
  );
}

// A compact embed card for a link shared in chat. YouTube links show a
// thumbnail; other playable links show a generic media card. The "play in room"
// action is only offered to members allowed to drive playback.
function WatchLinkEmbed({
  url,
  language,
  canControl,
  onPlay
}: {
  url: string;
  language: Language;
  canControl: boolean;
  onPlay: (url: string) => void;
}) {
  const source = parseSource(url);
  if (!source) return null;
  const isYouTube = source.kind === 'youtube';
  const thumb = isYouTube ? `https://i.ytimg.com/vi/${source.value}/hqdefault.jpg` : null;
  let host = url;
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { /* keep raw */ }

  return (
    <div className={thumb ? 'watch-link-embed has-thumb' : 'watch-link-embed'}>
      {thumb ? (
        <a className="watch-link-thumb" href={url} target="_blank" rel="noreferrer noopener">
          <img src={thumb} alt="" loading="lazy" />
        </a>
      ) : null}
      <div className="watch-link-embed-body">
        <span className="watch-link-embed-kind">
          {isYouTube ? 'YouTube' : source.kind === 'url' ? t(language, 'watchNowPlaying') : host}
        </span>
        <a className="watch-link-embed-host" href={url} target="_blank" rel="noreferrer noopener">{host}</a>
        {canControl ? (
          <button type="button" className="watch-link-embed-play" onClick={() => onPlay(url)}>
            ▶ {t(language, 'watchLoadVideo')}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function liveErrorKey(code: string): Parameters<typeof t>[1] {
  if (code === 'BAD_PASSWORD') return 'watchWrongPassword';
  return 'watchRoomNotFound';
}

export function WatchTogetherWindow({
  language,
  currentUser,
  token,
  minimized,
  maximized,
  zIndex,
  initialInvite,
  onFocus,
  onClose,
  onMinimize,
  onToggleMaximize
}: Props) {
  const socket = useSocket();

  const [watchNav, setWatchNav] = useState<{ entries: WatchView[]; index: number }>({ entries: ['home'], index: 0 });
  const [lobbyRooms, setLobbyRooms] = useState<LobbyRoom[]>([]);
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [player, setPlayer] = useState<PlayerState | null>(null);
  const [chat, setChat] = useState<WatchChatMessage[]>([]);
  // Live playback position of every member (keyed by userId), used by the sync panel.
  const [memberPositions, setMemberPositions] = useState<Record<string, MemberPosition>>({});
  // Ticks once per second so extrapolated times in the sync panel stay live.
  const [, setNowTick] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Create-room form.
  const [newName, setNewName] = useState('');
  const [newPublic, setNewPublic] = useState(true);
  const [newPassword, setNewPassword] = useState('');

  // Join with password prompt.
  const [passwordPrompt, setPasswordPrompt] = useState<{ roomId: string; name: string } | null>(null);
  const [passwordInput, setPasswordInput] = useState('');

  // Player search/load box (host).
  const [sourceInput, setSourceInput] = useState('');

  // Chat composer.
  const [draft, setDraft] = useState('');
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [pickerTab, setPickerTab] = useState<'emoji' | 'gif'>('emoji');
  const emojiAnchorRef = useRef<HTMLDivElement | null>(null);
  const chatInputRef = useRef<EmojiInlineInputHandle | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // YouTube IFrame Player API: a plain embed iframe cannot be controlled, so we
  // drive YouTube through a real player object instead.
  const ytContainerRef = useRef<HTMLDivElement | null>(null);
  const ytPlayerRef = useRef<YTPlayer | null>(null);
  const ytReadyRef = useRef(false);
  // Guards so applying remote state to the player does not echo back as a local
  // control event (which would create a feedback loop between members).
  const applyingRemoteRef = useRef(false);

  const isHost = room ? room.hostId === currentUser.id : false;
  const controlMode: ControlMode = room?.controlMode ?? 'host';
  // Whether the local user may drive playback: the host always can; everyone
  // can when the room is set to shared-control mode.
  const canControl = isHost || controlMode === 'everyone';
  const roomId = room?.id ?? null;
  const view = watchNav.entries[watchNav.index] ?? 'home';
  const canGoBack = watchNav.index > 0;
  const canGoForward = watchNav.index < watchNav.entries.length - 1;

  // Settings modal (host only).
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Collapsible member list (Twitch-style), expanded by default.
  const [membersCollapsed, setMembersCollapsed] = useState(false);

  // Keep the latest values reachable from stable callbacks (YT events / timers).
  const isHostRef = useRef(isHost);
  const canControlRef = useRef(canControl);
  const roomIdRef = useRef<string | null>(roomId);
  const playerRef = useRef<PlayerState | null>(player);
  const socketRef = useRef(socket);
  useEffect(() => { isHostRef.current = isHost; }, [isHost]);
  useEffect(() => { canControlRef.current = canControl; }, [canControl]);
  useEffect(() => { roomIdRef.current = roomId; }, [roomId]);
  useEffect(() => { playerRef.current = player; }, [player]);
  useEffect(() => { socketRef.current = socket; }, [socket]);

  function leaveCurrentRoom() {
    const id = roomIdRef.current;
    if (socketRef.current && id) socketRef.current.emit('watch:leave', { roomId: id });
    setRoom(null);
    setPlayer(null);
    setChat([]);
    setMemberPositions({});
    setSettingsOpen(false);
    setSourceInput('');
    setError(null);
  }

  function pushWatchView(next: WatchView) {
    const current = watchNav.entries[watchNav.index] ?? 'home';
    if (current === next) return;
    if (current === 'room' && next !== 'room') {
      leaveCurrentRoom();
      setWatchNav((nav) => {
        const prefix = nav.entries.slice(0, nav.index);
        if (prefix[prefix.length - 1] === next) {
          return { entries: prefix, index: Math.max(0, prefix.length - 1) };
        }
        return { entries: [...prefix, next], index: prefix.length };
      });
      return;
    }
    setWatchNav((nav) => ({
      entries: [...nav.entries.slice(0, nav.index + 1), next],
      index: nav.index + 1
    }));
  }

  function goWatchHistory(delta: -1 | 1) {
    const nextIndex = watchNav.index + delta;
    if (nextIndex < 0 || nextIndex >= watchNav.entries.length) return;
    const current = watchNav.entries[watchNav.index] ?? 'home';
    const next = watchNav.entries[nextIndex] ?? 'home';
    if (next === 'room' && !room) return;
    if (current === 'room' && next !== 'room') {
      leaveCurrentRoom();
      setWatchNav((nav) => ({
        entries: nav.entries.slice(0, nextIndex + 1),
        index: nextIndex
      }));
      return;
    }
    setWatchNav((nav) => ({ ...nav, index: nextIndex }));
  }

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast((current) => (current === message ? null : current)), 2200);
  }, []);

  // --- Socket wiring ---
  useEffect(() => {
    if (!socket) return;

    function onLobby(payload: { rooms: LobbyRoom[] }) {
      setLobbyRooms(payload.rooms);
    }
    function onJoined(payload: { room: RoomSnapshot }) {
      setRoom(payload.room);
      setPlayer(payload.room.player);
      setChat(payload.room.chat);
      pushWatchView('room');
      setError(null);
      setPasswordPrompt(null);
      setPasswordInput('');
      // Seed the per-member positions from the snapshot.
      const seeded: Record<string, MemberPosition> = {};
      for (const m of payload.room.members) {
        seeded[m.userId] = {
          userId: m.userId,
          position: m.position ?? 0,
          playing: m.playing ?? false,
          reportedAt: m.reportedAt ?? Date.now()
        };
      }
      setMemberPositions(seeded);
    }
    function onMembers(payload: { roomId: string; hostId: string; controlMode?: ControlMode; members: WatchMemberView[] }) {
      setRoom((current) => (current && current.id === payload.roomId
        ? { ...current, hostId: payload.hostId, controlMode: payload.controlMode ?? current.controlMode, members: payload.members }
        : current));
    }
    function onPlayer(payload: { roomId: string; player: PlayerState }) {
      setPlayer(payload.player);
    }
    function onPositions(payload: { roomId: string; positions: MemberPosition[] }) {
      const next: Record<string, MemberPosition> = {};
      for (const entry of payload.positions) next[entry.userId] = entry;
      setMemberPositions(next);
    }
    function onChatMessage(payload: { message: WatchChatMessage }) {
      setChat((current) => [...current, payload.message]);
    }
    function onChatDeleted(payload: { messageId: string }) {
      setChat((current) => current.filter((m) => m.id !== payload.messageId));
    }
    function onHostPromoted() {
      // We are the new host: publish our current player position to seed peers.
      const id = roomIdRef.current;
      if (!id) return;
      const yt = ytPlayerRef.current;
      const el = videoRef.current;
      let playing = playerRef.current?.playing ?? false;
      let position = playerRef.current?.position ?? 0;
      if (yt && ytReadyRef.current) {
        try { playing = yt.getPlayerState() === YT_STATE.PLAYING; position = yt.getCurrentTime(); } catch { /* ignore */ }
      } else if (el) {
        playing = !el.paused;
        position = el.currentTime;
      }
      socketRef.current?.emit('watch:hostState', { roomId: id, playing, position });
    }
    function onError(payload: { code: string; roomId?: string }) {
      setError(t(language, liveErrorKey(payload.code)));
    }

    socket.on('watch:lobby', onLobby);
    socket.on('watch:joined', onJoined);
    socket.on('watch:members', onMembers);
    socket.on('watch:player', onPlayer);
    socket.on('watch:positions', onPositions);
    socket.on('watch:chatMessage', onChatMessage);
    socket.on('watch:chatDeleted', onChatDeleted);
    socket.on('watch:hostPromoted', onHostPromoted);
    socket.on('watch:error', onError);

    return () => {
      socket.off('watch:lobby', onLobby);
      socket.off('watch:joined', onJoined);
      socket.off('watch:members', onMembers);
      socket.off('watch:player', onPlayer);
      socket.off('watch:positions', onPositions);
      socket.off('watch:chatMessage', onChatMessage);
      socket.off('watch:chatDeleted', onChatDeleted);
      socket.off('watch:hostPromoted', onHostPromoted);
      socket.off('watch:error', onError);
    };
  }, [socket, language, watchNav]);

  // Subscribe to the public lobby while browsing it.
  useEffect(() => {
    if (!socket || view === 'room') return;
    socket.emit('watch:lobbyWatch');
    return () => {
      socket.emit('watch:lobbyUnwatch');
    };
  }, [socket, view]);

  // Deep-link: when the app was opened with `?watch=<inviteCode>`, auto-join
  // that room once and clear the param so a refresh doesn't re-join.
  const deepLinkedRef = useRef(false);
  useEffect(() => {
    if (!socket || deepLinkedRef.current) return;
    const code = new URLSearchParams(window.location.search).get('watch');
    if (!code) return;
    deepLinkedRef.current = true;
    socket.emit('watch:join', { inviteCode: code });
    const url = new URL(window.location.href);
    url.searchParams.delete('watch');
    window.history.replaceState({}, '', url.toString());
  }, [socket]);

  const handledInitialInviteRef = useRef<number | null>(null);
  useEffect(() => {
    if (!socket || !initialInvite || handledInitialInviteRef.current === initialInvite.requestId) return;
    handledInitialInviteRef.current = initialInvite.requestId;
    socket.emit('watch:join', { inviteCode: initialInvite.code });
  }, [socket, initialInvite]);

  // Auto-scroll chat to the newest message.
  useEffect(() => {
    const node = chatScrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [chat]);

  // Keep the sync-panel clocks ticking once per second while in a room.
  useEffect(() => {
    if (view !== 'room') return;
    const timer = window.setInterval(() => setNowTick((n) => (n + 1) % 1_000_000), 1000);
    return () => window.clearInterval(timer);
  }, [view]);

  // Host playback controls fan out to the room. Reads from refs so it can be
  // called from stable YT event handlers and interval timers.
  const emitControl = useCallback((playing: boolean, position: number) => {
    if (applyingRemoteRef.current) return;
    const sock = socketRef.current;
    const id = roomIdRef.current;
    if (sock && id && canControlRef.current) sock.emit('watch:control', { roomId: id, playing, position });
  }, []);

  // Live position of the room (extrapolated while playing).
  const livePosition = useCallback((p: PlayerState | null) => {
    if (!p) return 0;
    return p.playing ? Math.max(0, p.position + (Date.now() - p.updatedAt) / 1000) : p.position;
  }, []);

  // Read the local player's current time + playing state, regardless of source.
  const readLocalPlayback = useCallback((): { position: number; playing: boolean } => {
    const yt = ytPlayerRef.current;
    if (yt && ytReadyRef.current) {
      try { return { position: yt.getCurrentTime(), playing: yt.getPlayerState() === YT_STATE.PLAYING }; }
      catch { /* not ready */ }
    }
    const el = videoRef.current;
    if (el) return { position: el.currentTime, playing: !el.paused };
    const p = playerRef.current;
    return { position: livePosition(p), playing: p?.playing ?? false };
  }, [livePosition]);

  // Seek the LOCAL player to the host's current live position (manual resync).
  // Available to everyone, including the host (a no-op snap for the host).
  const syncToHost = useCallback(() => {
    const p = playerRef.current;
    if (!p) return;
    const target = Math.max(0, livePosition(p));
    const yt = ytPlayerRef.current;
    if (yt && ytReadyRef.current && p.source?.kind === 'youtube') {
      try {
        yt.seekTo(target, true);
        if (p.playing) yt.playVideo(); else yt.pauseVideo();
      } catch { /* ignore */ }
    }
    const el = videoRef.current;
    if (el && p.source?.kind === 'url') {
      el.currentTime = target;
      if (p.playing) void el.play().catch(() => undefined); else el.pause();
    }
    // Immediately report the corrected position so the panel updates at once.
    const sock = socketRef.current;
    const id = roomIdRef.current;
    if (sock && id) sock.emit('watch:position', { roomId: id, position: target, playing: p.playing });
  }, [livePosition]);

  // Synchronize the native <video> player (for url-kind sources) to room state
  // for non-host members. The host's element drives the room instead.
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !player || player.source?.kind !== 'url') return;
    // Apply the room's state to every player. Programmatic play/pause/seek would
    // otherwise echo back through the element's events as a local control, so we
    // guard it the same way the YouTube path does.
    applyingRemoteRef.current = true;
    try {
      const live = livePosition(player);
      if (Math.abs(el.currentTime - live) > 1.2) el.currentTime = live;
      if (player.playing && el.paused) void el.play().catch(() => undefined);
      if (!player.playing && !el.paused) el.pause();
    } finally {
      window.setTimeout(() => { applyingRemoteRef.current = false; }, 250);
    }
  }, [player, livePosition]);

  // --- YouTube player lifecycle (create/destroy when the YouTube source changes) ---
  const ytVideoId = player?.source?.kind === 'youtube' ? player.source.value : null;
  useEffect(() => {
    if (!ytVideoId) {
      // Tear down any existing player when leaving a YouTube source.
      if (ytPlayerRef.current) {
        try { ytPlayerRef.current.destroy(); } catch { /* ignore */ }
        ytPlayerRef.current = null;
        ytReadyRef.current = false;
      }
      return;
    }

    let cancelled = false;
    const startAt = Math.floor(livePosition(playerRef.current));

    void loadYouTubeApi().then((YT) => {
      if (cancelled || !ytContainerRef.current) return;

      // Recreate the player if one already exists for a previous video.
      if (ytPlayerRef.current) {
        try { ytPlayerRef.current.destroy(); } catch { /* ignore */ }
        ytPlayerRef.current = null;
        ytReadyRef.current = false;
      }

      ytPlayerRef.current = new YT.Player(ytContainerRef.current, {
        videoId: ytVideoId,
        playerVars: {
          autoplay: playerRef.current?.playing ? 1 : 0,
          start: Math.max(0, startAt),
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
          // Only members allowed to drive playback can scrub.
          controls: canControlRef.current ? 1 : 0,
          disablekb: canControlRef.current ? 0 : 1,
          enablejsapi: 1,
          // YouTube returns player error 153 in packaged Electron when the
          // embed has no HTTP referrer. Electron supplies the headers in the
          // main process; this keeps the IFrame API config consistent too.
          widget_referrer: youtubeWidgetReferrer(),
          ...(typeof window !== 'undefined' && /^https?:\/\//i.test(window.location.origin)
            ? { origin: window.location.origin }
            : {})
        },
        events: {
          onReady: (event) => {
            ytReadyRef.current = true;
            const p = playerRef.current;
            const target = Math.max(0, livePosition(p));
            event.target.seekTo(target, true);
            if (p?.playing) event.target.playVideo();
            else event.target.pauseVideo();
          },
          onStateChange: (event) => {
            // Only members allowed to control turn their own player actions
            // into room control events. Applying remote state is guarded so it
            // never echoes.
            if (!canControlRef.current || applyingRemoteRef.current) return;
            const time = event.target.getCurrentTime();
            if (event.data === YT_STATE.PLAYING) emitControl(true, time);
            else if (event.data === YT_STATE.PAUSED) emitControl(false, time);
          }
        }
      });
    });

    return () => {
      cancelled = true;
    };
    // Recreate only when the actual video id changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ytVideoId]);

  // Apply room player state to the YouTube player whenever it changes.
  useEffect(() => {
    const yt = ytPlayerRef.current;
    if (!yt || !ytReadyRef.current || !player || player.source?.kind !== 'youtube') return;

    applyingRemoteRef.current = true;
    try {
      const live = livePosition(player);
      let current = 0;
      try { current = yt.getCurrentTime(); } catch { current = 0; }
      // Re-seek when drifting more than ~1s (covers host pause/seek for guests).
      if (Math.abs(current - live) > 1.2) {
        yt.seekTo(Math.max(0, live), true);
      }
      const state = (() => { try { return yt.getPlayerState(); } catch { return YT_STATE.UNSTARTED; } })();
      if (player.playing && state !== YT_STATE.PLAYING && state !== YT_STATE.BUFFERING) {
        yt.playVideo();
      } else if (!player.playing && state === YT_STATE.PLAYING) {
        yt.pauseVideo();
      }
    } finally {
      // Release on the next tick so the resulting onStateChange is ignored.
      window.setTimeout(() => { applyingRemoteRef.current = false; }, 250);
    }
  }, [player, livePosition]);

  // The host periodically broadcasts its true position so guests correct drift
  // and any missed pause/seek converges. Cheap (1 event / 5s) and host-only.
  useEffect(() => {
    if (!isHost || !roomId || ytVideoId === null) return;
    const timer = window.setInterval(() => {
      const yt = ytPlayerRef.current;
      if (!yt || !ytReadyRef.current) return;
      try {
        const state = yt.getPlayerState();
        emitControl(state === YT_STATE.PLAYING, yt.getCurrentTime());
      } catch { /* player not ready */ }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [isHost, roomId, ytVideoId, emitControl]);

  // Every member (host included) reports its own playback position every few
  // seconds so the sync panel shows everyone's live time and drift vs the host.
  useEffect(() => {
    if (!roomId || !player?.source) return;
    const report = () => {
      const sock = socketRef.current;
      const id = roomIdRef.current;
      if (!sock || !id) return;
      let { position, playing } = readLocalPlayback();
      // The local player can briefly read 0 before it has started (YouTube not
      // ready yet, autoplay blocked, buffering). In that case fall back to the
      // room's known live position so the panel never gets stuck on 0:00.
      const p = playerRef.current;
      if ((!Number.isFinite(position) || position <= 0) && p?.source) {
        position = livePosition(p);
        if (!playing) playing = p.playing;
      }
      if (!Number.isFinite(position) || position < 0) position = 0;
      sock.emit('watch:position', { roomId: id, position, playing });
    };
    report();
    const timer = window.setInterval(report, 3000);
    return () => window.clearInterval(timer);
  }, [roomId, player?.source?.value, player?.source?.kind, readLocalPlayback, livePosition]);

  // --- Actions ---
  const createRoom = () => {
    if (!socket) return;
    const source = sourceInput.trim() ? parseSource(sourceInput) : null;
    socket.emit('watch:create', {
      name: newName.trim() || t(language, 'watchRoomNamePlaceholder'),
      isPublic: newPublic,
      password: newPassword.trim() || undefined,
      source
    });
    setNewName('');
    setNewPassword('');
    setSourceInput('');
  };

  const joinRoom = (target: LobbyRoom) => {
    if (!socket) return;
    if (target.locked) {
      setPasswordPrompt({ roomId: target.id, name: target.name });
      return;
    }
    socket.emit('watch:join', { roomId: target.id });
  };

  const submitPassword = () => {
    if (!socket || !passwordPrompt) return;
    socket.emit('watch:join', { roomId: passwordPrompt.roomId, password: passwordInput });
  };

  const leaveRoom = () => {
    pushWatchView('rooms');
  };

  const loadSource = () => {
    if (!socket || !roomId || !canControl) return;
    const source = parseSource(sourceInput);
    if (!source) {
      setError(t(language, 'watchRoomNotFound'));
      return;
    }
    socket.emit('watch:setSource', { roomId, source });
    setSourceInput('');
  };

  // Load a link shared in chat directly into the room (from an embed card).
  const playUrlInRoom = (url: string) => {
    if (!socket || !roomId || !canControl) return;
    const source = parseSource(url);
    if (!source) return;
    socket.emit('watch:setSource', { roomId, source });
  };

  const updateControlMode = (mode: ControlMode) => {
    if (!socket || !roomId || !isHost) return;
    // Optimistically reflect the choice so the toggle responds instantly; the
    // server's watch:members broadcast will confirm (or correct) it.
    setRoom((current) => (current && current.id === roomId ? { ...current, controlMode: mode } : current));
    socket.emit('watch:settings', { roomId, controlMode: mode });
  };

  const transferHost = (targetUserId: string) => {
    if (!socket || !roomId || !isHost || targetUserId === currentUser.id) return;
    socket.emit('watch:transferHost', { roomId, userId: targetUserId });
  };

  const sendChat = (body: string, gifUrl?: string) => {
    if (!socket || !roomId) return;
    const text = expandCustomEmojiShortcodes(body.trim());
    if (!text && !gifUrl) return;
    socket.emit('watch:chat', { roomId, body: text, gifUrl });
    setDraft('');
  };

  const copyInvite = async () => {
    if (!room) return;
    const link = buildWatchInviteLink(room.inviteCode);
    try {
      await navigator.clipboard.writeText(link);
      showToast(t(language, 'watchInviteCopied'));
    } catch { /* clipboard may be blocked */ }
  };

  const insertEmoji = (emoji: string) => chatInputRef.current?.insertText(emoji);
  const sendGif = (gif: TenorGif) => {
    sendChat('', gif.url);
    setEmojiOpen(false);
  };

  const sortedLobby = useMemo(
    () => [...lobbyRooms].sort((a, b) => b.memberCount - a.memberCount || b.createdAt - a.createdAt),
    [lobbyRooms]
  );

  return (
    <WindowFrame
      language={language}
      title="Watch Together"
      titleContent={(
        <div className="watch-title-nav">
          <button type="button" className="messenger-title-nav-button" aria-label="Back" disabled={!canGoBack} onClick={() => goWatchHistory(-1)}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <button type="button" className="messenger-title-nav-button" aria-label="Forward" disabled={!canGoForward} onClick={() => goWatchHistory(1)}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
          <button type="button" className="messenger-title-nav-button watch-title-home-button" aria-label={t(language, 'watchMain')} title={t(language, 'watchMain')} disabled={view === 'home'} onClick={() => pushWatchView('home')}>
            <span className="watch-title-home-icon" aria-hidden="true" style={{ WebkitMaskImage: `url("${HOME_ICON}")`, maskImage: `url("${HOME_ICON}")` }} />
          </button>
        </div>
      )}
      centerTitle={<span>Watch Together</span>}
      className="watch-window"
      maximized={maximized}
      minimized={minimized}
      zIndex={zIndex}
      defaultPosition={{ x: 140, y: 80 }}
      minSize={{ width: 900, height: 580 }}
      defaultSize={{ width: 1180, height: 760 }}
      storageKey="watch-together"
      onFocus={onFocus}
      onMinimize={onMinimize}
      onToggleMaximize={onToggleMaximize}
      onClose={onClose}
    >
      {view === 'home' ? (
        <div className="watch-home">
          <div className="watch-create-panel">
            <h3>{t(language, 'watchCreateRoom')}</h3>
            <label className="watch-field">
              <span>{t(language, 'watchRoomName')}</span>
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t(language, 'watchRoomNamePlaceholder')} maxLength={60} />
            </label>
            <div className="watch-visibility">
              <button type="button" className={newPublic ? 'active' : ''} onClick={() => setNewPublic(true)}>{t(language, 'watchRoomPublic')}</button>
              <button type="button" className={!newPublic ? 'active' : ''} onClick={() => setNewPublic(false)}>{t(language, 'watchRoomPrivate')}</button>
            </div>
            <label className="watch-field">
              <span>{t(language, 'watchRoomPassword')}</span>
              <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="••••" maxLength={128} />
            </label>
            <label className="watch-field">
              <span>{t(language, 'watchSearchPlaceholder')}</span>
              <input value={sourceInput} onChange={(e) => setSourceInput(e.target.value)} placeholder="https://youtu.be/..." />
            </label>
            <button type="button" className="primary-action watch-create-btn" onClick={createRoom}>{t(language, 'watchCreateRoom')}</button>
            <button type="button" className="secondary-action watch-room-list-btn" onClick={() => pushWatchView('rooms')}>{t(language, 'watchRoomList')}</button>
            {error ? <p className="watch-error">{error}</p> : null}
          </div>
        </div>
      ) : view === 'rooms' ? (
        <div className="watch-rooms-view">
          <div className="watch-lobby-list">
            <div className="watch-lobby-head">
              <h3>{t(language, 'watchPublicRooms')}</h3>
              <span className="watch-lobby-count">{sortedLobby.length}</span>
            </div>
            <div className="watch-room-cards">
              {sortedLobby.length === 0 ? (
                <p className="watch-empty">{t(language, 'watchNoRooms')}</p>
              ) : (
                sortedLobby.map((r) => (
                  <button key={r.id} type="button" className="watch-room-card" onClick={() => joinRoom(r)}>
                    <div className="watch-room-card-main">
                      <span className="watch-room-card-name">{r.name}</span>
                      <span className="watch-room-card-now">{r.nowPlaying || t(language, 'watchNothingPlaying')}</span>
                    </div>
                    <div className="watch-room-card-meta">
                      <span className={r.locked ? 'watch-badge locked' : 'watch-badge open'}>
                        {r.locked ? t(language, 'watchRoomLocked') : t(language, 'watchRoomOpen')}
                      </span>
                      <span className="watch-badge count">{t(language, 'watchMembers', { count: String(r.memberCount) })}</span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
          {passwordPrompt ? (
            <div className="watch-password-backdrop" onMouseDown={() => setPasswordPrompt(null)}>
              <div className="watch-password-modal" onMouseDown={(e) => e.stopPropagation()}>
                <h4>{passwordPrompt.name}</h4>
                <p>{t(language, 'watchEnterPassword')}</p>
                <input
                  type="password"
                  autoFocus
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') submitPassword(); }}
                />
                {error ? <p className="watch-error">{error}</p> : null}
                <div className="watch-password-actions">
                  <button type="button" onClick={() => { setPasswordPrompt(null); setError(null); }}>{t(language, 'cancel')}</button>
                  <button type="button" className="primary-action" onClick={submitPassword}>{t(language, 'watchJoinRoom')}</button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : view === 'room' && room ? (
        <div className="watch-room">
          <div className="watch-stage">
            <div className="watch-stage-top">
              <button type="button" className="watch-back" onClick={leaveRoom}>← {t(language, 'watchBackToLobby')}</button>
              <input
                className="watch-search"
                value={sourceInput}
                onChange={(e) => setSourceInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') loadSource(); }}
                placeholder={t(language, 'watchSearchPlaceholder')}
                disabled={!canControl}
                title={canControl ? undefined : t(language, 'watchHostOnly')}
              />
              <button type="button" className="primary-action watch-load" onClick={loadSource} disabled={!canControl}>{t(language, 'watchLoadVideo')}</button>
            </div>

            <div className="watch-player">
              {player?.source?.kind === 'youtube' ? (
                // The YouTube IFrame API replaces this div with its own iframe.
                <div className="watch-yt-host"><div ref={ytContainerRef} /></div>
              ) : player?.source?.kind === 'url' ? (
                <video
                  ref={videoRef}
                  src={player.source.value}
                  controls={canControl}
                  onPlay={() => canControl && emitControl(true, videoRef.current?.currentTime ?? 0)}
                  onPause={() => canControl && emitControl(false, videoRef.current?.currentTime ?? 0)}
                  onSeeked={() => canControl && emitControl(!videoRef.current?.paused, videoRef.current?.currentTime ?? 0)}
                />
              ) : player?.source?.kind === 'embed' ? (
                <iframe
                  title="watch-player"
                  src={player.source.value}
                  allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                  allowFullScreen
                />
              ) : (
                <div className="watch-player-empty">{t(language, 'watchNothingPlaying')}</div>
              )}
            </div>

            <div className="watch-stage-bottom">
              <div className="watch-room-title">
                <strong>{room.name}</strong>
                <span>{t(language, 'watchMembers', { count: String(room.members.length) })}</span>
                {isHost ? (
                  <span className="watch-host-tag">{t(language, 'watchYouAreHost')}</span>
                ) : (
                  <span className="watch-host-only">{t(language, canControl ? 'watchEveryoneControls' : 'watchHostOnly')}</span>
                )}
              </div>
              <div className="watch-room-tools">
                <button type="button" onClick={copyInvite}>{t(language, 'watchCopyInvite')}</button>
                <button type="button" className="danger-text" onClick={leaveRoom}>{t(language, 'watchLeaveRoom')}</button>
              </div>
            </div>
          </div>

          <div className="watch-chat">
            <div className={membersCollapsed ? 'watch-sync-panel collapsed' : 'watch-sync-panel'}>
              <div className="watch-sync-head">
                <button
                  type="button"
                  className="watch-sync-toggle"
                  aria-expanded={!membersCollapsed}
                  onClick={() => setMembersCollapsed((c) => !c)}
                >
                  <span className="watch-sync-chevron">{membersCollapsed ? '▸' : '▾'}</span>
                  <span>{t(language, 'watchMembers', { count: String(room.members.length) })}</span>
                </button>
                <div className="watch-sync-head-actions">
                  {isHost ? (
                    <button type="button" className="watch-sync-settings" title={t(language, 'watchSettings')} onClick={() => setSettingsOpen(true)}>⚙</button>
                  ) : null}
                  <button type="button" className="watch-sync-all" onClick={syncToHost}>{t(language, 'watchSync')}</button>
                </div>
              </div>
              <div className="watch-sync-list">
                {(() => {
                  const hostLive = Math.max(0, livePosition(player));
                  // Members sorted with the host first, then by join time.
                  const ordered = [...room.members].sort((a, b) => Number(b.isHost) - Number(a.isHost) || a.joinedAt - b.joinedAt);
                  return ordered.map((m) => {
                    // Prefer the live position broadcast (watch:positions); fall
                    // back to the member's own fields from the members snapshot so
                    // a freshly joined member shows a time before the first report.
                    const pos = memberPositions[m.userId]
                      ?? (m.reportedAt != null
                        ? { userId: m.userId, position: m.position ?? 0, playing: m.playing ?? false, reportedAt: m.reportedAt }
                        : undefined);
                    // Extrapolate a playing member's time since their last report.
                    const memberLive = pos
                      ? (pos.playing ? pos.position + (Date.now() - pos.reportedAt) / 1000 : pos.position)
                      : 0;
                    const drift = Math.abs(memberLive - hostLive);
                    const inSync = m.isHost || drift <= 2;
                    return (
                      <div key={m.userId} className="watch-sync-row">
                        <img className="watch-sync-avatar" src={m.user.avatarData} alt="" />
                        <span className="watch-sync-name" title={m.user.nickname}>
                          {m.user.nickname}
                          {m.isHost ? <span className="watch-sync-host-tag">{t(language, 'watchHost')}</span> : null}
                        </span>
                        <span className={inSync ? 'watch-sync-time ok' : 'watch-sync-time off'}>{formatClock(memberLive)}</span>
                        {isHost && !m.isHost ? (
                          <button
                            type="button"
                            className="watch-sync-btn"
                            title={t(language, 'watchMakeHost')}
                            onClick={() => transferHost(m.userId)}
                          >
                            ★
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="watch-sync-btn"
                          title={t(language, 'watchSync')}
                          onClick={syncToHost}
                          disabled={m.userId !== currentUser.id}
                        >
                          ⟳
                        </button>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
            <div className="watch-chat-thread" ref={chatScrollRef}>
              {chat.map((m) => (
                <div key={m.id} className={m.senderId === currentUser.id ? 'watch-msg own' : 'watch-msg'}>
                  <img className="watch-msg-avatar" src={m.senderAvatar} alt="" />
                  <div className="watch-msg-body">
                    <span className="watch-msg-author">{m.senderNickname}</span>
                    {m.body ? (
                      <WatchChatBody text={m.body} language={language} canControl={canControl} onPlay={playUrlInRoom} />
                    ) : null}
                    {m.gifUrl ? <img className="watch-msg-gif" src={m.gifUrl} alt="gif" /> : null}
                  </div>
                </div>
              ))}
            </div>
            <form
              className="watch-chat-composer"
              onSubmit={(e) => { e.preventDefault(); sendChat(draft); }}
            >
              <EmojiInlineInput
                ref={chatInputRef}
                className="emoji-inline-input watch-chat-input"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={t(language, 'watchChatPlaceholder')}
                previewSize={17}
              />
              <div ref={emojiAnchorRef} className="emoji-host inline">
                <button
                  type="button"
                  className="emoji-toggle inline chat-gif-toggle"
                  aria-label="GIF"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (emojiOpen && pickerTab === 'gif') setEmojiOpen(false);
                    else { setPickerTab('gif'); setEmojiOpen(true); }
                  }}
                >
                  <GifIcon />
                </button>
                <button
                  type="button"
                  className="emoji-toggle inline"
                  aria-label={t(language, 'emoji')}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (emojiOpen && pickerTab === 'emoji') setEmojiOpen(false);
                    else { setPickerTab('emoji'); setEmojiOpen(true); }
                  }}
                >
                  <EmojiToggleIcon />
                </button>
                {emojiOpen ? (
                  <EmojiPicker
                    language={language}
                    enlarged
                    initialTab={pickerTab}
                    anchorRef={emojiAnchorRef}
                    placement="top-end"
                    onSelect={insertEmoji}
                    onSelectGif={sendGif}
                    onClose={() => setEmojiOpen(false)}
                    token={token}
                    currentUser={currentUser}
                  />
                ) : null}
              </div>
            </form>
          </div>

          {settingsOpen && isHost ? (
            <div className="watch-password-backdrop" onMouseDown={() => setSettingsOpen(false)}>
              <div className="watch-settings-modal" onMouseDown={(e) => e.stopPropagation()}>
                <h4>{t(language, 'watchSettings')}</h4>
                <p className="watch-settings-label">{t(language, 'watchControlPermission')}</p>
                <div className="watch-control-options">
                  <button
                    type="button"
                    className={controlMode === 'host' ? 'active' : ''}
                    onClick={() => updateControlMode('host')}
                  >
                    <strong>{t(language, 'watchControlHost')}</strong>
                    <span>{t(language, 'watchControlHostHint')}</span>
                  </button>
                  <button
                    type="button"
                    className={controlMode === 'everyone' ? 'active' : ''}
                    onClick={() => updateControlMode('everyone')}
                  >
                    <strong>{t(language, 'watchControlEveryone')}</strong>
                    <span>{t(language, 'watchControlEveryoneHint')}</span>
                  </button>
                </div>
                <p className="watch-settings-label">{t(language, 'watchTransferHostHint')}</p>
                <div className="watch-settings-actions">
                  <button type="button" className="primary-action" onClick={() => setSettingsOpen(false)}>{t(language, 'watchDone')}</button>
                </div>
              </div>
            </div>
          ) : null}

          {toast ? <div className="watch-toast">{toast}</div> : null}
        </div>
      ) : null}
    </WindowFrame>
  );
}
