// Inline GIF attachment with a favorite toggle (extracted from GroupChatView.tsx).
import { useEffect, useState } from 'react';
import type { Language } from '../../api/types';
import { GifStar } from '../EmojiPicker';
import { gifFromUrl, isFavoriteGifUrl, subscribeFavoriteGifs, toggleFavoriteGif } from '../../utils/tenor';

export function GroupChatGifAttachment({
  src,
  name,
  language,
  onOpen,
  onLoad
}: {
  src: string;
  name: string;
  language: Language;
  onOpen: () => void;
  onLoad?: () => void;
}) {
  const [favorite, setFavorite] = useState(() => isFavoriteGifUrl(src));

  useEffect(() => subscribeFavoriteGifs(() => setFavorite(isFavoriteGifUrl(src))), [src]);

  return (
    <span className="chat-inline-gif message-gif-attachment">
      <button type="button" className="chat-inline-gif-pick" onClick={onOpen}>
        <img src={src} alt={name} loading="lazy" decoding="async" draggable={false} onLoad={onLoad} />
      </button>
      <GifStar
        active={favorite}
        language={language}
        onToggle={() => {
          toggleFavoriteGif(gifFromUrl(src, name));
          setFavorite(isFavoriteGifUrl(src));
        }}
      />
    </span>
  );
}
