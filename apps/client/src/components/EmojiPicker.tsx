import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { Language } from '../api/types';
import { t } from '../i18n';
import { getEmojiId, getEmojiName, type EmojiItem } from '../utils/emoji-data';
import { emojiToTwemojiUrl } from '../utils/emoji';
import { showEmojiTooltip } from './EmojiTooltip';

function TwemojiImg({ emoji, size = 22, lazy = false }: { emoji: string; size?: number; lazy?: boolean }) {
  const url = emojiToTwemojiUrl(emoji);
  if (!url) return <span>{emoji}</span>;
  return <img src={url} alt={emoji} draggable={false} width={size} height={size}
    loading={lazy ? 'lazy' : undefined} decoding="async"
    style={{ width: size, height: size, verticalAlign: 'middle', display: 'inline-block' }} />;
}

type EmojiPickerProps = {
  language: Language;
  onSelect: (emoji: string) => void;
  onClose?: () => void;
  anchorRef?: RefObject<HTMLElement | null>;
  placement?: 'top-end' | 'bottom-end' | 'left-start' | 'right-start';
  container?: HTMLElement | null;
  /** Render a larger picker to match enlarged chat content. */
  enlarged?: boolean;
};

function toItems(list: string[]): EmojiItem[] {
  return list.map((emoji) => ({ emoji, id: getEmojiId(emoji), name: getEmojiName(emoji) }));
}

const EMOJI_CATEGORIES = [
  {
    id: 'smileys', icon: '😀', label: 'Smileys',
    items: toItems(['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃', '🥲', '😉', '😊', '😍', '🥰', '😘', '😗', '😋', '😛', '😜', '🤪', '🥹', '😎', '🤩', '🥳', '😏', '😒', '😞', '😔', '😟', '😕', '🙁', '😣', '😖', '😫', '😭', '😢', '😤', '😡', '🤔', '🤗', '🙄', '😴', '🥱', '😈', '🤡', '💀', '👻', '🎃', '🤖', '😺', '😸', '😹', '😻', '😼', '😽', '🙀', '😿', '😾', '👽', '👾'])
  },
  {
    id: 'people', icon: '👋', label: 'People',
    items: toItems(['👋', '✋', '👌', '👍', '👎', '👏', '🙏', '💪', '🤝', '🫶', '👀', '🧠', '👑', '👂', '👃', '👅', '💋', '👣', '🙈', '🙉', '🙊', '💃', '🕺', '🧑‍💻', '👨‍💻', '👩‍💻', '🧑‍🎤', '👨‍🎤', '👩‍🎤', '🧑‍🍳', '🤳', '💅', '🦷', '🦴', '👶', '🧒', '👦', '👧', '🧑', '👨', '👩', '🧔', '👴', '👵', '👆', '👇', '👈', '👉', '🖐️', '🤚', '✊', '👊', '🤛', '🤜', '🦵', '🦶', '👁️', '🗣️', '👔', '👕', '👖', '🧥', '👗', '👘', '👙', '👚', '👛', '👜', '👝', '🎒', '👞', '👟', '🥿', '👠', '👡', '👢', '👒', '🎩', '🧢'])
  },
  {
    id: 'nature', icon: '🌿', label: 'Nature',
    items: toItems(['🌿', '🌱', '🌲', '🌳', '🌸', '🌺', '🌻', '🌹', '🌷', '🌼', '💐', '🎄', '🪴', '🌈', '⭐', '🌟', '✨', '🔥', '💧', '☀️', '🌙', '⚡', '❄️', '🌊', '🌋', '🌴', '🍃', '🍂', '🌵', '☘️', '🍀', '🐶', '🐱', '🐼', '🐻', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🐔', '🐧', '🐦', '🐤', '🦅', '🦉', '🦇', '🐺', '🐝', '🦋', '🐛', '🐜', '🐞', '🐭', '🐹', '🐰', '🦊', '🐻‍❄️', '🐾', '🐗', '🐫', '🦒', '🐘', '🦏', '🦛', '🦔', '🐿️', '🦌', '🐄', '🐑', '🐏', '🐐'])
  },
  {
    id: 'food', icon: '🍕', label: 'Food',
    items: toItems(['🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍓', '🍇', '🍕', '🍔', '🍟', '🌭', '🍩', '🍪', '🍫', '☕', '🍵', '🥤', '🍺', '🍻', '🥂', '🍷', '🍰', '🧁', '🍦', '🍿', '🥨', '🧀', '🥑', '🌮', '🌯', '🥗', '🍝', '🍜', '🍲', '🍛', '🍣', '🍱', '🥟', '🍤', '🍙', '🍚', '🥘', '🍳', '🥞', '🧇', '🥐', '🍞', '🥪', '🥫', '🥮', '🥠', '🥡', '🧆', '🥙', '🥩', '🥓', '🥬', '🫘', '🫑', '🥦', '🥒', '🥕', '🌽', '🫒', '🥜', '🌰', '🫐'])
  },
  {
    id: 'activity', icon: '⚽', label: 'Activity',
    items: toItems(['⚽', '🏀', '🏈', '⚾', '🎾', '🏐', '🎱', '🏓', '🎮', '🎧', '🎵', '🎶', '🎬', '🎯', '🏆', '🚀', '💻', '📚', '✈️', '🚗', '🏠', '💡', '🔑', '🎁', '🎈', '🎉', '🎊', '📸', '📱', '⌚', '🎸', '🎺', '🎻', '🥁', '🎨', '🎭', '🎪', '🎤', '🎼', '🏅', '🥇', '🥈', '🥉', '🎽', '🛹', '🛴', '🚲', '🏍️', '🥊', '🥋', '🤿', '🏏', '🏑', '🏒', '🏸', '🤺', '⛷️', '🏂', '🪂', '🏋️', '🤼', '🤸', '🤾', '⛹️', '🏌️', '🪀', '🪁', '🧩', '🧸', '♟️', '🎲', '🃏', '🀄', '🎙️', '🎚️', '🎛️', '🎫', '🎟️', '🎠', '🎡', '🎢', '🧶'])
  },
  {
    id: 'symbols', icon: '💜', label: 'Symbols',
    items: toItems(['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💔', '❤️‍🔥', '✨', '✅', '❌', '❗', '❓', '💯', '🔒', '🔔', '♠️', '♥️', '♦️', '♣️', '🆒', '🆕', '🆗', '🆙', '🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '🟤', '⚫', '⚪', '🔶', '🔷', '🔸', '🔹', '🔺', '🔻', '💠', '♻️', '📛', '🔰', '⭕', '✔️', '🔞', '⬆️', '⬇️', '➡️', '⬅️', '↗️', '↘️', '↙️', '↖️', '🔄', '↩️', '↪️', '♈', '♉', '♊', '♋', '♌', '♍', '♎', '♏', '♐', '♑', '♒', '♓', '⚕️', '♿'])
  },
  {
    id: 'objects', icon: '📦', label: 'Objects',
    items: toItems(['🔇', '🔈', '🔉', '🔊', '📢', '📣', '📯', '🔕', '📖', '📕', '📗', '📘', '📙', '📓', '📔', '📒', '📃', '📜', '📄', '📑', '📰', '🗞️', '🏷️', '🔖', '📎', '🖇️', '✂️', '📌', '📍', '🧷', '🔍', '🔎', '🖊️', '🖋️', '✒️', '🖌️', '🖍️', '📝', '🗂️', '📁', '📂', '🗃️', '🗄️', '🗑️', '🔐', '🔓', '🔏', '🧮', '⌨️', '🖥️', '🖨️', '🖱️', '💿', '📀', '💾'])
  },
  {
    id: 'travel', icon: '🚢', label: 'Travel',
    items: toItems(['🚟', '🚠', '🚡', '🚂', '🚃', '🚄', '🚅', '🚆', '🚇', '🚈', '🚉', '🚊', '🚝', '🚞', '⛵', '🛶', '🚤', '🛳️', '⛴️', '🚢', '🚁', '🛩️', '🛫', '🛬', '🛰️', '🛸', '🌄', '🌅', '🏔️', '⛰️', '🏕️', '🏖️', '🏜️', '🏝️', '🏗️', '🏛️', '⛪', '🕌', '🕍', '🛕'])
  },
  {
    id: 'flags', icon: '🏁', label: 'Flags',
    items: toItems(['🏳️', '🏴', '🏴‍☠️', '🇺🇳', '🇦🇫', '🇦🇽', '🇦🇱', '🇩🇿', '🇦🇸', '🇦🇩', '🇦🇴', '🇦🇮', '🇦🇶', '🇦🇬', '🇦🇷', '🇦🇲', '🇦🇼', '🇦🇺', '🇦🇹', '🇦🇿', '🇧🇸', '🇧🇭', '🇧🇩', '🇧🇧', '🇧🇾', '🇧🇪', '🇧🇿', '🇧🇯', '🇧🇲', '🇧🇹', '🇧🇴', '🇧🇦', '🇧🇼', '🇧🇷', '🇧🇳', '🇧🇬', '🇧🇫', '🇧🇮', '🇨🇻', '🇰🇭', '🇨🇲', '🇨🇦', '🇮🇨', '🇰🇾', '🇨🇫', '🇹🇩', '🇨🇱', '🇨🇳', '🇨🇴', '🇰🇲', '🇨🇬', '🇨🇩', '🇨🇰', '🇨🇷', '🇨🇮', '🇭🇷', '🇨🇺', '🇨🇼', '🇨🇾', '🇨🇿', '🇩🇰', '🇩🇯', '🇩🇲', '🇩🇴', '🇪🇨', '🇪🇬', '🇸🇻', '🇬🇶', '🇪🇷', '🇪🇪', '🇸🇿', '🇪🇹', '🇪🇺', '🇫🇰', '🇫🇴', '🇫🇯', '🇫🇮', '🇫🇷', '🇬🇫', '🇵🇫', '🇬🇦', '🇬🇲', '🇬🇪', '🇩🇪', '🇬🇭', '🇬🇮', '🇬🇷', '🇬🇱', '🇬🇩', '🇬🇵', '🇬🇺', '🇬🇹', '🇬🇬', '🇬🇳', '🇬🇼', '🇬🇾', '🇭🇹', '🇭🇳', '🇭🇰', '🇭🇺', '🇮🇸', '🇮🇳', '🇮🇩', '🇮🇷', '🇮🇶', '🇮🇪', '🇮🇲', '🇮🇱', '🇮🇹', '🇯🇲', '🇯🇵', '🇯🇪', '🇯🇴', '🇰🇿', '🇰🇪', '🇰🇮', '🇰🇵', '🇰🇷', '🇽🇰', '🇰🇼', '🇰🇬', '🇱🇦', '🇱🇻', '🇱🇧', '🇱🇸', '🇱🇷', '🇱🇾', '🇱🇮', '🇱🇹', '🇱🇺', '🇲🇴', '🇲🇬', '🇲🇼', '🇲🇾', '🇲🇻', '🇲🇱', '🇲🇹', '🇲🇭', '🇲🇶', '🇲🇷', '🇲🇺', '🇾🇹', '🇲🇽', '🇫🇲', '🇲🇩', '🇲🇨', '🇲🇳', '🇲🇪', '🇲🇸', '🇲🇦', '🇲🇿', '🇲🇲', '🇳🇦', '🇳🇷', '🇳🇵', '🇳🇱', '🇳🇨', '🇳🇿', '🇳🇮', '🇳🇪', '🇳🇬', '🇳🇺', '🇳🇫', '🇲🇰', '🇲🇵', '🇳🇴', '🇴🇲', '🇵🇰', '🇵🇼', '🇵🇸', '🇵🇦', '🇵🇬', '🇵🇾', '🇵🇪', '🇵🇭', '🇵🇳', '🇵🇱', '🇵🇹', '🇵🇷', '🇶🇦', '🇷🇪', '🇷🇴', '🇷🇺', '🇷🇼', '🇼🇸', '🇸🇲', '🇸🇹', '🇸🇦', '🇸🇳', '🇷🇸', '🇸🇨', '🇸🇱', '🇸🇬', '🇸🇽', '🇸🇰', '🇸🇮', '🇸🇧', '🇸🇴', '🇿🇦', '🇬🇸', '🇸🇸', '🇪🇸', '🇱🇰', '🇧🇱', '🇸🇭', '🇰🇳', '🇱🇨', '🇲🇫', '🇵🇲', '🇻🇨', '🇸🇩', '🇸🇷', '🇸🇪', '🇨🇭', '🇸🇾', '🇹🇼', '🇹🇯', '🇹🇿', '🇹🇭', '🇹🇱', '🇹🇬', '🇹🇰', '🇹🇴', '🇹🇹', '🇹🇳', '🇹🇷', '🇹🇲', '🇹🇨', '🇹🇻', '🇺🇬', '🇺🇦', '🇦🇪', '🇬🇧', '🇺🇸', '🇺🇾', '🇺🇿', '🇻🇺', '🇻🇦', '🇻🇪', '🇻🇳', '🇼🇫', '🇪🇭', '🇾🇪', '🇿🇲', '🇿🇼'])
  }
];

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export function EmojiPicker({ language, onSelect, onClose, anchorRef, placement = 'top-end', container, enlarged = false }: EmojiPickerProps) {
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState(EMOJI_CATEGORIES[0].id);
  const [position, setPosition] = useState<CSSProperties>({ left: 12, top: 12, visibility: 'hidden' });
  const normalizedQuery = query.trim().toLowerCase();
  const activeCategory = EMOJI_CATEGORIES.find((category) => category.id === categoryId) ?? EMOJI_CATEGORIES[0];
  const visibleItems = useMemo(() => {
    const source = normalizedQuery ? EMOJI_CATEGORIES.flatMap((category) => category.items) : activeCategory.items;
    if (!normalizedQuery) return source;
    return source.filter((item) => item.name.includes(normalizedQuery) || item.emoji.includes(normalizedQuery));
  }, [activeCategory.items, normalizedQuery]);

  useEffect(() => {
    const picker = pickerRef.current;
    if (!picker) return;
    const target = picker;

    function updatePosition() {
      const anchor = anchorRef?.current?.getBoundingClientRect() ?? target.getBoundingClientRect();
      const width = target.offsetWidth;
      const height = target.offsetHeight;
      const gap = 8;
      const margin = 10;
      const preferred = {
        'top-end': { left: anchor.right - width, top: anchor.top - height - gap },
        'bottom-end': { left: anchor.right - width, top: anchor.bottom + gap },
        'left-start': { left: anchor.left - width - gap, top: anchor.top },
        'right-start': { left: anchor.right + gap, top: anchor.top }
      }[placement];
      const next = {
        left: clamp(preferred.left, margin, window.innerWidth - width - margin),
        top: clamp(preferred.top, margin, window.innerHeight - height - margin)
      };

      setPosition({ left: next.left, top: next.top, visibility: 'visible' });
    }

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [anchorRef, categoryId, placement, visibleItems.length]);

  useEffect(() => {
    if (!onClose) return;
    const close: () => void = onClose;
    let armed = false;
    const armHandle = window.setTimeout(() => {
      armed = true;
    }, 160);

    function closeOnOutsidePointerDown(event: PointerEvent) {
      if (!armed) return;
      const target = event.target as Node | null;
      if (target && pickerRef.current?.contains(target)) return;
      if (target && anchorRef?.current?.contains(target)) return;
      close();
    }

    window.addEventListener('pointerdown', closeOnOutsidePointerDown, true);
    return () => {
      window.clearTimeout(armHandle);
      window.removeEventListener('pointerdown', closeOnOutsidePointerDown, true);
    };
  }, [anchorRef, onClose]);

  return createPortal(
    <div ref={pickerRef} className={enlarged ? 'emoji-picker emoji-picker-enlarged' : 'emoji-picker'} style={position} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
      <nav className="emoji-categories" aria-label={t(language, 'emoji')}>
        {EMOJI_CATEGORIES.map((category) => (
          <button className={category.id === categoryId ? 'active' : ''} key={category.id} type="button" title={category.label} onClick={() => setCategoryId(category.id)}>
            <TwemojiImg emoji={category.icon} />
            <span>{category.label}</span>
          </button>
        ))}
      </nav>
      <div className="emoji-content">
        <input className="text-field emoji-search" value={query} placeholder={t(language, 'searchEmoji')} onChange={(event) => setQuery(event.target.value)} />
        <div className="emoji-grid">
          {visibleItems.map((item, index) => (
            <button key={`${item.id}-${index}`} type="button" title={item.name}
              onMouseEnter={(e) => {
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                showEmojiTooltip({ emoji: item.emoji, name: item.name, x: rect.left + rect.width / 2, y: rect.top - 36 });
              }}
              onMouseLeave={() => showEmojiTooltip(null)}
              onClick={() => onSelect(item.emoji)}>
              <TwemojiImg emoji={item.emoji} size={24} lazy />
            </button>
          ))}
        </div>
      </div>
    </div>,
    container ?? document.body
  );
}
