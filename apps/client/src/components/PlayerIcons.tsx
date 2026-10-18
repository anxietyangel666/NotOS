// Custom play / pause icons shared by every media player (music player,
// video viewer, pinned video, remote desktop mirror).
//
// The icons are rendered as CSS masks filled with `currentColor`, so they
// inherit the player button's color and automatically follow the active theme
// (light / dark / mint / ocean / system-black).
import { assetUrl } from '../utils/assets';

const PLAY_ICON = assetUrl('Emoji/play.png');
const PAUSE_ICON = assetUrl('Emoji/pause.png');
const PREV_ICON = assetUrl('Emoji/left-arrow.png');
const NEXT_ICON = assetUrl('Emoji/right-arrow.png');
const VOLUME_ON_ICON = assetUrl('Emoji/volume-unmute.png');
const VOLUME_MUTED_ICON = assetUrl('Emoji/volume_mute.png');
const MUTE_ICON = assetUrl('Emoji/mute.png');
const MONITOR_ICON = assetUrl('Emoji/monitor.png');

function maskStyle(url: string): React.CSSProperties {
  return {
    WebkitMaskImage: `url("${url}")`,
    WebkitMaskRepeat: 'no-repeat',
    WebkitMaskPosition: 'center',
    WebkitMaskSize: 'contain',
    maskImage: `url("${url}")`,
    maskRepeat: 'no-repeat',
    maskPosition: 'center',
    maskSize: 'contain'
  } as React.CSSProperties;
}

/**
 * Shows the pause icon while playing, otherwise the play icon. Drop this in
 * place of the old unicode ▶ / Ⅱ glyphs inside any player control button.
 */
export function PlayPauseIcon({ playing, size = 22 }: { playing: boolean; size?: number }) {
  const url = playing ? PAUSE_ICON : PLAY_ICON;
  return (
    <span
      className="player-icon"
      style={{ width: size, height: size, ...maskStyle(url) }}
    />
  );
}

/** Previous-track arrow icon. */
export function PrevTrackIcon({ size = 16 }: { size?: number }) {
  return (
    <span
      className="player-icon"
      style={{ width: size, height: size, ...maskStyle(PREV_ICON) }}
    />
  );
}

/** Next-track arrow icon. */
export function NextTrackIcon({ size = 16 }: { size?: number }) {
  return (
    <span
      className="player-icon"
      style={{ width: size, height: size, ...maskStyle(NEXT_ICON) }}
    />
  );
}

/**
 * Volume icon. Shows the muted icon when `muted` is true (volume at 0),
 * otherwise the regular volume icon.
 */
export function VolumeIcon({ muted, size = 18 }: { muted: boolean; size?: number }) {
  const url = muted ? VOLUME_MUTED_ICON : VOLUME_ON_ICON;
  return (
    <span
      className="player-icon"
      style={{ width: size, height: size, ...maskStyle(url) }}
    />
  );
}

/** Microphone mute icon, used by the voice channel controls and tiles. */
export function MicMuteIcon({ size = 22 }: { size?: number }) {
  return (
    <span
      className="player-icon"
      style={{ width: size, height: size, ...maskStyle(MUTE_ICON) }}
    />
  );
}

/** Screen-share / monitor icon, used by the voice channel controls. */
export function ScreenShareIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" style={{ display: 'block', flexShrink: 0 }}>
      <path d="M20 4H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h6v2H8v2h8v-2h-2v-2h6a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 12H4V6h16v10z" />
    </svg>
  );
}

/** Deafened (headphones disabled / sound off) icon. */
export function DeafenedIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" style={{ display: 'block', flexShrink: 0 }}>
      <path d="M2.7 3.7 1.3 5.1 4.4 8.2A9 9 0 0 0 3 13v4a3 3 0 0 0 3 3h1v-7H5v-1a7 7 0 0 1 .9-3.4l13 13 1.4-1.4L2.7 3.7zM12 4a9 9 0 0 1 9 9v4a3 3 0 0 1-1.6 2.6L17 17.2V13h2a7 7 0 0 0-9.3-6.6L8.1 4.8A9 9 0 0 1 12 4z" />
    </svg>
  );
}

/** Camera active icon. */
export function CameraActiveIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" style={{ display: 'block', flexShrink: 0 }}>
      <path d="M18 10.48V6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-4.48l4 3.98v-11l-4 3.5z" />
    </svg>
  );
}
