/**
 * Minimal loader for the YouTube IFrame Player API.
 *
 * A plain `youtube.com/embed/...` iframe cannot be controlled from JavaScript,
 * so Watch Together cannot sync play/pause/seek with it. The IFrame API gives
 * us a real player object with `playVideo()`, `pauseVideo()`, `seekTo()` and an
 * `onStateChange` event, which is what the room synchronization needs.
 *
 * The API script is loaded exactly once and shared across every player.
 */

// Minimal typings for the parts of the API we use (avoids a full @types dep).
export type YTPlayer = {
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  getCurrentTime: () => number;
  getPlayerState: () => number;
  loadVideoById: (options: { videoId: string; startSeconds?: number }) => void;
  destroy: () => void;
};

type YTPlayerEvent = { target: YTPlayer; data: number };

type YTNamespace = {
  Player: new (
    element: HTMLElement | string,
    options: {
      videoId?: string;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: (event: YTPlayerEvent) => void;
        onStateChange?: (event: YTPlayerEvent) => void;
      };
    }
  ) => YTPlayer;
  PlayerState: {
    UNSTARTED: number;
    ENDED: number;
    PLAYING: number;
    PAUSED: number;
    BUFFERING: number;
    CUED: number;
  };
};

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let loadPromise: Promise<YTNamespace> | null = null;

export function loadYouTubeApi(): Promise<YTNamespace> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (loadPromise) return loadPromise;

  loadPromise = new Promise<YTNamespace>((resolve) => {
    // If another part of the app already registered a ready callback, chain it.
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT) resolve(window.YT);
    };

    if (!document.querySelector('script[data-youtube-api]')) {
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      script.dataset.youtubeApi = 'true';
      document.head.appendChild(script);
    }

    // Safety net: if the API was already present but the global callback never
    // fired (e.g. cached), poll briefly for window.YT.
    let tries = 0;
    const poll = window.setInterval(() => {
      tries += 1;
      if (window.YT && window.YT.Player) {
        window.clearInterval(poll);
        resolve(window.YT);
      } else if (tries > 100) {
        window.clearInterval(poll);
      }
    }, 100);
  });

  return loadPromise;
}

// The numeric player states the IFrame API reports.
export const YT_STATE = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5
} as const;
