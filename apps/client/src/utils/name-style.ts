import type { CSSProperties } from 'react';
import type { NameStyle } from '../api/types';

// 14 selectable nickname fonts. Each entry provides a label shown on the "Aa"
// preview tile and the CSS font-family applied to the nickname.
export const NAME_STYLE_FONTS: Array<{ id: string; label: string; fontFamily: string }> = [
  { id: 'default', label: 'Aa', fontFamily: 'inherit' },
  { id: 'serif', label: 'Aa', fontFamily: 'Georgia, "Times New Roman", serif' },
  { id: 'mono', label: 'Aa', fontFamily: '"Courier New", ui-monospace, monospace' },
  { id: 'rounded', label: 'Aa', fontFamily: '"Trebuchet MS", "Segoe UI", sans-serif' },
  { id: 'condensed', label: 'Aa', fontFamily: '"Arial Narrow", "Roboto Condensed", sans-serif' },
  { id: 'wide', label: 'Aa', fontFamily: 'Verdana, Geneva, sans-serif' },
  { id: 'script', label: 'Aa', fontFamily: '"Brush Script MT", "Segoe Script", cursive' },
  { id: 'display', label: 'Aa', fontFamily: 'Impact, "Haettenschweiler", sans-serif' },
  { id: 'elegant', label: 'Aa', fontFamily: '"Palatino Linotype", "Book Antiqua", serif' },
  { id: 'modern', label: 'Aa', fontFamily: '"Century Gothic", "Futura", sans-serif' },
  { id: 'classic', label: 'Aa', fontFamily: '"Garamond", "Times New Roman", serif' },
  { id: 'tech', label: 'Aa', fontFamily: '"Consolas", "Lucida Console", monospace' },
  { id: 'soft', label: 'Aa', fontFamily: '"Comic Sans MS", "Segoe Print", cursive' },
  { id: 'sharp', label: 'Aa', fontFamily: '"Franklin Gothic Medium", "Arial Black", sans-serif' }
];

// 8 selectable nickname effects. The renderer below turns these into inline
// styles applied on top of the chosen base color.
export const NAME_STYLE_EFFECTS: Array<{ id: string; label: string }> = [
  { id: 'none', label: 'None' },
  { id: 'gradient', label: 'Gradient' },
  { id: 'neon', label: 'Neon' },
  { id: 'glow', label: 'Glow' },
  { id: 'shadow', label: 'Shadow' },
  { id: 'outline', label: 'Outline' },
  { id: 'metallic', label: 'Metallic' },
  { id: 'fire', label: 'Fire' }
];

// 12 quick-pick color tiles for the colour picker.
export const NAME_STYLE_COLORS: string[] = [
  '#ffffff',
  '#2AABEE',
  '#5865F2',
  '#9b59b6',
  '#e91e63',
  '#ff4d4f',
  '#ff7a00',
  '#f1c40f',
  '#2ecc71',
  '#1abc9c',
  '#34495e',
  '#000000'
];

export const DEFAULT_NAME_STYLE: NonNullable<NameStyle> = {
  font: 'default',
  effect: 'none',
  color: '#2AABEE'
};

function fontFamilyFor(font: string) {
  return NAME_STYLE_FONTS.find((item) => item.id === font)?.fontFamily ?? 'inherit';
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const value = clean.length === 3
    ? clean.split('').map((c) => c + c).join('')
    : clean.padEnd(6, '0').slice(0, 6);
  const num = parseInt(value, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function lighten(hex: string, amount: number) {
  const [r, g, b] = hexToRgb(hex);
  const mix = (channel: number) => Math.round(channel + (255 - channel) * amount);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

// Builds the inline CSS for a nickname given its style. Effects that rely on
// background-clip return `WebkitBackgroundClip`/`color: transparent`.
// Maps an effect to a CSS class that drives its keyframe animation. Pair the
// returned class with `nameStyleToCss` to get the full animated style. The
// keyframes themselves live in styles.css.
export function nameStyleClass(style: NameStyle): string {
  if (!style || style.effect === 'none') return '';
  return `name-fx name-fx-${style.effect}`;
}

export function nameStyleToCss(style: NameStyle): CSSProperties {
  if (!style) return {};
  const color = style.color || DEFAULT_NAME_STYLE.color;
  const base: CSSProperties = {
    fontFamily: fontFamilyFor(style.font)
  };

  switch (style.effect) {
    case 'gradient':
      return {
        ...base,
        // Wider gradient + repeated stops so the background can slide for the
        // animation defined in `.name-fx-gradient`.
        backgroundImage: `linear-gradient(90deg, ${color}, ${lighten(color, 0.6)}, ${color})`,
        backgroundSize: '200% 100%',
        WebkitBackgroundClip: 'text',
        backgroundClip: 'text',
        color: 'transparent'
      };
    case 'neon':
      return {
        ...base,
        color,
        // Custom property consumed by the pulsing keyframes.
        ['--fx-color' as string]: color,
        textShadow: `0 0 4px ${color}, 0 0 10px ${color}, 0 0 18px ${color}`
      };
    case 'glow':
      return {
        ...base,
        color,
        ['--fx-glow' as string]: lighten(color, 0.4),
        textShadow: `0 0 8px ${lighten(color, 0.4)}`
      };
    case 'shadow':
      return {
        ...base,
        color,
        textShadow: '2px 2px 3px rgba(0, 0, 0, 0.55)'
      };
    case 'outline':
      return {
        ...base,
        color,
        WebkitTextStroke: '0.6px rgba(0, 0, 0, 0.7)',
        textShadow: '0 0 1px rgba(0,0,0,0.4)'
      };
    case 'metallic':
      return {
        ...base,
        backgroundImage: `linear-gradient(110deg, ${color} 0%, ${lighten(color, 0.85)} 45%, ${color} 50%, ${lighten(color, 0.2)} 55%, ${color} 100%)`,
        backgroundSize: '220% 100%',
        WebkitBackgroundClip: 'text',
        backgroundClip: 'text',
        color: 'transparent'
      };
    case 'fire':
      return {
        ...base,
        backgroundImage: 'linear-gradient(0deg, #ff2d00 0%, #ff7a00 35%, #ffd000 65%, #fff3a0 100%)',
        backgroundSize: '100% 220%',
        WebkitBackgroundClip: 'text',
        backgroundClip: 'text',
        color: 'transparent',
        textShadow: '0 0 6px rgba(255, 90, 0, 0.6)'
      };
    case 'none':
    default:
      return { ...base, color };
  }
}
