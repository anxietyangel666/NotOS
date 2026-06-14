// Custom play / pause icons shared by every media player (music player,
// video viewer, pinned video, remote desktop mirror).
//
// The icons are rendered as CSS masks filled with `currentColor`, so they
// inherit the player button's color and automatically follow the active theme
// (light / dark / mint / ocean / system-black).
const PLAY_ICON = '/Emoji/play.png';
const PAUSE_ICON = '/Emoji/pause.png';
const PREV_ICON = '/Emoji/left-arrow.png';
const NEXT_ICON = '/Emoji/right-arrow.png';
const VOLUME_ON_ICON = '/Emoji/volume-unmute.png';
const VOLUME_MUTED_ICON = '/Emoji/volume_mute.png';
const MUTE_ICON = '/Emoji/mute.png';
const MONITOR_ICON = '/Emoji/monitor.png';

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
    <span
      className="player-icon"
      style={{ width: size, height: size, ...maskStyle(MONITOR_ICON) }}
    />
  );
}
