import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { Language, PublicUser } from '../api/types';
import { t } from '../i18n';
import { getEmojiId, getEmojiName, type EmojiItem } from '../utils/emoji-data';
import { emojiToTwemojiUrl } from '../utils/emoji';
import {
  searchGifs,
  tenorLocale,
  GIF_CATEGORIES,
  fetchCategoryPreview,
  getFavoriteGifs,
  toggleFavoriteGif,
  subscribeFavoriteGifs,
  type TenorGif,
  type GifCategory
} from '../utils/tenor';
import {
  getInstalledPacks,
  subscribeCustomEmoji,
  customEmojiShortcode,
  buildPackLink,
  removePack,
  splitCustomEmoji,
  customEmojiToken,
  type CustomEmoji,
  type CustomEmojiPack
} from '../utils/custom-emoji';
import { getRecentEmoji, recordRecentEmoji, subscribeRecentEmoji } from '../utils/recent-emoji';

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
  /**
   * When provided, the picker shows an additional "GIF" tab. Selecting a GIF
   * calls this with the chosen GIF. If omitted, only the emoji tab is shown so
   * existing call sites keep their current behaviour.
   */
  onSelectGif?: (gif: TenorGif) => void;
  /** Which tab to open initially: 'emoji' (default), 'gif' or 'custom'. */
  initialTab?: PickerTab;
  /**
   * When provided, the Custom tab shows per-pack "Copy link" and "Delete"
   * controls (so a pack can be shared/removed without opening Settings).
   * `token`/`currentUser` are needed to build the shareable link.
   */
  token?: string;
  currentUser?: PublicUser;
  zIndex?: number;
  /**
   * When true, picking a custom emoji passes the full `<ce:name:url>` token
   * (not the bare `:shortcode:`) through `onSelect`. Used by the reaction
   * picker so reactions keep the URL needed to render the image later.
   */
  returnFullToken?: boolean;
};

type PickerTab = 'emoji' | 'gif' | 'custom';

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

// Star overlay used to favorite/unfavorite a GIF directly from a grid tile,
// mirroring Discord's GIF picker.
export function GifStar({ active, language, onToggle }: { active: boolean; language: Language; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={active ? 'gif-fav-star active' : 'gif-fav-star'}
      title={active ? t(language, 'gifFavoriteRemove') : t(language, 'gifFavoriteAdd')}
      aria-pressed={active}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    >
      <svg viewBox="0 0 24 24" width={15} height={15} aria-hidden="true">
        <path d="M12 2.5l2.95 5.98 6.6.96-4.78 4.66 1.13 6.57L12 17.56l-5.9 3.11 1.13-6.57L2.45 9.44l6.6-.96L12 2.5z"
          fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

// A single GIF tile (preview + favorite star).
function GifTile({ gif, language, favorite, onSelect, onToggleFav }: { gif: TenorGif; language: Language; favorite: boolean; onSelect: (gif: TenorGif) => void; onToggleFav: (gif: TenorGif) => void }) {
  return (
    <div className="gif-item" title={gif.description}>
      <button type="button" className="gif-item-pick" onClick={() => onSelect(gif)}>
        <img src={gif.previewUrl} alt={gif.description} loading="lazy" decoding="async" draggable={false} />
      </button>
      <GifStar active={favorite} language={language} onToggle={() => onToggleFav(gif)} />
    </div>
  );
}

type GifView =
  | { kind: 'browse' }
  | { kind: 'favorites' }
  | { kind: 'category'; category: GifCategory }
  | { kind: 'search'; query: string };

// GIF panel backed by Tenor, modeled on Discord: a browse screen with a
// Favorites tile followed by category tiles, plus debounced free-text search
// and per-GIF favoriting.
function GifPanel({ language, onSelectGif, onLayoutChange }: { language: Language; onSelectGif: (gif: TenorGif) => void; onLayoutChange: () => void }) {
  const [query, setQuery] = useState('');
  const [view, setView] = useState<GifView>({ kind: 'browse' });
  const [gifs, setGifs] = useState<TenorGif[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('ready');
  const [favorites, setFavorites] = useState<TenorGif[]>(() => getFavoriteGifs());
  const [previews, setPreviews] = useState<Record<string, TenorGif | null>>({});
  // Pagination state for infinite scroll. `nextCursor` is Tenor's opaque `next`
  // token; an empty string means there are no more pages. `loadingMore` guards
  // against firing overlapping page requests while one is in flight.
  const [nextCursor, setNextCursor] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  const gridRef = useRef<HTMLDivElement | null>(null);
  // Tracks the in-flight "load more" request so a view change can cancel it.
  const loadMoreToken = useRef(0);

  const locale = useMemo(() => tenorLocale(language), [language]);
  const trimmedQuery = query.trim();

  // A non-empty query takes over the panel with search results. Clearing the
  // box drops back to the browse screen (categories + favorites), but never
  // overrides an explicit category/favorites view the user opened with no query.
  useEffect(() => {
    if (trimmedQuery) {
      setView({ kind: 'search', query: trimmedQuery });
    } else {
      setView((current) => (current.kind === 'search' ? { kind: 'browse' } : current));
    }
  }, [trimmedQuery]);

  // Match favorites by id OR url so picker results and chat-favorited GIFs stay
  // in sync regardless of how they were starred.
  const favoriteKeys = useMemo(() => {
    const set = new Set<string>();
    favorites.forEach((gif) => { set.add(gif.id); set.add(gif.url); });
    return set;
  }, [favorites]);
  const isFav = (gif: TenorGif) => favoriteKeys.has(gif.id) || favoriteKeys.has(gif.url);

  const toggleFav = (gif: TenorGif) => setFavorites(toggleFavoriteGif(gif));

  // Keep the panel in sync when favorites change elsewhere (e.g. a star in a
  // chat bubble) while the picker is open.
  useEffect(() => subscribeFavoriteGifs(() => setFavorites(getFavoriteGifs())), []);

  // Load category thumbnail previews once when the browse screen is shown.
  useEffect(() => {
    if (view.kind !== 'browse') return;
    let cancelled = false;
    GIF_CATEGORIES.forEach((category) => {
      if (previews[category.id] !== undefined) return;
      fetchCategoryPreview(category.term, locale)
        .then((gif) => {
          if (cancelled) return;
          setPreviews((current) => ({ ...current, [category.id]: gif }));
        })
        .catch(() => {
          if (cancelled) return;
          setPreviews((current) => ({ ...current, [category.id]: null }));
        });
    });
    return () => {
      cancelled = true;
    };
  }, [view.kind, locale, previews]);

  // Fetch the first GIF page for search / category views. Pagination (loading
  // older pages on scroll) is handled separately by `loadMore`.
  useEffect(() => {
    if (view.kind === 'browse' || view.kind === 'favorites') return;
    let cancelled = false;
    // Invalidate any in-flight "load more" from a previous view.
    loadMoreToken.current += 1;
    setStatus('loading');
    setGifs([]);
    setNextCursor('');
    setLoadingMore(false);
    const term = view.kind === 'search' ? view.query : view.category.term;
    const delay = view.kind === 'search' ? 320 : 0;
    const handle = window.setTimeout(() => {
      searchGifs(term, locale)
        .then((page) => {
          if (cancelled) return;
          setGifs(page.gifs);
          setNextCursor(page.next);
          setStatus('ready');
          // Reset scroll to the top for a fresh query/category.
          if (gridRef.current) gridRef.current.scrollTop = 0;
        })
        .catch(() => {
          if (cancelled) return;
          setStatus('error');
        });
    }, delay);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [view, locale]);

  // Append the next page of GIFs for the active search/category view. Guards
  // ensure we only fetch when there is a cursor and no request is pending.
  const loadMore = useCallback(() => {
    if (loadingMore || !nextCursor) return;
    if (view.kind !== 'search' && view.kind !== 'category') return;
    const term = view.kind === 'search' ? view.query : view.category.term;
    const token = ++loadMoreToken.current;
    setLoadingMore(true);
    searchGifs(term, locale, nextCursor)
      .then((page) => {
        if (token !== loadMoreToken.current) return;
        // De-duplicate by id in case Tenor returns overlapping results.
        setGifs((current) => {
          const seen = new Set(current.map((gif) => gif.id));
          return [...current, ...page.gifs.filter((gif) => !seen.has(gif.id))];
        });
        setNextCursor(page.next);
        setLoadingMore(false);
      })
      .catch(() => {
        if (token !== loadMoreToken.current) return;
        setLoadingMore(false);
      });
  }, [loadingMore, nextCursor, view, locale]);

  // Trigger pagination when the grid is scrolled near the bottom.
  const handleGridScroll = useCallback(() => {
    const grid = gridRef.current;
    if (!grid) return;
    if (grid.scrollTop + grid.clientHeight >= grid.scrollHeight - 320) {
      loadMore();
    }
  }, [loadMore]);

  // Reposition the anchored picker whenever the visible content height changes.
  useEffect(() => {
    onLayoutChange();
  }, [gifs.length, status, view.kind, favorites.length, onLayoutChange]);

  const showBack = view.kind === 'favorites' || view.kind === 'category';

  return (
    <div className="emoji-content gif-content">
      <div className="gif-searchbar">
        {showBack ? (
          <button type="button" className="gif-back" title={t(language, 'gifs')} onClick={() => { setView({ kind: 'browse' }); }}>
            ‹
          </button>
        ) : null}
        <input className="text-field emoji-search" value={query} placeholder={t(language, 'searchGifs')} onChange={(event) => setQuery(event.target.value)} />
      </div>

      {view.kind === 'browse' ? (
        <div className="gif-grid gif-category-grid">
          <button type="button" className="gif-category-tile gif-favorites-tile" onClick={() => setView({ kind: 'favorites' })}>
            {favorites[0] ? (
              <img src={favorites[0].previewUrl} alt="" loading="lazy" decoding="async" draggable={false} />
            ) : null}
            <span className="gif-category-label">{t(language, 'gifFavorites')}
            </span>
          </button>
          {GIF_CATEGORIES.map((category) => {
            const preview = previews[category.id];
            return (
              <button key={category.id} type="button" className="gif-category-tile" onClick={() => setView({ kind: 'category', category })}>
                {preview ? <img src={preview.previewUrl} alt="" loading="lazy" decoding="async" draggable={false} /> : null}
                <span className="gif-category-label">{category.term}</span>
              </button>
            );
          })}
        </div>
      ) : view.kind === 'favorites' ? (
        favorites.length === 0 ? (
          <div className="gif-status">{t(language, 'gifNoResults')}</div>
        ) : (
          <div className="gif-grid">
            {favorites.map((gif) => (
              <GifTile key={gif.id} gif={gif} language={language} favorite={isFav(gif)} onSelect={onSelectGif} onToggleFav={toggleFav} />
            ))}
          </div>
        )
      ) : status === 'error' ? (
        <div className="gif-status">{t(language, 'gifLoadError')}</div>
      ) : status === 'loading' ? (
        <div className="gif-status">…</div>
      ) : gifs.length === 0 ? (
        <div className="gif-status">{t(language, 'gifNoResults')}</div>
      ) : (
        <div className="gif-grid" ref={gridRef} onScroll={handleGridScroll}>
          {gifs.map((gif) => (
            <GifTile key={gif.id} gif={gif} language={language} favorite={isFav(gif)} onSelect={onSelectGif} onToggleFav={toggleFav} />
          ))}
          {loadingMore ? <div className="gif-status gif-loading-more">…</div> : null}
        </div>
      )}
    </div>
  );
}

// Small chain-link icon used for the per-pack "copy share link" button.
function ChainLinkIcon({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5" />
      <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" />
    </svg>
  );
}

// Custom-emoji panel: lists installed packs grouped by name. Selecting an emoji
// inserts its self-describing token so it renders inline in the message.
function CustomEmojiPanel({ language, onSelect, onLayoutChange, token, currentUser, returnFullToken }: { language: Language; onSelect: (token: string) => void; onLayoutChange: () => void; token?: string; currentUser?: PublicUser; returnFullToken?: boolean }) {
  const [packs, setPacks] = useState<CustomEmojiPack[]>(() => getInstalledPacks());
  const [query, setQuery] = useState('');
  const [copiedPackId, setCopiedPackId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<CustomEmojiPack | null>(null);

  useEffect(() => subscribeCustomEmoji(() => setPacks(getInstalledPacks())), []);
  useEffect(() => {
    onLayoutChange();
  }, [packs, query, confirmDelete, onLayoutChange]);

  // Per-pack controls only make sense when we have the data to build a link.
  const canManage = Boolean(token && currentUser);

  async function copyPackLink(pack: CustomEmojiPack) {
    if (!currentUser) return;
    const link = buildPackLink(pack, { id: currentUser.id, name: currentUser.nickname, avatar: currentUser.avatarData });
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      const area = document.createElement('textarea');
      area.value = link;
      document.body.appendChild(area);
      area.select();
      try { document.execCommand('copy'); } catch { /* ignore */ }
      document.body.removeChild(area);
    }
    setCopiedPackId(pack.id);
    window.setTimeout(() => setCopiedPackId((current) => (current === pack.id ? null : current)), 1600);
  }

  const normalized = query.trim().toLowerCase();
  const visiblePacks = useMemo(() => {
    if (!normalized) return packs;
    return packs
      .map((pack) => ({ ...pack, emojis: pack.emojis.filter((emoji) => emoji.name.toLowerCase().includes(normalized)) }))
      .filter((pack) => pack.emojis.length > 0);
  }, [packs, normalized]);

  const hasEmojis = packs.some((pack) => pack.emojis.length > 0);

  return (
    <div className="emoji-content custom-emoji-content">
      <input className="text-field emoji-search" value={query} placeholder={t(language, 'customEmojiSearch')} onChange={(event) => setQuery(event.target.value)} />
      {!hasEmojis ? (
        <div className="gif-status">{t(language, 'customEmojiEmpty')}</div>
      ) : visiblePacks.length === 0 ? (
        <div className="gif-status">{t(language, 'customEmojiNoResults')}</div>
      ) : (
        <div className="custom-emoji-packs">
          {visiblePacks.map((pack) => (
            <section className="custom-emoji-pack" key={pack.id}>
              <div className="custom-emoji-pack-header">
                <h5 className="custom-emoji-pack-name">{pack.name}</h5>
                {canManage ? (
                  <div className="custom-emoji-pack-tools">
                    <button
                      type="button"
                      className={copiedPackId === pack.id ? 'pack-tool-btn copied' : 'pack-tool-btn'}
                      title={copiedPackId === pack.id ? t(language, 'customEmojiLinkCopied') : t(language, 'customEmojiCopyLink')}
                      aria-label={t(language, 'customEmojiCopyLink')}
                      onClick={() => void copyPackLink(pack)}
                    >
                      <ChainLinkIcon />
                    </button>
                    <button
                      type="button"
                      className="pack-tool-btn danger"
                      title={t(language, 'customEmojiRemove')}
                      aria-label={t(language, 'customEmojiRemove')}
                      onClick={() => setConfirmDelete(pack)}
                    >
                      ×
                    </button>
                  </div>
                ) : null}
              </div>
              <div className="emoji-grid">
                {pack.emojis.map((emoji) => (
                  <button key={emoji.id} type="button" title={`:${emoji.name}:`} className="custom-emoji-btn"
                    onClick={() => {
                      // Record the full self-describing token so the "Recent"
                      // grid can render the emoji image; insert the readable
                      // shortcode into the composer as before. When the host
                      // needs the full token (e.g. the reaction picker), pass
                      // that instead so the URL survives to the recipient.
                      recordRecentEmoji(customEmojiToken(emoji));
                      onSelect(returnFullToken ? customEmojiToken(emoji) : `${customEmojiShortcode(emoji)} `);
                    }}>
                    <img src={emoji.url} alt={`:${emoji.name}:`} width={24} height={24} loading="lazy" decoding="async" draggable={false} />
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {confirmDelete
        ? createPortal(
            <div className="pack-confirm-backdrop" onMouseDown={() => setConfirmDelete(null)}>
              <div className="pack-confirm-modal" onMouseDown={(event) => event.stopPropagation()}>
                <p>{t(language, 'customEmojiDeleteConfirm', { name: confirmDelete.name })}</p>
                <div className="pack-confirm-actions">
                  <button type="button" className="secondary-action compact-action" onClick={() => setConfirmDelete(null)}>
                    {t(language, 'cancel')}
                  </button>
                  <button
                    type="button"
                    className="primary-action danger-action compact-action"
                    onClick={() => {
                      removePack(confirmDelete.id);
                      setConfirmDelete(null);
                    }}
                  >
                    {t(language, 'customEmojiRemove')}
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

const RECENT_CATEGORY_ID = 'recent';

// Render a recently-used emoji entry, which may be a unicode emoji or a custom
// emoji token (`<ce:name:url>`).
function RecentEmojiButton({ value, onPick, returnFullToken = false }: { value: string; onPick: (value: string) => void; returnFullToken?: boolean }) {
  const parts = splitCustomEmoji(value);
  const custom = parts.find((part) => part.type === 'custom-emoji');
  if (custom && custom.type === 'custom-emoji') {
    const emoji = { id: `recent-${custom.name}`, name: custom.name, url: custom.url };
    return (
      <button type="button" title={`:${custom.name}:`} className="custom-emoji-btn"
        onClick={() => onPick(returnFullToken ? customEmojiToken(emoji) : `${customEmojiShortcode(emoji)} `)}>
        <img src={custom.url} alt={`:${custom.name}:`} width={24} height={24} loading="lazy" decoding="async" draggable={false} />
      </button>
    );
  }
  const name = getEmojiName(value);
  return (
    <button type="button" title={name}
      onClick={() => onPick(value)}>
      <TwemojiImg emoji={value} size={24} lazy />
    </button>
  );
}

export function EmojiPicker({ language, onSelect, onClose, anchorRef, placement = 'top-end', container, enlarged = false, onSelectGif, initialTab = 'emoji', token, currentUser, returnFullToken = false, zIndex }: EmojiPickerProps) {
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const lastAnchorRectRef = useRef<{ left: number; top: number; right: number; bottom: number; width: number; height: number } | null>(null);
  const [query, setQuery] = useState('');
  const [recent, setRecent] = useState<string[]>(() => getRecentEmoji());
  // Keep the Recent grid live while the picker is open.
  useEffect(() => subscribeRecentEmoji(() => setRecent(getRecentEmoji())), []);
  // Selecting any emoji records it into the recent list before forwarding.
  const handleSelect = (value: string) => {
    recordRecentEmoji(value);
    onSelect(value);
  };
  // Open on Recent when there is history, otherwise on the first category.
  const [categoryId, setCategoryId] = useState(() => (getRecentEmoji().length > 0 ? RECENT_CATEGORY_ID : EMOJI_CATEGORIES[0].id));
  const [position, setPosition] = useState<CSSProperties>({ left: 12, top: 12, visibility: 'hidden' });
  const showGifTab = Boolean(onSelectGif);
  // Tabs are always shown now: the Custom (custom emoji) tab is always present,
  // the GIF tab only when a GIF handler is provided.
  const showTabs = true;
  const [tab, setTab] = useState<PickerTab>(initialTab === 'gif' && !showGifTab ? 'emoji' : initialTab);
  // Holds the latest positioning routine so child panels (e.g. the GIF grid)
  // can request a reposition after their content height changes.
  const repositionRef = useRef<() => void>(() => {});

  // Allow the host to switch tabs while the picker stays open (e.g. clicking the
  // GIF button while the emoji tab is showing).
  useEffect(() => {
    setTab(initialTab === 'gif' && !showGifTab ? 'emoji' : initialTab);
  }, [initialTab, showGifTab]);
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
      const measure = () => {
        const anchorRect = anchorRef?.current?.getBoundingClientRect() ?? null;
        const hasUsableAnchor = Boolean(anchorRect && (anchorRect.width > 0 || anchorRect.height > 0 || anchorRect.left !== 0 || anchorRect.top !== 0));
        if (anchorRect && hasUsableAnchor) {
          lastAnchorRectRef.current = {
            left: anchorRect.left,
            top: anchorRect.top,
            right: anchorRect.right,
            bottom: anchorRect.bottom,
            width: anchorRect.width,
            height: anchorRect.height
          };
        }
        const anchor = lastAnchorRectRef.current ?? anchorRect ?? target.getBoundingClientRect();
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
      };
      // Wait one frame so the DOM is up-to-date before we measure the picker;
      // this prevents a visible jump when switching tabs (esp. to Custom, which
      // can take a tick to render the first pack).
      window.requestAnimationFrame(measure);
    }

    repositionRef.current = updatePosition;
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [anchorRef, categoryId, placement, visibleItems.length, tab]);

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
      // The pack delete confirmation is portaled to <body> (outside the picker
      // root), so a click on it would otherwise look like an "outside" click and
      // close the whole picker before the Delete button's onClick can run.
      if (target instanceof Element && target.closest('.pack-confirm-backdrop')) return;
      close();
    }

    window.addEventListener('pointerdown', closeOnOutsidePointerDown, true);
    return () => {
      window.clearTimeout(armHandle);
      window.removeEventListener('pointerdown', closeOnOutsidePointerDown, true);
    };
  }, [anchorRef, onClose]);

  return createPortal(
    <div ref={pickerRef} className={`emoji-picker${enlarged ? ' emoji-picker-enlarged' : ''}${showTabs ? ' has-tabs' : ''}`} style={{ ...position, ...(zIndex !== undefined ? { zIndex } : {}) }} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
      {showTabs ? (
        <div className="picker-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'emoji'} className={tab === 'emoji' ? 'active' : ''} onClick={() => setTab('emoji')}>
            {t(language, 'emoji')}
          </button>
          {showGifTab ? (
            <button type="button" role="tab" aria-selected={tab === 'gif'} className={tab === 'gif' ? 'active' : ''} onClick={() => setTab('gif')}>
              {t(language, 'gifs')}
            </button>
          ) : null}
          <button type="button" role="tab" aria-selected={tab === 'custom'} className={tab === 'custom' ? 'active' : ''} onClick={() => setTab('custom')}>
            {t(language, 'customEmoji')}
          </button>
        </div>
      ) : null}

      {tab === 'gif' && onSelectGif ? (
        <GifPanel language={language} onSelectGif={onSelectGif} onLayoutChange={() => repositionRef.current()} />
      ) : tab === 'custom' ? (
        <CustomEmojiPanel language={language} onSelect={onSelect} onLayoutChange={() => repositionRef.current()} token={token} currentUser={currentUser} returnFullToken={returnFullToken} />
      ) : (
        <>
          <nav className="emoji-categories" aria-label={t(language, 'emoji')}>
            {recent.length > 0 ? (
              <button className={RECENT_CATEGORY_ID === categoryId ? 'active' : ''} type="button" title={t(language, 'recentEmoji')} onClick={() => setCategoryId(RECENT_CATEGORY_ID)}>
                <span className="emoji-recent-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 7v5l3 2" />
                  </svg>
                </span>
                <span>{t(language, 'recentEmoji')}</span>
              </button>
            ) : null}
            {EMOJI_CATEGORIES.map((category) => (
              <button className={category.id === categoryId ? 'active' : ''} key={category.id} type="button" title={category.label} onClick={() => setCategoryId(category.id)}>
                <TwemojiImg emoji={category.icon} />
                <span>{category.label}</span>
              </button>
            ))}
          </nav>
          <div className="emoji-content">
            <input className="text-field emoji-search" value={query} placeholder={t(language, 'searchEmoji')} onChange={(event) => setQuery(event.target.value)} />
            {!normalizedQuery && categoryId === RECENT_CATEGORY_ID ? (
              <div className="emoji-grid">
                {recent.map((value, index) => (
                  <RecentEmojiButton key={`recent-${index}`} value={value} onPick={handleSelect} returnFullToken={returnFullToken} />
                ))}
              </div>
            ) : (
              <div className="emoji-grid">
                {visibleItems.map((item, index) => (
                  <button key={`${item.id}-${index}`} type="button" title={item.name}
                    onClick={() => handleSelect(item.emoji)}>
                    <TwemojiImg emoji={item.emoji} size={24} lazy />
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>,
    container ?? document.body
  );
}
