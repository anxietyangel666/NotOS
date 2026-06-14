import { useCallback, useRef, useState } from 'react';
import type { Language, StorageItem } from '../api/types';
import { t } from '../i18n';
import { WindowFrame } from './WindowFrame';

type ImageViewerWindowProps = {
  language: Language;
  item: StorageItem;
  minimized: boolean;
  maximized: boolean;
  zIndex: number;
  onFocus: () => void;
  onClose: () => void;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onPin?: () => void;
};

export function ImageViewerWindow({ language, item, minimized, maximized, zIndex, onFocus, onClose, onMinimize, onToggleMaximize, onPin }: ImageViewerWindowProps) {
  const [scale, setScale] = useState(1);
  const [origin, setOrigin] = useState({ x: 50, y: 50 });
  const imgRef = useRef<HTMLImageElement | null>(null);

  const handleClick = useCallback((event: React.MouseEvent<HTMLImageElement>) => {
    const rect = imgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;
    setOrigin({ x, y });
    setScale((s) => {
      const next = s * 1.2;
      return next >= 2.5 ? 1 : next;
    });
  }, []);

  return (
    <WindowFrame
      language={language}
      title={item.name}
      eyebrow={t(language, 'imageViewer')}
      className="image-viewer-window"
      minimized={minimized}
      maximized={maximized}
      zIndex={zIndex}
      defaultPosition={{ x: Math.max(24, window.innerWidth / 2 - 370), y: 78 }}
      minSize={{ width: 520, height: 360 }}
      storageKey="image-viewer"
      onFocus={onFocus}
      onClose={onClose}
      onMinimize={onMinimize}
      onToggleMaximize={onToggleMaximize}
    >
      <div className="image-viewer-canvas">
        {item.content ? (
          <div className="image-viewer-img-wrap">
            {onPin ? (
              <button className="image-pin-btn" type="button" title={t(language, 'pinToDesktop')} onClick={onPin}>
                📌
              </button>
            ) : null}
            <img ref={imgRef} src={item.content} alt={item.name} onClick={handleClick}
              style={{ transform: `scale(${scale})`, transformOrigin: `${origin.x}% ${origin.y}%`, cursor: scale >= 2.5 ? 'zoom-out' : 'zoom-in' }} />
          </div>
        ) : <div className="explorer-empty">{t(language, 'imageReadFailed')}</div>}
      </div>
    </WindowFrame>
  );
}
