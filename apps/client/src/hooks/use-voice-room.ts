import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { PublicUser, VoiceChatMessage, VoiceParticipant } from '../api/types';
import { applyCallAudioConstraints, audioConstraintsFromCallSettings, loadCallSettings, type CallSettings } from '../utils/call-settings';
import { createRnnoiseNode, destroyRnnoiseNode, setRnnoiseEnabled } from '../utils/rnnoise';
import { loadUserStatus, patchVoiceState, STATUS_CHANGED_EVENT, type UserStatusState } from '../utils/user-status';
import { playPttSound } from '../utils/ptt-sound';
import type { ScreenSource } from './use-voice-call';

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
];

const TALK_THRESHOLD = 0.02;

export type VoiceRoomState = {
  activeChannelId: string | null;
  participants: VoiceParticipant[];
  remoteStreams: Map<string, MediaStream>; // userId -> audio stream
  remoteVideo: Map<string, MediaStream>; // userId -> screen-share stream
  chat: VoiceChatMessage[];
  muted: boolean;
  deafened: boolean;
  sharingScreen: boolean;
  localScreenStream: MediaStream | null;
  joining: boolean;
  error: string;
};

type PeerEntry = {
  pc: RTCPeerConnection;
  polite: boolean;
  audioSenderAdded: boolean;
  screenSender: RTCRtpSender | null;
  cameraSender: RTCRtpSender | null;
};

type UseVoiceRoomArgs = {
  socket: Socket | null;
  currentUser: PublicUser;
};

export type VoiceRoom = ReturnType<typeof useVoiceRoom>;

export function useVoiceRoom({ socket, currentUser }: UseVoiceRoomArgs) {
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<VoiceParticipant[]>([]);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  const [remoteVideo, setRemoteVideo] = useState<Map<string, MediaStream>>(new Map());
  const [remoteCameras, setRemoteCameras] = useState<Map<string, MediaStream>>(new Map());
  const [chat, setChat] = useState<VoiceChatMessage[]>([]);
  const [muted, setMuted] = useState(() => loadUserStatus().voice.muted);
  const [deafened, setDeafened] = useState(() => loadUserStatus().voice.deafened);
  const [sharingScreen, setSharingScreen] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [localScreenStream, setLocalScreenStream] = useState<MediaStream | null>(null);
  const [localCameraStream, setLocalCameraStream] = useState<MediaStream | null>(null);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');
  const [talkingIds, setTalkingIds] = useState<Set<string>>(new Set());
  const [screenSources, setScreenSources] = useState<ScreenSource[] | null>(null);
  const [settingsVersion, setSettingsVersion] = useState(0);

  const socketRef = useRef<Socket | null>(null);
  const channelRef = useRef<string | null>(null);
  const peersRef = useRef<Map<string, PeerEntry>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const rawMicStreamRef = useRef<MediaStream | null>(null);
  const rawMicTrackRef = useRef<MediaStreamTrack | null>(null);
  const micTrackRef = useRef<MediaStreamTrack | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const rnnoiseNodeRef = useRef<AudioWorkletNode | null>(null);
  const talkingRafRef = useRef<number | null>(null);
  const settingsRef = useRef<CallSettings>(loadCallSettings());
  const mutedRef = useRef(false);
  const deafenedRef = useRef(false);
  const pttActiveRef = useRef(false);
  const bitrateRef = useRef(64000);
  const streamEnabledRef = useRef(true);
  const videoQualityRef = useRef<'auto' | '720' | '1080'>('auto');
  const participantsRef = useRef<VoiceParticipant[]>([]);

  socketRef.current = socket;
  channelRef.current = activeChannelId;
  mutedRef.current = muted;
  deafenedRef.current = deafened;
  participantsRef.current = participants;

  const setMicEnabled = (enabled: boolean) => {
    if (micTrackRef.current) micTrackRef.current.enabled = enabled;
    // When transmitting, make sure the processing AudioContext is running. It
    // can get suspended while the window is minimized/backgrounded (e.g. when a
    // game is focused), which would otherwise silence push-to-talk audio.
    if (enabled && audioCtxRef.current?.state === 'suspended') {
      void audioCtxRef.current.resume().catch(() => undefined);
    }
  };

  function applyMicVolume() {
    const gain = gainRef.current;
    if (gain) gain.gain.value = Math.max(0, settingsRef.current.micVolume / 100);
  }

  function syncVoiceStateFromStore() {
    const persisted = loadUserStatus().voice;
    const effectiveMuted = persisted.muted || persisted.deafened;
    setMuted(effectiveMuted);
    setDeafened(persisted.deafened);
    mutedRef.current = effectiveMuted;
    deafenedRef.current = persisted.deafened;
    return { muted: effectiveMuted, deafened: persisted.deafened };
  }

  // Re-read the saved call settings and apply them to the live room (mic gain,
  // push-to-talk, mute). Output volume is applied by the audio sink.
  const refreshSettings = useCallback(() => {
    settingsRef.current = loadCallSettings();
    setSettingsVersion((v) => v + 1);
    void applyCallAudioConstraints(rawMicTrackRef.current, settingsRef.current);
    setRnnoiseEnabled(rnnoiseNodeRef.current, settingsRef.current.noiseSuppression);
    applyMicVolume();
    if (settingsRef.current.pushToTalk) {
      setMicEnabled(pttActiveRef.current && !mutedRef.current);
    } else {
      setMicEnabled(!mutedRef.current);
    }
  }, []);

  const buildLocalAudio = useCallback(async (): Promise<MediaStream> => {
    const s = settingsRef.current;
    const raw = await navigator.mediaDevices.getUserMedia({
      audio: audioConstraintsFromCallSettings(s),
      video: false
    });
    rawMicStreamRef.current = raw;
    rawMicTrackRef.current = raw.getAudioTracks()[0] ?? null;
    const ctx = new AudioContext({ sampleRate: 48000 });
    audioCtxRef.current = ctx;
    const source = ctx.createMediaStreamSource(raw);
    const gain = ctx.createGain();
    gainRef.current = gain;
    applyMicVolume();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyserRef.current = analyser;
    const dest = ctx.createMediaStreamDestination();
    const rnnoiseNode = await createRnnoiseNode(ctx, s.noiseSuppression);
    rnnoiseNodeRef.current = rnnoiseNode;
    source.connect(gain);
    if (rnnoiseNode) {
      gain.connect(rnnoiseNode);
      rnnoiseNode.connect(analyser);
    } else {
      gain.connect(analyser);
    }
    analyser.connect(dest);
    const processed = dest.stream;
    micTrackRef.current = processed.getAudioTracks()[0] ?? null;
    localStreamRef.current = processed;
    // In push-to-talk mode the mic starts disabled until the key is held.
    if (s.pushToTalk) setMicEnabled(false);
    else setMicEnabled(!mutedRef.current);
    startTalkingDetection();
    return processed;
  }, []);

  function startTalkingDetection() {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const data = new Uint8Array(analyser.fftSize);
    let last = false;
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i += 1) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / data.length);
      const talking = (micTrackRef.current?.enabled ?? false) && rms > TALK_THRESHOLD;
      if (talking !== last) {
        last = talking;
        setTalkingIds((prev) => {
          const next = new Set(prev);
          if (talking) next.add(currentUser.id);
          else next.delete(currentUser.id);
          return next;
        });
        socketRef.current?.emit('voice:state', { channelId: channelRef.current, talking });
      }
      talkingRafRef.current = requestAnimationFrame(tick);
    };
    talkingRafRef.current = requestAnimationFrame(tick);
  }

  function createPeer(peerId: string, polite: boolean): PeerEntry {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const entry: PeerEntry = { pc, polite, audioSenderAdded: false, screenSender: null, cameraSender: null };
    peersRef.current.set(peerId, entry);

    // Add our local audio.
    const local = localStreamRef.current;
    if (local) {
      local.getAudioTracks().forEach((track) => pc.addTrack(track, local));
      entry.audioSenderAdded = true;
      for (const sender of pc.getSenders()) {
        if (sender.track?.kind !== 'audio') continue;
        const params = sender.getParameters();
        if (!params.encodings?.length) params.encodings = [{}];
        params.encodings[0].maxBitrate = bitrateRef.current;
        void sender.setParameters(params).catch(() => undefined);
      }
    }
    // Always offer video receive slots so joining a room with active video shows
    // the existing video without waiting for the sender to reconnect.
    try { pc.addTransceiver('video', { direction: 'recvonly' }); } catch { /* ignore */ }
    try { pc.addTransceiver('video', { direction: 'recvonly' }); } catch { /* ignore */ }
    // Re-attach an ongoing screen share to the new peer.
    if (screenStreamRef.current) {
      const vt = screenStreamRef.current.getVideoTracks()[0];
      if (vt) entry.screenSender = pc.addTrack(vt, screenStreamRef.current);
    }
    // Re-attach an ongoing camera stream to the new peer.
    if (cameraStreamRef.current) {
      const ct = cameraStreamRef.current.getVideoTracks()[0];
      if (ct) entry.cameraSender = pc.addTrack(ct, cameraStreamRef.current);
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socketRef.current?.emit('voice:signal', { channelId: channelRef.current, targetId: peerId, data: { type: 'ice', candidate: event.candidate } });
      }
    };

    pc.ontrack = (event) => {
      const [stream] = event.streams;
      if (event.track.kind === 'audio') {
        setRemoteStreams((prev) => {
          const next = new Map(prev);
          next.set(peerId, stream);
          return next;
        });
      } else if (event.track.kind === 'video') {
        const p = participantsRef.current.find((x) => x.userId === peerId);
        const isCamera =
          (p?.cameraStreamId && stream.id === p.cameraStreamId) ||
          (p?.camera && !p?.screen) ||
          (!event.track.getSettings?.().displaySurface && p?.camera);

        if (isCamera) {
          setRemoteCameras((prev) => {
            const next = new Map(prev);
            next.set(peerId, stream);
            return next;
          });
          event.track.onended = () => {
            setRemoteCameras((prev) => {
              const next = new Map(prev);
              next.delete(peerId);
              return next;
            });
          };
        } else {
          setRemoteVideo((prev) => {
            const next = new Map(prev);
            next.set(peerId, stream);
            return next;
          });
          event.track.onended = () => {
            setRemoteVideo((prev) => {
              const next = new Map(prev);
              next.delete(peerId);
              return next;
            });
          };
        }
      }
    };

    pc.onnegotiationneeded = async () => {
      // Only the polite peer makes offers to avoid glare in the mesh.
      if (!entry.polite) return;
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socketRef.current?.emit('voice:signal', { channelId: channelRef.current, targetId: peerId, data: { type: 'offer', sdp: pc.localDescription } });
      } catch {
        /* ignore */
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        // Leave teardown to signaling (voice:peerLeft).
      }
    };

    return entry;
  }

  async function negotiateWithPeer(peerId: string) {
    const entry = peersRef.current.get(peerId);
    if (!entry) return;
    try {
      const offer = await entry.pc.createOffer();
      await entry.pc.setLocalDescription(offer);
      socketRef.current?.emit('voice:signal', {
        channelId: channelRef.current,
        targetId: peerId,
        data: { type: 'offer', sdp: entry.pc.localDescription }
      });
    } catch {
      /* ignore */
    }
  }

  function destroyPeer(peerId: string) {
    const entry = peersRef.current.get(peerId);
    if (entry) {
      try { entry.pc.close(); } catch { /* ignore */ }
      peersRef.current.delete(peerId);
    }
    setRemoteStreams((prev) => { const n = new Map(prev); n.delete(peerId); return n; });
    setRemoteVideo((prev) => { const n = new Map(prev); n.delete(peerId); return n; });
    setRemoteCameras((prev) => { const n = new Map(prev); n.delete(peerId); return n; });
  }

  function cleanupLocal() {
    if (talkingRafRef.current) cancelAnimationFrame(talkingRafRef.current);
    talkingRafRef.current = null;
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    rawMicStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    cameraStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    rawMicStreamRef.current = null;
    rawMicTrackRef.current = null;
    screenStreamRef.current = null;
    cameraStreamRef.current = null;
    micTrackRef.current = null;
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => undefined);
      audioCtxRef.current = null;
    }
    destroyRnnoiseNode(rnnoiseNodeRef.current);
    rnnoiseNodeRef.current = null;
    gainRef.current = null;
    analyserRef.current = null;
  }

  const leave = useCallback(() => {
    const channelId = channelRef.current;
    if (channelId) socketRef.current?.emit('voice:leave', { channelId });
    peersRef.current.forEach((_entry, peerId) => destroyPeer(peerId));
    peersRef.current.clear();
    cleanupLocal();
    // Optimistically drop ourselves from the left channel's cached list so the
    // x/N badge updates instantly instead of waiting for the server snapshot.
    if (channelId) {
      const cached = channelParticipantsRef.current.get(channelId);
      if (cached) {
      const next = cached.filter((p) => p.userId !== currentUser.id);
        if (next.length > 0) channelParticipantsRef.current.set(channelId, next);
        else channelParticipantsRef.current.delete(channelId);
        setChannelParticipants(new Map(channelParticipantsRef.current));
      }
    }
    // Clear the live ref immediately so any in-flight signaling/state events for
    // the old channel are ignored before the next render syncs the ref.
    channelRef.current = null;
    setActiveChannelId(null);
    setParticipants([]);
    setRemoteStreams(new Map());
    setRemoteVideo(new Map());
    setRemoteCameras(new Map());
    setChat([]);
    syncVoiceStateFromStore();
    setSharingScreen(false);
    setCameraActive(false);
    setLocalScreenStream(null);
    setLocalCameraStream(null);
    setTalkingIds(new Set());
    setError('');
  }, [currentUser]);

  const join = useCallback(async (channelId: string, options?: { bitrate?: number; voiceMode?: 'voice_activity' | 'ptt'; streamEnabled?: boolean; videoQuality?: 'auto' | '720' | '1080' }) => {
    if (!socketRef.current) return;
    if (channelRef.current === channelId) return;
    // Leave any current room first.
    if (channelRef.current) leave();
    setJoining(true);
    setError('');
    bitrateRef.current = Math.max(8000, Math.min(384000, options?.bitrate ?? 64000));
    streamEnabledRef.current = options?.streamEnabled !== false;
    videoQualityRef.current = options?.videoQuality ?? 'auto';
    settingsRef.current = loadCallSettings();
    if (options?.voiceMode === 'ptt') settingsRef.current = { ...settingsRef.current, pushToTalk: true };
    setSettingsVersion((v) => v + 1);
    syncVoiceStateFromStore();
    try {
      await buildLocalAudio();
      channelRef.current = channelId;
      setActiveChannelId(channelId);
      // Optimistically add ourselves to the participant list so we appear in
      // the channel immediately, without waiting for the server's
      // `voice:participants` round-trip. The server snapshot replaces this list
      // once it arrives (and will include the authoritative self entry).
      const selfParticipant: VoiceParticipant = {
        userId: currentUser.id,
        user: currentUser,
        muted: mutedRef.current,
        deafened: deafenedRef.current,
        screen: false,
        talking: false,
        joinedAt: Date.now()
      };
      const existing = channelParticipantsRef.current.get(channelId) ?? [];
      const merged = existing.some((p) => p.userId === currentUser.id)
        ? existing
        : [...existing, selfParticipant];
      setParticipantsForChannel(channelId, merged);
      socketRef.current.emit('voice:join', { channelId, muted: mutedRef.current, deafened: deafenedRef.current });
    } catch {
      setError('micFailed');
      cleanupLocal();
      channelRef.current = null;
      setActiveChannelId(null);
    } finally {
      setJoining(false);
    }
  }, [buildLocalAudio, leave, currentUser]);

  const applyVoiceState = useCallback((nextMuted: boolean, nextDeafened: boolean, fromStore = false) => {
    const effectiveMuted = nextMuted || nextDeafened;
    setMuted(effectiveMuted);
    setDeafened(nextDeafened);
    mutedRef.current = effectiveMuted;
    deafenedRef.current = nextDeafened;

    if (effectiveMuted) {
      pttActiveRef.current = false;
      setMicEnabled(false);
    } else if (settingsRef.current.pushToTalk) {
      setMicEnabled(pttActiveRef.current);
    } else {
      setMicEnabled(true);
    }

    if (channelRef.current) socketRef.current?.emit('voice:state', { channelId: channelRef.current, muted: effectiveMuted, deafened: nextDeafened });
    if (!fromStore) patchVoiceState({ muted: effectiveMuted, deafened: nextDeafened });
  }, []);

  const toggleMute = useCallback(() => {
    const nextMuted = !muted;
    const nextDeafened = nextMuted ? deafened : false;
    applyVoiceState(nextMuted, nextDeafened);
  }, [applyVoiceState, deafened, muted]);

  const toggleDeafen = useCallback(() => {
    const nextDeafened = !deafened;
    const nextMuted = nextDeafened ? true : false;
    applyVoiceState(nextMuted, nextDeafened);
  }, [applyVoiceState, deafened]);

  const stopScreenShare = useCallback(async () => {
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current = null;
    peersRef.current.forEach((entry) => {
      if (entry.screenSender) {
        try { entry.pc.removeTrack(entry.screenSender); } catch { /* ignore */ }
        entry.screenSender = null;
      }
    });
    setLocalScreenStream(null);
    setSharingScreen(false);
    socketRef.current?.emit('voice:state', { channelId: channelRef.current, screen: false });
  }, []);

  const startScreenShare = useCallback(async (sourceId?: string) => {
    if (!streamEnabledRef.current) {
      setError('STREAM_DISABLED');
      return;
    }
    setScreenSources(null);
    try {
      let display: MediaStream;
      if (sourceId && window.notoc?.selectScreenSource) {
        // Electron: register the chosen window/screen, then capture it.
        await window.notoc.selectScreenSource(sourceId);
        display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      } else {
        display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      }
      screenStreamRef.current = display;
      const track = display.getVideoTracks()[0];
      if (videoQualityRef.current === '720') void track.applyConstraints({ height: { ideal: 720 } }).catch(() => undefined);
      if (videoQualityRef.current === '1080') void track.applyConstraints({ height: { ideal: 1080 } }).catch(() => undefined);
      track.onended = () => { void stopScreenShare(); };
      peersRef.current.forEach((entry, peerId) => {
        entry.screenSender = entry.pc.addTrack(track, display);
        void negotiateWithPeer(peerId);
      });
      setLocalScreenStream(display);
      setSharingScreen(true);
      socketRef.current?.emit('voice:state', { channelId: channelRef.current, screen: true, screenStreamId: display.id });
    } catch {
      setError('screenFailed');
    }
  }, [stopScreenShare]);

  // Opens the Electron source picker (choose which window/screen to share) or
  // starts the browser flow directly. Toggling off stops the current share.
  const requestScreenShare = useCallback(async () => {
    if (screenStreamRef.current) {
      void stopScreenShare();
      return;
    }
    const native = window.notoc?.getScreenSources;
    if (native) {
      try {
        const sources = await native();
        setScreenSources(sources);
      } catch {
        setError('screenFailed');
      }
    } else {
      void startScreenShare();
    }
  }, [startScreenShare, stopScreenShare]);

  const cancelScreenPicker = useCallback(() => setScreenSources(null), []);

  const stopCamera = useCallback(() => {
    cameraStreamRef.current?.getTracks().forEach((t) => t.stop());
    cameraStreamRef.current = null;
    peersRef.current.forEach((entry, peerId) => {
      if (entry.cameraSender) {
        try { entry.pc.removeTrack(entry.cameraSender); } catch { /* ignore */ }
        entry.cameraSender = null;
        void negotiateWithPeer(peerId);
      }
    });
    setLocalCameraStream(null);
    setCameraActive(false);
    socketRef.current?.emit('voice:state', { channelId: channelRef.current, camera: false });
  }, []);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        audio: false
      });
      cameraStreamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      if (!track) return;
      track.onended = () => { stopCamera(); };
      peersRef.current.forEach((entry, peerId) => {
        try {
          entry.cameraSender = entry.pc.addTrack(track, stream);
          void negotiateWithPeer(peerId);
        } catch { /* ignore */ }
      });
      setLocalCameraStream(stream);
      setCameraActive(true);
      socketRef.current?.emit('voice:state', { channelId: channelRef.current, camera: true, cameraStreamId: stream.id });
    } catch {
      setError('cameraFailed');
    }
  }, [stopCamera]);

  const toggleCamera = useCallback(async () => {
    if (cameraActive) {
      stopCamera();
    } else {
      await startCamera();
    }
  }, [cameraActive, startCamera, stopCamera]);

  const sendChat = useCallback((body: string) => {
    const text = body.trim();
    if (!text || !channelRef.current) return;
    socketRef.current?.emit('voice:chat', { channelId: channelRef.current, body: text });
  }, []);

  const deleteChat = useCallback((messageId: string) => {
    if (!channelRef.current) return;
    socketRef.current?.emit('voice:chatDelete', { channelId: channelRef.current, messageId });
  }, []);

  const editChat = useCallback((messageId: string, body: string) => {
    const text = body.trim();
    if (!text || !channelRef.current) return;
    socketRef.current?.emit('voice:chatEdit', { channelId: channelRef.current, messageId, body: text });
  }, []);

  // --- Signaling wiring ---
  useEffect(() => {
    if (!socket) return;

    const onJoined = async (payload: { channelId: string; peers: VoiceParticipant[]; chat: VoiceChatMessage[] }) => {
      if (payload.channelId !== channelRef.current) return;
      setChat(payload.chat ?? []);
      // We are the new joiner: be the polite peer that offers to each existing peer.
      for (const peer of payload.peers) {
        if (peer.userId === currentUser.id) continue;
        if (!peersRef.current.has(peer.userId)) createPeer(peer.userId, true);
        void negotiateWithPeer(peer.userId);
      }
    };

    const onPeerJoined = (payload: { channelId: string; userId: string; user: PublicUser }) => {
      if (payload.channelId !== channelRef.current) return;
      if (payload.userId === currentUser.id) return;
      // Existing peer: impolite side, waits for the newcomer's offer.
      if (!peersRef.current.has(payload.userId)) createPeer(payload.userId, false);
      // If we are currently sharing our screen, the newcomer's polite offer will
      // include only a recvonly video transceiver; our side won't auto-renegotiate
      // If we are currently sharing our screen or camera, the newcomer's polite offer will
      // include only recvonly video transceivers; our side won't auto-renegotiate
      // because our track list didn't change. Force an offer so the new joiner
      // actually receives the ongoing video streams.
      if (screenStreamRef.current || cameraStreamRef.current) {
        // Small delay so the polite peer finishes its initial offer first.
        window.setTimeout(() => { void negotiateWithPeer(payload.userId); }, 400);
      }
    };

    const onPeerLeft = (payload: { channelId: string; userId: string }) => {
      if (payload.channelId !== channelRef.current) return;
      destroyPeer(payload.userId);
    };

    const onSignal = async (payload: { channelId: string; from: string; data: { type: string; sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit } }) => {
      if (payload.channelId !== channelRef.current) return;
      let entry = peersRef.current.get(payload.from);
      if (!entry) entry = createPeer(payload.from, false);
      const pc = entry.pc;
      const { data } = payload;
      try {
        if (data.type === 'offer' && data.sdp) {
          await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socketRef.current?.emit('voice:signal', { channelId: payload.channelId, targetId: payload.from, data: { type: 'answer', sdp: pc.localDescription } });
        } else if (data.type === 'answer' && data.sdp) {
          await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        } else if (data.type === 'ice' && data.candidate) {
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
      } catch {
        /* ignore malformed signaling */
      }
    };

    const onParticipants = (payload: { channelId: string; participants: VoiceParticipant[] }) => {
      // Keep the participant list for whichever channel this is (used for x/N
      // badges across the group, not only the active room).
      setParticipantsForChannel(payload.channelId, payload.participants);
    };

    const onState = (payload: { channelId: string; userId: string; muted: boolean; deafened?: boolean; screen: boolean; camera?: boolean; cameraStreamId?: string; screenStreamId?: string; talking: boolean }) => {
      setParticipants((prev) => prev.map((p) => p.userId === payload.userId && payload.channelId === channelRef.current
        ? { ...p, muted: payload.muted, deafened: payload.deafened, screen: payload.screen, camera: payload.camera, cameraStreamId: payload.cameraStreamId, screenStreamId: payload.screenStreamId, talking: payload.talking }
        : p));
      if (!payload.camera) {
        setRemoteCameras((prev) => {
          if (!prev.has(payload.userId)) return prev;
          const next = new Map(prev);
          next.delete(payload.userId);
          return next;
        });
      }
      if (!payload.screen) {
        setRemoteVideo((prev) => {
          if (!prev.has(payload.userId)) return prev;
          const next = new Map(prev);
          next.delete(payload.userId);
          return next;
        });
      }
      // Also sync the per-channel cached list so the left voice-channel list
      // updates mic/screen icons in real time for every group member.
      const cached = channelParticipantsRef.current.get(payload.channelId);
      if (cached && cached.some((p) => p.userId === payload.userId)) {
        const next = cached.map((p) => p.userId === payload.userId
          ? { ...p, muted: payload.muted, deafened: payload.deafened, screen: payload.screen, camera: payload.camera, talking: payload.talking }
          : p);
        channelParticipantsRef.current.set(payload.channelId, next);
        setChannelParticipants(new Map(channelParticipantsRef.current));
      }
      setTalkingIds((prev) => {
        if (payload.channelId !== channelRef.current) return prev;
        const next = new Set(prev);
        if (payload.talking) next.add(payload.userId);
        else next.delete(payload.userId);
        return next;
      });
    };

    const onChatMessage = (payload: { message: VoiceChatMessage }) => {
      if (payload.message.channelId !== channelRef.current) return;
      setChat((prev) => (prev.some((m) => m.id === payload.message.id) ? prev : [...prev, payload.message]));
    };

    const onChatCleared = (payload: { channelId: string }) => {
      if (payload.channelId === channelRef.current) setChat([]);
    };

    const onChatDeleted = (payload: { channelId: string; messageId: string }) => {
      if (payload.channelId !== channelRef.current) return;
      setChat((prev) => prev.filter((m) => m.id !== payload.messageId));
    };

    const onChatEdited = (payload: { channelId: string; messageId: string; body: string }) => {
      if (payload.channelId !== channelRef.current) return;
      setChat((prev) => prev.map((m) => (m.id === payload.messageId ? { ...m, body: payload.body } : m)));
    };

    const onError = (payload: { channelId: string; code: string }) => {
      if (payload.code === 'ROOM_FULL') setError('roomFull');
      else setError(payload.code);
      // If the join failed, tear down our half-built local state.
      if (payload.channelId === channelRef.current) {
        cleanupLocal();
        channelRef.current = null;
        setActiveChannelId(null);
      }
    };

    socket.on('voice:joined', onJoined);
    socket.on('voice:peerJoined', onPeerJoined);
    socket.on('voice:peerLeft', onPeerLeft);
    socket.on('voice:signal', onSignal);
    socket.on('voice:participants', onParticipants);
    socket.on('voice:state', onState);
    socket.on('voice:chatMessage', onChatMessage);
    socket.on('voice:chatCleared', onChatCleared);
    socket.on('voice:chatDeleted', onChatDeleted);
    socket.on('voice:chatEdited', onChatEdited);
    socket.on('voice:error', onError);

    return () => {
      socket.off('voice:joined', onJoined);
      socket.off('voice:peerJoined', onPeerJoined);
      socket.off('voice:peerLeft', onPeerLeft);
      socket.off('voice:signal', onSignal);
      socket.off('voice:participants', onParticipants);
      socket.off('voice:state', onState);
      socket.off('voice:chatMessage', onChatMessage);
      socket.off('voice:chatCleared', onChatCleared);
      socket.off('voice:chatDeleted', onChatDeleted);
      socket.off('voice:chatEdited', onChatEdited);
      socket.off('voice:error', onError);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, currentUser.id]);

  // Per-channel participant lists so other channels' x/N badges stay current.
  const channelParticipantsRef = useRef<Map<string, VoiceParticipant[]>>(new Map());
  const [channelParticipants, setChannelParticipants] = useState<Map<string, VoiceParticipant[]>>(new Map());

  function setParticipantsForChannel(channelId: string, list: VoiceParticipant[]) {
    channelParticipantsRef.current.set(channelId, list);
    setChannelParticipants(new Map(channelParticipantsRef.current));
    if (channelId === channelRef.current) setParticipants(list);
  }

  // Ask the server for the current occupancy of all voice channels in a group.
  // Used when opening a group so participants/badges show before you join.
  //
  // We first drop the cached participant lists for every channel except the one
  // we are actively connected to. Without this, switching from group A to group
  // B briefly shows A's voice rooms (and their members) in B's channel list
  // until the server's fresh snapshot arrives ~1-2s later. Clearing up front
  // makes the stale rooms disappear immediately; the server response then
  // repopulates only the rooms that are actually occupied in the new group.
  const requestGroupRooms = useCallback((groupId: string) => {
    const active = channelRef.current;
    const next = new Map<string, VoiceParticipant[]>();
    if (active) {
      const current = channelParticipantsRef.current.get(active);
      if (current) next.set(active, current);
    }
    channelParticipantsRef.current = next;
    setChannelParticipants(new Map(next));
    socketRef.current?.emit('voice:requestRooms', { groupId });
  }, []);

  // Push-to-talk: hold the configured key to transmit while connected.
  useEffect(() => {
    if (!activeChannelId) return;
    const currentSettings = settingsRef.current;
    if (!currentSettings.pushToTalk) {
      pttActiveRef.current = false;
      if (!mutedRef.current) setMicEnabled(true);
      return;
    }

    const key = currentSettings.pushToTalkKey || 'Space';
    let windowHeld = false;
    let globalHeld = false;

    const syncMic = (playSound = false) => {
      if (mutedRef.current || deafenedRef.current) {
        pttActiveRef.current = false;
        setMicEnabled(false);
        return;
      }
      const active = windowHeld || globalHeld;
      const prev = pttActiveRef.current;
      pttActiveRef.current = active;
      setMicEnabled(active);
      if (playSound && prev !== active) {
        playPttSound(active);
      }
    };

    // When PTT is active, mic starts muted until key is held
    syncMic(false);

    const isTargetInput = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
    };

    const isAlt = (code: string) => code === 'Alt' || code === 'AltLeft' || code === 'AltRight';
    const isCtrl = (code: string) => code === 'Control' || code === 'Ctrl' || code === 'ControlLeft' || code === 'ControlRight';
    const isShift = (code: string) => code === 'Shift' || code === 'ShiftLeft' || code === 'ShiftRight';

    const isMatch = (eventCode: string) => {
      if (eventCode === key) return true;
      if (isAlt(key) && isAlt(eventCode)) return true;
      if (isCtrl(key) && isCtrl(eventCode)) return true;
      if (isShift(key) && isShift(eventCode)) return true;
      return false;
    };

    const down = (event: KeyboardEvent) => {
      if (mutedRef.current || deafenedRef.current) return;
      if (!isMatch(event.code)) return;
      if (isTargetInput(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) return;
      if (!windowHeld) {
        windowHeld = true;
        syncMic(true);
      }
    };

    const up = (event: KeyboardEvent) => {
      if (!isMatch(event.code)) return;
      event.preventDefault();
      event.stopPropagation();
      if (windowHeld) {
        windowHeld = false;
        syncMic(true);
      }
    };

    const onBlur = () => {
      if (windowHeld) {
        windowHeld = false;
        syncMic(true);
      }
    };

    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    window.addEventListener('blur', onBlur);

    // Mouse buttons support (Mouse3, Mouse4, Mouse5)
    let mouseDown: ((event: MouseEvent) => void) | undefined;
    let mouseUp: ((event: MouseEvent) => void) | undefined;
    if (key.startsWith('Mouse')) {
      const targetBtn = key === 'Mouse3' ? 1 : key === 'Mouse4' ? 3 : key === 'Mouse5' ? 4 : -1;
      if (targetBtn !== -1) {
        mouseDown = (event: MouseEvent) => {
          if (mutedRef.current || deafenedRef.current) return;
          if (event.button === targetBtn) {
            windowHeld = true;
            syncMic(true);
          }
        };
        mouseUp = (event: MouseEvent) => {
          if (event.button === targetBtn) {
            windowHeld = false;
            syncMic(true);
          }
        };
        window.addEventListener('mousedown', mouseDown, true);
        window.addEventListener('mouseup', mouseUp, true);
      }
    }

    // Background push-to-talk: register a system-wide hotkey through Electron if available
    let unregisterDown: (() => void) | undefined;
    let unregisterUp: (() => void) | undefined;
    const native = window.notoc;
    if (native?.registerPushToTalk) {
      void native.registerPushToTalk(key);
      unregisterDown = native.onPushToTalkDown?.(() => {
        if (mutedRef.current || deafenedRef.current) return;
        globalHeld = true;
        syncMic(true);
      });
      unregisterUp = native.onPushToTalkUp?.(() => {
        globalHeld = false;
        syncMic(true);
      });
    }

    return () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
      window.removeEventListener('blur', onBlur);
      if (mouseDown) window.removeEventListener('mousedown', mouseDown, true);
      if (mouseUp) window.removeEventListener('mouseup', mouseUp, true);
      unregisterDown?.();
      unregisterUp?.();
      void window.notoc?.unregisterPushToTalk?.();
      pttActiveRef.current = false;
    };
  }, [activeChannelId, settingsVersion]);

  // Apply saved settings live when the user edits them while connected.
  useEffect(() => {
    const handler = () => refreshSettings();
    window.addEventListener('notoc:callSettingsChanged', handler);
    return () => window.removeEventListener('notoc:callSettingsChanged', handler);
  }, [refreshSettings]);

  useEffect(() => {
    const onStatusChange = (event: Event) => {
      const detail = (event as CustomEvent<UserStatusState>).detail;
      if (!detail) return;
      if (detail.voice.muted === mutedRef.current && detail.voice.deafened === deafenedRef.current) return;
      applyVoiceState(detail.voice.muted, detail.voice.deafened, true);
    };
    window.addEventListener(STATUS_CHANGED_EVENT, onStatusChange as EventListener);
    return () => window.removeEventListener(STATUS_CHANGED_EVENT, onStatusChange as EventListener);
  }, [applyVoiceState]);

  useEffect(() => () => leave(), [leave]);

  return {
    activeChannelId,
    participants,
    channelParticipants,
    remoteStreams,
    remoteVideo,
    chat,
    muted,
    deafened,
    sharingScreen,
    cameraActive,
    localScreenStream,
    localCameraStream,
    remoteCameras,
    joining,
    error,
    talkingIds,
    screenSources,
    join,
    leave,
    toggleMute,
    toggleDeafen,
    startScreenShare,
    stopScreenShare,
    requestScreenShare,
    startCamera,
    stopCamera,
    toggleCamera,
    cancelScreenPicker,
    requestGroupRooms,
    refreshSettings,
    sendChat,
    deleteChat,
    editChat,
    setError
  };
}
