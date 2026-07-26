import { useState } from 'react';
import { assetUrl } from '../utils/assets';

// Custom emoji icons used for the "open emoji picker" button.
// On hover the icon cycles to one of the alternate faces for a playful effect.
const EMOJI_ICONS = [
  assetUrl('Emoji/happy-face.png'),
  assetUrl('Emoji/happiness.png'),
  assetUrl('Emoji/winking-face.png')
];

const ATTACH_ICON = assetUrl('Emoji/plus.png');

// Build the CSS mask declaration for a given icon. The icon is rendered as a
// silhouette filled with `currentColor`, so it automatically follows the active
// theme (light / dark / mint / ocean / system-black) just like the other text.
function maskStyle(url: string, scale = 100): React.CSSProperties {
  // `scale` lets an icon with extra transparent padding be enlarged within its
  // box so it appears the same visual size as the other compose icons.
  const size = `${scale}%`;
  return {
    WebkitMaskImage: `url("${url}")`,
    WebkitMaskRepeat: 'no-repeat',
    WebkitMaskPosition: 'center',
    WebkitMaskSize: size,
    maskImage: `url("${url}")`,
    maskRepeat: 'no-repeat',
    maskPosition: 'center',
    maskSize: size
  } as React.CSSProperties;
}

/**
 * Emoji-picker toggle icon. Shows a default face and swaps to a random
 * alternate face while the pointer hovers over the button. Rendered as a
 * masked element so its color follows the current theme.
 */
export function EmojiToggleIcon({ size = 26 }: { size?: number }) {
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

const GIF_ICON = assetUrl('Emoji/gif-file.png');

/**
 * GIF-picker icon. Rendered as a masked silhouette (same as the emoji/attach
 * icons) so its size and color follow the active theme. Sits to the left of
 * the emoji toggle.
 */
export function GifIcon({ size = 26 }: { size?: number }) {
  return (
    <span
      className="chat-gif-icon"
      // gif-file.png has more transparent padding around the artwork, so it is
      // scaled up to visually match the emoji/attach icons.
      style={{ width: size, height: size, ...maskStyle(GIF_ICON, 155) }}
    />
  );
}
