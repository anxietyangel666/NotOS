import { useState } from 'react';

// Custom emoji icons used for the "open emoji picker" button.
// On hover the icon cycles to one of the alternate faces for a playful effect.
const EMOJI_ICONS = [
  '/Emoji/happy-face.png',
  '/Emoji/happiness.png',
  '/Emoji/winking-face.png'
];

const ATTACH_ICON = '/Emoji/plus.png';

// Build the CSS mask declaration for a given icon. The icon is rendered as a
// silhouette filled with `currentColor`, so it automatically follows the active
// theme (light / dark / mint / ocean / system-black) just like the other text.
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
 * Emoji-picker toggle icon. Shows a default face and swaps to a random
 * alternate face while the pointer hovers over the button. Rendered as a
 * masked element so its color follows the current theme.
 */
export function EmojiToggleIcon({ size = 24 }: { size?: number }) {
  const [src, setSrc] = useState(EMOJI_ICONS[0]);

  function pickHoverIcon() {
    // Choose any face other than the default so there is always a visible change.
    const alternates = EMOJI_ICONS.slice(1);
    const next = alternates[Math.floor(Math.random() * alternates.length)];
    setSrc(next);
  }

  return (
    <span
      className="chat-emoji-icon"
      style={{ width: size, height: size, ...maskStyle(src) }}
      onMouseEnter={pickHoverIcon}
      onMouseLeave={() => setSrc(EMOJI_ICONS[0])}
    />
  );
}

/** Attach-image icon using the custom plus image, colored by the active theme. */
export function AttachIcon({ size = 24 }: { size?: number }) {
  return (
    <span
      className="chat-attach-icon"
      style={{ width: size, height: size, ...maskStyle(ATTACH_ICON) }}
    />
  );
}
