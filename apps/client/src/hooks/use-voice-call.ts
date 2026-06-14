import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { PublicUser } from '../api/types';
import { loadCallSettings, type CallSettings } from '../utils/call-settings';

export type CallPhase = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'active';

export type CallEndReason = 'hangup' | 'declined' | 'missed' | 'cancelled' | 'disconnect' | 'busy' | 'unavailable' | 'error';

export type CallEndedEvent = {
  peer: PublicUser | null;
  reason: CallEndReason;
  duration: number;
  connected: boolean;
  outgoing: boolean;
};

type IncomingCall = {
  callId: string;
  caller: PublicUser;
};

export type ScreenSource = {
  id: string;
  name: string;
  thumbnail: string;
  isScreen: boolean;
};

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
];

const TALK_THRESHOLD = 0.02;

type UseVoiceCallArgs = {
  socket: Socket | null;
  currentUser: PublicUser;
  resolveUser: (userId: string) => Promise<PublicUser | null>;
  onCallEnded?: (event: CallEndedEvent) => void;
};

export function useVoiceCall({ socket, currentUser, resolveUser, onCallEnded }: UseVoiceCallArgs) {
  const [phase, setPhase] = useState<CallPhase>('idle');
  const [peer, setPeer] = useState<PublicUser | null>(null);
  const [incoming, setIncoming] = useState<IncomingCall | null>(null);
  const [muted, setMuted] = useState(false);
  const [sharingScreen, setSharingScreen] = useState(false);
  const [remoteMuted, setRemoteMuted] = useState(false);
  const [remoteSharingScreen, setRemoteSharingScreen] = useState(false);
  const [localTalking, setLocalTalking] = useState(false);
  const [remoteTalking, setRemoteTalking] = useState(false);
  const [callError, setCallError] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [screenSources, setScreenSources] = useState<ScreenSource[] | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  // Always-fresh socket reference. Several callbacks (screen share, mute) are
  // memoized with empty deps and would otherwise capture the initial `null` socket,
  // silently skipping renegotiation and state events.
  const socketRef = useRef<Socket | null>(null);
  const callIdRef = useRef<string | null>(null);
  const isCallerRef = useRef(false);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const micTrackRef = useRef<MediaStreamTrack | null>(null);
  const screenSenderRef = useRef<RTCRtpSender | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const remoteVideoStreamRef = useRef<MediaStream | null>(null);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const settingsRef = useRef<CallSettings>(loadCallSettings());
  const pttActiveRef = useRef(false);
  const talkingRafRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const elapsedTimerRef = useRef<number | null>(null);
  const peerRef = useRef<PublicUser | null>(null);
  const outgoingRef = useRef(false);
  // Calls that already ended; guards against showing the incoming modal after the
  // async caller lookup resolves for a call that was cancelled in the meantime.
  const endedCallsRef = useRef<Set<string>>(new Set());

  const [remoteVideoStream, setRemoteVideoStream] = useState<MediaStream | null>(null);
  // Local screen-share preview so the sharer can see what is being broadcast.
  const [localScreenStream, setLocalScreenStream] = useState<MediaStream | null>(null);

  peerRef.current = peer;
  socketRef.current = socket;

  const refreshSettings = useCallback(() => {
    settingsRef.current = loadCallSettings();
    applyMicVolume();
    applyOutputVolume();
    if (settingsRef.current.pushToTalk) {
      // In PTT mode the mic stays muted unless the key is held.
      setMicEnabled(pttActiveRef.current && !muted);
    } else {
      setMicEnabled(!muted);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [muted]);

  function applyMicVolume() {
    const gain = gainRef.current;
    if (gain) gain.gain.value = Math.max(0, settingsRef.current.micVolume / 100);
  }

  function applyOutputVolume() {
    const audio = remoteAudioRef.current;
    if (audio) audio.volume = Math.min(1, Math.max(0, settingsRef.current.outputVolume / 100));
  }

  function setMicEnabled(enabled: boolean) {
    const track = micTrackRef.current;
    if (track) track.enabled = enabled;
    // Resume the processing AudioContext if it was suspended while the window
    // was minimized/backgrounded, so background push-to-talk still transmits.
    if (enabled && audioCtxRef.current?.state === 'suspended') {
      void audioCtxRef.current.resume().catch(() => undefined);
    }
  }

  function emitState(partial: { muted?: boolean; screen?: boolean; talking?: boolean }) {
    const live = socketRef.current;
    if (!live || !callIdRef.current) return;
    live.emit('call:state', { callId: callIdRef.current, ...partial });
  }

  function cleanupMedia() {
    if (talkingRafRef.current) cancelAnimationFrame(talkingRafRef.current);
    talkingRafRef.current = null;
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    screenStreamRef.current = null;
    micTrackRef.current = null;
    screenSenderRef.current = null;
    remoteStreamRef.current = null;
    remoteVideoStreamRef.current = null;
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => undefined);
      audioCtxRef.current = null;
    }
    gainRef.current = null;
    analyserRef.current = null;
  }

  const resetCall = useCallback(() => {
    pcRef.current?.close();
    pcRef.current = null;
    cleanupMedia();
    callIdRef.current = null;
    isCallerRef.current = false;
    outgoingRef.current = false;
    startTimeRef.current = null;
    if (elapsedTimerRef.current) window.clearInterval(elapsedTimerRef.current);
    elapsedTimerRef.current = null;
    setPhase('idle');
    setPeer(null);
    setIncoming(null);
    setMuted(false);
    setSharingScreen(false);
    setRemoteMuted(false);
    setRemoteSharingScreen(false);
    setLocalTalking(false);
    setRemoteTalking(false);
    setElapsed(0);
    setRemoteVideoStream(null);
    setLocalScreenStream(null);
  }, []);

  async function buildLocalAudio(): Promise<MediaStream> {
    const s = settingsRef.current;
    const constraints: MediaStreamConstraints = {
      audio: {
        deviceId: s.inputDeviceId && s.inputDeviceId !== 'default' ? { exact: s.inputDeviceId } : undefined,
        noiseSuppression: s.noiseSuppression,
        echoCancellation: s.echoCancellation,
        autoGainControl: s.autoGainControl
      },
      video: false
    };
    const raw = await navigator.mediaDevices.getUserMedia(constraints);

    // Route mic through a gain node so we can control input volume, then capture
    // the processed track for the peer connection.
    const ctx = new AudioContext();
    audioCtxRef.current = ctx;
    const source = ctx.createMediaStreamSource(raw);
    const gain = ctx.createGain();
    gainRef.current = gain;
    applyMicVolume();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyserRef.current = analyser;
    const dest = ctx.createMediaStreamDestination();
    source.connect(gain);
    gain.connect(analyser);
    gain.connect(dest);

    const processed = dest.stream;
    micTrackRef.current = processed.getAudioTracks()[0] ?? null;
    localStreamRef.current = processed;

    startTalkingDetection(analyser);
    // Apply initial mic state for PTT/mute.
    if (settingsRef.current.pushToTalk) setMicEnabled(false);
    else setMicEnabled(!muted);
    return processed;
  }

  function startTalkingDetection(analyser: AnalyserNode) {
    const data = new Uint8Array(analyser.fftSize);
    let lastTalking = false;
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i += 1) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / data.length);
      const enabled = micTrackRef.current?.enabled ?? false;
      const talking = enabled && rms > TALK_THRESHOLD;
      if (talking !== lastTalking) {
        lastTalking = talking;
        setLocalTalking(talking);
        emitState({ talking });
      }
      talkingRafRef.current = requestAnimationFrame(tick);
    };
    talkingRafRef.current = requestAnimationFrame(tick);
  }

  function createPeerConnection(callId: string) {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pcRef.current = pc;

    pc.onicecandidate = (event) => {
      const live = socketRef.current;
      if (event.candidate && live) {
        live.emit('call:signal', { callId, data: { type: 'ice', candidate: event.candidate } });
      }
    };

    pc.ontrack = (event) => {
      const [stream] = event.streams;
      if (event.track.kind === 'audio') {
        remoteStreamRef.current = stream;
        const audio = remoteAudioRef.current;
        if (audio) {
          audio.srcObject = stream;
          applyOutputVolume();
          void audio.play().catch(() => undefined);
        }
      } else if (event.track.kind === 'video') {
        remoteVideoStreamRef.current = stream;
        setRemoteVideoStream(stream);
        event.track.onended = () => {
          remoteVideoStreamRef.current = null;
          setRemoteVideoStream(null);
        };
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        setPhase('active');
        if (!startTimeRef.current) {
          startTimeRef.current = Date.now();
          elapsedTimerRef.current = window.setInterval(() => {
            if (startTimeRef.current) setElapsed(Math.round((Date.now() - startTimeRef.current) / 1000));
          }, 1000);
        }
      } else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        // Connection dropped; surface to the user but let signaling drive teardown.
        if (callIdRef.current) hangup();
      }
    };

    return pc;
  }

  // --- Public actions ---

  const startCall = useCallback(
    async (target: PublicUser) => {
      if (!socket || phase !== 'idle') return;
      setCallError('');
      settingsRef.current = loadCallSettings();
      outgoingRef.current = true;
      setPeer(target);
      setPhase('outgoing');
      isCallerRef.current = true;
      socket.emit('call:invite', { calleeId: target.id });
    },
    [phase, socket]
  );

  // Accept a call by its id directly. Used both by the in-messenger invite modal
  // and by the desktop toast when the messenger was closed when the call arrived
  // (in that case the hook never received `call:incoming` on its own socket).
  const acceptCallById = useCallback(
    async (callId: string, caller: PublicUser) => {
      if (!socket || pcRef.current) return;
      setCallError('');
      settingsRef.current = loadCallSettings();
      callIdRef.current = callId;
      isCallerRef.current = false;
      outgoingRef.current = false;
      setPeer(caller);
      setIncoming(null);
      setPhase('connecting');
      try {
        const stream = await buildLocalAudio();
        const pc = createPeerConnection(callId);
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));
        socket.emit('call:accept', { callId });
      } catch {
        setCallError('micFailed');
        socket.emit('call:hangup', { callId });
        resetCall();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resetCall, socket]
  );

  const acceptCall = useCallback(async () => {
    if (!incoming) return;
    await acceptCallById(incoming.callId, incoming.caller);
  }, [acceptCallById, incoming]);

  const declineCall = useCallback(() => {
    if (!socket || !incoming) return;
    socket.emit('call:decline', { callId: incoming.callId });
    setIncoming(null);
    if (phase === 'incoming') resetCall();
  }, [incoming, phase, resetCall, socket]);

  const hangup = useCallback(() => {
    if (!socket) return;
    const id = callIdRef.current;
    const duration = startTimeRef.current ? Math.round((Date.now() - startTimeRef.current) / 1000) : 0;
    const wasConnected = phase === 'active';
    if (id) socket.emit('call:hangup', { callId: id });
    if (id && peerRef.current) {
      onCallEnded?.({ peer: peerRef.current, reason: 'hangup', duration, connected: wasConnected, outgoing: outgoingRef.current });
    }
    resetCall();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, resetCall, socket]);

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      if (!settingsRef.current.pushToTalk) setMicEnabled(!next);
      else if (next) setMicEnabled(false);
      emitState({ muted: next });
      return next;
    });
  }, []);

  const stopScreenShare = useCallback(async () => {
    const pc = pcRef.current;
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current = null;
    if (pc && screenSenderRef.current) {
      try {
        pc.removeTrack(screenSenderRef.current);
      } catch {
        /* ignore */
      }
      screenSenderRef.current = null;
      await renegotiate();
    }
    setLocalScreenStream(null);
    setSharingScreen(false);
    emitState({ screen: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function attachScreenStream(display: MediaStream) {
    const pc = pcRef.current;
    if (!pc) {
      display.getTracks().forEach((t) => t.stop());
      return;
    }
    screenStreamRef.current = display;
    const track = display.getVideoTracks()[0];
    if (!track) return;
    track.onended = () => {
      void stopScreenShare();
    };
    screenSenderRef.current = pc.addTrack(track, display);
    await renegotiate();
    setLocalScreenStream(display);
    setSharingScreen(true);
    emitState({ screen: true });
  }

  // Begin screen sharing. In Electron we present a picker of windows/screens first;
  // in the browser getDisplayMedia shows the native picker directly.
  const startScreenShare = useCallback(async (sourceId?: string) => {
    setScreenSources(null);
    try {
      let display: MediaStream;
      if (sourceId && window.notoc?.selectScreenSource) {
        // Electron: register the chosen source with the main process, then capture
        // it via getDisplayMedia (the legacy chromeMediaSource getUserMedia path is
        // no longer supported by modern Electron).
        await window.notoc.selectScreenSource(sourceId);
        display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      } else if (sourceId) {
        // Legacy Electron fallback.
        display = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: sourceId
            }
          } as unknown as MediaTrackConstraints
        });
      } else {
        display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      }
      await attachScreenStream(display);
    } catch {
      setCallError('screenFailed');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Opens the source picker (Electron) or starts the browser flow directly.
  const requestScreenShare = useCallback(async () => {
    if (sharingScreen) {
      void stopScreenShare();
      return;
    }
    const native = window.notoc?.getScreenSources;
    if (native) {
      try {
        const sources = await native();
        setScreenSources(sources);
      } catch {
        setCallError('screenFailed');
      }
    } else {
      void startScreenShare();
    }
  }, [sharingScreen, startScreenShare, stopScreenShare]);

  const cancelScreenPicker = useCallback(() => setScreenSources(null), []);

  async function renegotiate() {
    const pc = pcRef.current;
    const live = socketRef.current;
    if (!pc || !live || !callIdRef.current) return;
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    live.emit('call:signal', { callId: callIdRef.current, data: { type: 'offer', sdp: pc.localDescription } });
  }

  // --- Signaling wiring ---

  useEffect(() => {
    if (!socket) return;

    const onIncoming = async (payload: { callId: string; callerId: string; callerNickname: string }) => {
      if (phase !== 'idle') {
        socket.emit('call:decline', { callId: payload.callId });
        return;
      }
      const caller = (await resolveUser(payload.callerId)) ?? {
        ...currentUser,
        id: payload.callerId,
        nickname: payload.callerNickname
      };
      // The call may have ended while the caller lookup was in flight.
      if (endedCallsRef.current.has(payload.callId)) return;
      setIncoming({ callId: payload.callId, caller });
      setPhase('incoming');
    };

    const onRinging = (payload: { callId: string }) => {
      callIdRef.current = payload.callId;
    };

    const onBusy = () => {
      setCallError('userBusy');
      const target = peerRef.current;
      if (target) onCallEnded?.({ peer: target, reason: 'busy', duration: 0, connected: false, outgoing: true });
      resetCall();
    };

    const onUnavailable = () => {
      setCallError('userOffline');
      const target = peerRef.current;
      if (target) onCallEnded?.({ peer: target, reason: 'unavailable', duration: 0, connected: false, outgoing: true });
      resetCall();
    };

    const onAccepted = async () => {
      // Caller side: build media and send the offer once the callee accepts.
      if (!isCallerRef.current || !callIdRef.current) return;
      setPhase('connecting');
      try {
        const stream = await buildLocalAudio();
        const pc = createPeerConnection(callIdRef.current);
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));
        await renegotiate();
      } catch {
        setCallError('micFailed');
        hangup();
      }
    };

    const onSignal = async (payload: { callId: string; from: string; data: { type: string; sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit } }) => {
      const pc = pcRef.current;
      if (!pc) return;
      const { data } = payload;
      try {
        if (data.type === 'offer' && data.sdp) {
          await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socket.emit('call:signal', { callId: payload.callId, data: { type: 'answer', sdp: pc.localDescription } });
        } else if (data.type === 'answer' && data.sdp) {
          await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        } else if (data.type === 'ice' && data.candidate) {
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
      } catch {
        /* ignore malformed signaling */
      }
    };

    const onRemoteState = (payload: { muted?: boolean; screen?: boolean; talking?: boolean }) => {
      if (typeof payload.muted === 'boolean') setRemoteMuted(payload.muted);
      if (typeof payload.screen === 'boolean') {
        setRemoteSharingScreen(payload.screen);
        if (!payload.screen) {
          // The peer stopped sharing; drop the (now frozen) remote video.
          remoteVideoStreamRef.current = null;
          setRemoteVideoStream(null);
        }
      }
      if (typeof payload.talking === 'boolean') setRemoteTalking(payload.talking);
    };

    const onEnded = (payload: { callId?: string; reason: CallEndReason; duration: number; connected: boolean; caller: string }) => {
      if (payload.callId) {
        if (endedCallsRef.current.size > 100) endedCallsRef.current.clear();
        endedCallsRef.current.add(payload.callId);
      }
      const target = peerRef.current;
      const wasOutgoing = outgoingRef.current;
      if (target && phase !== 'idle') {
        onCallEnded?.({
          peer: target,
          reason: payload.reason,
          duration: payload.duration,
          connected: payload.connected,
          outgoing: wasOutgoing
        });
      }
      resetCall();
    };

    socket.on('call:incoming', onIncoming);
    socket.on('call:ringing', onRinging);
    socket.on('call:busy', onBusy);
    socket.on('call:unavailable', onUnavailable);
    socket.on('call:accepted', onAccepted);
    socket.on('call:signal', onSignal);
    socket.on('call:state', onRemoteState);
    socket.on('call:ended', onEnded);

    return () => {
      socket.off('call:incoming', onIncoming);
      socket.off('call:ringing', onRinging);
      socket.off('call:busy', onBusy);
      socket.off('call:unavailable', onUnavailable);
      socket.off('call:accepted', onAccepted);
      socket.off('call:signal', onSignal);
      socket.off('call:state', onRemoteState);
      socket.off('call:ended', onEnded);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, phase, currentUser, resolveUser]);

  // --- Push-to-talk key handling ---

  useEffect(() => {
    if (phase !== 'active' && phase !== 'connecting') return;
    if (!settingsRef.current.pushToTalk) return;

    const key = settingsRef.current.pushToTalkKey;
    const down = (event: KeyboardEvent) => {
      if (event.code !== key || pttActiveRef.current) return;
      const tag = (event.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      pttActiveRef.current = true;
      if (!muted) setMicEnabled(true);
    };
    const up = (event: KeyboardEvent) => {
      if (event.code !== key) return;
      pttActiveRef.current = false;
      setMicEnabled(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);

    // Background push-to-talk: register a system-wide hotkey through Electron so
    // the user can transmit while another app (e.g. a game) is focused. The
    // in-window listeners above keep working when NotOS itself has focus.
    let unregisterDown: (() => void) | undefined;
    let unregisterUp: (() => void) | undefined;
    const native = window.notoc;
    if (native?.registerPushToTalk) {
      void native.registerPushToTalk(key);
      unregisterDown = native.onPushToTalkDown?.(() => {
        if (pttActiveRef.current) return;
        pttActiveRef.current = true;
        if (!muted) setMicEnabled(true);
      });
      unregisterUp = native.onPushToTalkUp?.(() => {
        pttActiveRef.current = false;
        setMicEnabled(false);
      });
    }

    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      unregisterDown?.();
      unregisterUp?.();
      void window.notoc?.unregisterPushToTalk?.();
    };
  }, [phase, muted]);

  useEffect(() => () => resetCall(), [resetCall]);

  return {
    phase,
    peer,
    incoming,
    muted,
    sharingScreen,
    remoteMuted,
    remoteSharingScreen,
    localTalking,
    remoteTalking,
    callError,
    elapsed,
    remoteVideoStream,
    localScreenStream,
    remoteAudioRef,
    screenSources,
    startCall,
    acceptCall,
    acceptCallById,
    declineCall,
    hangup,
    toggleMute,
    requestScreenShare,
    startScreenShare,
    stopScreenShare,
    cancelScreenPicker,
    refreshSettings,
    setCallError
  };
}
