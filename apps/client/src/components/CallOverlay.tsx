import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react';
import type { Language, PublicUser } from '../api/types';
import { t } from '../i18n';
import type { useVoiceCall } from '../hooks/use-voice-call';
import { UserName } from './UserName';
import { getAvatarColor } from '../utils/avatar-color';

// Resolves the dominant color of an avatar so a panel can be tinted with it.
export function useAvatarColor(src: string | undefined | null): string {
  const [color, setColor] = useState('rgb(88, 101, 242)');
  useEffect(() => {
    let active = true;
    void getAvatarColor(src).then((c) => {
      if (active) setColor(c);
    });
    return () => {
      active = false;
    };
  }, [src]);
  return color;
}

// A small video preview for a screen share in the bottom strip.
function ScreenStripTile({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.srcObject = stream;
      void ref.current.play().catch(() => undefined);
    }
  }, [stream]);
  return <video ref={ref} autoPlay playsInline muted />;
}

// A large panel that fills the stage: tinted with the avatar's dominant color and
// the avatar centered inside. Used for the focused tile in the call stage.
export function StagePanelAvatar({ user, talking, muted, color, size = 'large' }: {
  user: PublicUser;
  talking?: boolean;
  muted?: boolean;
  color: string;
  size?: 'large' | 'small';
}) {
  return (
    <div
      className={`call-panel call-panel-${size}${talking ? ' talking' : ''}`}
      style={{ '--panel-tint': color } as CSSProperties}
    >
      <div className="call-panel-avatar">
        <img src={user.avatarData} alt="" />
        {muted ? (
          <span className="call-peer-muted">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zM4.41 2.86 3 4.27l6 6V11c0 1.66 1.34 3 3 3 .23 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9l4.19 4.18 1.41-1.41L4.41 2.86z"/></svg>
          </span>
        ) : null}
      </div>
      <span className="call-panel-name"><UserName user={user} /></span>
    </div>
  );
}

type VoiceCall = ReturnType<typeof useVoiceCall>;

type CallOverlayProps = {
  call: VoiceCall;
  language: Language;
};

// Hidden audio element kept mounted for the whole call lifecycle so the remote
// voice keeps playing regardless of which visual mode is shown.
export function CallAudioSink({ call }: { call: VoiceCall }) {
  return <audio ref={call.remoteAudioRef} autoPlay style={{ display: 'none' }} />;
}

// Centered ringing modal with a blurred backdrop (incoming + outgoing).
export function CallInviteModal({ call, language }: CallOverlayProps) {
  const { phase, peer, incoming, acceptCall, declineCall, hangup } = call;

  if (phase === 'incoming' && incoming) {
    return (
      <div className="call-invite-backdrop">
        <div className="call-invite-card">
          <div className="call-invite-avatar ringing">
            <img src={incoming.caller.avatarData} alt="" />
            <span className="call-invite-ring" />
          </div>
          <UserName user={incoming.caller} as="strong" className="call-invite-name" />
          <small className="call-invite-status">{t(language, 'incomingCall')}</small>
          <div className="call-invite-actions">
            <button className="call-btn decline" type="button" onClick={declineCall} title={t(language, 'declineCall')}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85a.99.99 0 0 1-1.41-.01L.29 13.08a.99.99 0 0 1 0-1.4C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.68c.39.38.39 1.01 0 1.4l-2.48 2.39a.99.99 0 0 1-1.41.01 11.5 11.5 0 0 0-2.66-1.85.998.998 0 0 1-.56-.9v-3.1A15.9 15.9 0 0 0 12 9z"/></svg>
            </button>
            <button className="call-btn accept" type="button" onClick={() => void acceptCall()} title={t(language, 'acceptCall')}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.02-.24 11.36 11.36 0 0 0 3.57.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.24 1.02l-2.2 2.2z"/></svg>
            </button>
          </div>
        </div>
      </div>
    );
  }

  if ((phase === 'outgoing' || phase === 'connecting') && peer) {
    return (
      <div className="call-invite-backdrop">
        <div className="call-invite-card">
          <div className="call-invite-avatar ringing">
            <img src={peer.avatarData} alt="" />
            <span className="call-invite-ring" />
          </div>
          <UserName user={peer} as="strong" className="call-invite-name" />
          <small className="call-invite-status">{phase === 'connecting' ? t(language, 'callConnecting') : t(language, 'callingUser')}</small>
          <div className="call-invite-actions">
            <button className="call-btn decline" type="button" onClick={hangup} title={t(language, 'endCall')}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85a.99.99 0 0 1-1.41-.01L.29 13.08a.99.99 0 0 1 0-1.4C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.68c.39.38.39 1.01 0 1.4l-2.48 2.39a.99.99 0 0 1-1.41.01 11.5 11.5 0 0 0-2.66-1.85.998.998 0 0 1-.56-.9v-3.1A15.9 15.9 0 0 0 12 9z"/></svg>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return hh > 0 ? `${hh}:${pad(mm)}:${pad(s)}` : `${mm}:${pad(s)}`;
}

type CallStagePanelProps = CallOverlayProps & {
  currentUser: PublicUser;
  chatCollapsed: boolean;
  onToggleChat: () => void;
};

// The Discord-style top panel: avatar/video stage + controls. Lives above the chat.
export function CallStagePanel({ call, language, currentUser, chatCollapsed, onToggleChat }: CallStagePanelProps) {
  const {
    phase,
    peer,
    muted,
    sharingScreen,
    remoteMuted,
    localTalking,
    remoteTalking,
    callError,
    elapsed,
    remoteVideoStream,
    localScreenStream,
    toggleMute,
    hangup,
    requestScreenShare
  } = call;

  const stageRef = useRef<HTMLDivElement | null>(null);
  const mainVideoRef = useRef<HTMLVideoElement | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  // Stage height (% of the chat panel), draggable via the bottom divider.
  const [stageHeight, setStageHeight] = useState(46);

  // Drag the divider to grow/shrink the call stage (and thus the chat below it).
  const startResize = (event: ReactMouseEvent) => {
    event.preventDefault();
    const panel = stageRef.current?.parentElement;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    const onMove = (e: MouseEvent) => {
      const fraction = ((e.clientY - rect.top) / rect.height) * 100;
      setStageHeight(Math.min(85, Math.max(20, fraction)));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  // The tile shown in the big center panel: a participant ('peer' / 'self') or a
  // screen share ('screen:peer' / 'screen:self').
  const [focusId, setFocusId] = useState<string>('peer');

  const peerColor = useAvatarColor(peer?.avatarData);
  const selfColor = useAvatarColor(currentUser.avatarData);

  // Available screen shares: the remote peer's share and/or our own local preview.
  const remoteShare = remoteVideoStream ?? null;
  const localShare = localScreenStream ?? null;
  const showVideo = Boolean(remoteShare || localShare);

  // Build every tile that can be focused: participants first, then screen shares.
  type StageTile =
    | { id: string; kind: 'person'; user: PublicUser; talking: boolean; muted: boolean; color: string }
    | { id: string; kind: 'screen'; stream: MediaStream; label: string };
  const tiles: StageTile[] = [];
  if (peer) tiles.push({ id: 'peer', kind: 'person', user: peer, talking: remoteTalking, muted: remoteMuted, color: peerColor });
  tiles.push({ id: 'self', kind: 'person', user: currentUser, talking: localTalking && !muted, muted, color: selfColor });
  if (remoteShare) tiles.push({ id: 'screen:peer', kind: 'screen', stream: remoteShare, label: peer?.nickname ?? '' });
  if (localShare) tiles.push({ id: 'screen:self', kind: 'screen', stream: localShare, label: currentUser.nickname });

  // Auto-focus a screen share when one appears; fall back to the peer when shares end.
  useEffect(() => {
    if (remoteShare) setFocusId('screen:peer');
    else if (localShare) setFocusId('screen:self');
    else setFocusId('peer');
  }, [remoteShare, localShare]);

  const focused = tiles.find((tile) => tile.id === focusId) ?? tiles[0];
  const sideTiles = tiles.filter((tile) => tile.id !== focused?.id);
  const focusedVideo = focused?.kind === 'screen' ? focused.stream : null;

  useEffect(() => {
    const video = mainVideoRef.current;
    if (video && focusedVideo) {
      video.srcObject = focusedVideo;
      void video.play().catch(() => undefined);
    }
  }, [focusedVideo]);

  useEffect(() => {
    const onFullscreenChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  useEffect(() => {
    if (!showVideo && document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  }, [showVideo]);

  const toggleFullscreen = () => {
    const stage = stageRef.current;
    if (!stage) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void stage.requestFullscreen().catch(() => undefined);
  };

  // Number of grid columns from the tile count (Discord keeps tiles large).
  const columns = tiles.length <= 1 ? 1 : tiles.length <= 4 ? 2 : tiles.length <= 9 ? 3 : 4;

  // Renders one Discord-style tile (participant card or screen share).
  function renderTile(tile: StageTile, spotlight: boolean) {
    if (tile.kind === 'screen') {
      return (
        <button
          key={tile.id}
          type="button"
          className={`dvoice-tile dvoice-tile-screen${focused?.id === tile.id ? ' focused' : ''}`}
          title={tile.label}
          onClick={() => setFocusId(tile.id)}
          onDoubleClick={toggleFullscreen}
        >
          {spotlight ? (
            <video ref={mainVideoRef} autoPlay playsInline muted />
          ) : (
            <ScreenStripTile stream={tile.stream} />
          )}
          <span className="dvoice-tile-name">{tile.label}</span>
          <span className="dvoice-tile-live">LIVE</span>
        </button>
      );
    }
    return (
      <button
        key={tile.id}
        type="button"
        className={`dvoice-tile dvoice-tile-person${tile.talking ? ' talking' : ''}${focused?.id === tile.id ? ' focused' : ''}`}
        style={{ '--tile-tint': tile.color } as CSSProperties}
        title={tile.user.nickname}
        onClick={() => setFocusId(tile.id)}
      >
        <span className="dvoice-tile-avatar">
          <img src={tile.user.avatarData} alt="" />
        </span>
        <span className="dvoice-tile-name">
          {tile.muted ? (
            <svg className="dvoice-tile-mute" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zM4.41 2.86 3 4.27l6 6V11c0 1.66 1.34 3 3 3 .23 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9l4.19 4.18 1.41-1.41L4.41 2.86z"/></svg>
          ) : null}
          <UserName user={tile.user} />
        </span>
      </button>
    );
  }

  return (
    <>
    <div
      ref={stageRef}
      className={`dvoice dm-call${chatCollapsed ? ' chat-collapsed' : ''}${fullscreen ? ' fullscreen' : ''}`}
      style={!chatCollapsed && !fullscreen ? ({ height: `${stageHeight}%` } as CSSProperties) : undefined}
    >
      <div className="dvoice-stage">
        <div className="dvoice-grid-wrap">
          {focused?.kind === 'screen' ? (
            <div className="dvoice-spotlight">
              <div className="dvoice-spotlight-main">{renderTile(focused, true)}</div>
              {sideTiles.length > 0 ? (
                <div className="dvoice-spotlight-strip">{sideTiles.map((tile) => renderTile(tile, false))}</div>
              ) : null}
            </div>
          ) : (
            <div className="dvoice-grid" style={{ '--cols': columns } as CSSProperties}>
              {tiles.map((tile) => renderTile(tile, false))}
            </div>
          )}
        </div>

        {/* Call duration overlay (top-right). */}
        <span className="dvoice-timer">
          <span className="call-status-dot" data-phase={phase} /> {phase === 'active' ? formatDuration(elapsed) : t(language, 'callConnecting')}
        </span>
        {callError ? <span className="dvoice-error">{t(language, 'callError')}</span> : null}

        {/* Floating Discord-style control pill. */}
        <div className="dvoice-controls">
          <button className={`dvoice-ctrl${muted ? ' danger-active' : ''}`} type="button" onClick={toggleMute} title={muted ? t(language, 'unmute') : t(language, 'mute')}>
            {muted ? (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zM4.41 2.86 3 4.27l6 6V11c0 1.66 1.34 3 3 3 .23 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9l4.19 4.18 1.41-1.41L4.41 2.86z"/></svg>
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z"/></svg>
            )}
          </button>
          <button className={`dvoice-ctrl${sharingScreen ? ' active' : ''}`} type="button" onClick={() => void requestScreenShare()} title={sharingScreen ? t(language, 'stopScreenShare') : t(language, 'shareScreen')} disabled={phase !== 'active'}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M20 4H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h6v2H8v2h8v-2h-2v-2h6a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 12H4V6h16v10z"/></svg>
          </button>
          {showVideo ? (
            <button className={`dvoice-ctrl${fullscreen ? ' active' : ''}`} type="button" onClick={toggleFullscreen} title={fullscreen ? t(language, 'callExitFullscreen') : t(language, 'callFullscreen')}>
              {fullscreen ? (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/></svg>
              ) : (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>
              )}
            </button>
          ) : null}
          <button className={`dvoice-ctrl${chatCollapsed ? '' : ' active'}`} type="button" onClick={onToggleChat} title={chatCollapsed ? t(language, 'showChat') : t(language, 'hideChat')}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-4H6V6h12v1z"/></svg>
          </button>
          <button className="dvoice-ctrl hangup" type="button" onClick={hangup} title={t(language, 'endCall')}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85a.99.99 0 0 1-1.41-.01L.29 13.08a.99.99 0 0 1 0-1.4C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.68c.39.38.39 1.01 0 1.4l-2.48 2.39a.99.99 0 0 1-1.41.01 11.5 11.5 0 0 0-2.66-1.85.998.998 0 0 1-.56-.9v-3.1A15.9 15.9 0 0 0 12 9z"/></svg>
          </button>
        </div>
      </div>
    </div>
    {/* Draggable divider: resize the call stage / chat split. */}
    {!chatCollapsed && !fullscreen ? (
      <div className="call-stage-resizer" onMouseDown={startResize}>
        <span className="voice-view-resizer-grip" />
      </div>
    ) : null}
    </>
  );
}

// Modal listing capturable windows/screens (Electron source picker).
export function ScreenSourcePicker({ call, language }: CallOverlayProps) {
  const { screenSources, startScreenShare, cancelScreenPicker } = call;
  if (!screenSources) return null;
  return (
    <div className="call-source-backdrop" onMouseDown={cancelScreenPicker}>
      <div className="call-source-card" onMouseDown={(e) => e.stopPropagation()}>
        <h3>{t(language, 'chooseScreen')}</h3>
        <div className="call-source-grid">
          {screenSources.length === 0 ? <p className="settings-hint">{t(language, 'noScreenSources')}</p> : null}
          {screenSources.map((source) => (
            <button key={source.id} className="call-source-item" type="button" onClick={() => void startScreenShare(source.id)}>
              <img src={source.thumbnail} alt="" />
              <span>{source.name}</span>
            </button>
          ))}
        </div>
        <div className="call-source-actions">
          <button className="secondary-action" type="button" onClick={cancelScreenPicker}>{t(language, 'cancel')}</button>
        </div>
      </div>
    </div>
  );
}
