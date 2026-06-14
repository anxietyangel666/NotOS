import { useEffect, useState } from 'react';
import type { Language } from '../api/types';
import { t } from '../i18n';

type AvatarCropperProps = {
  imageDataUrl: string;
  language: Language;
  onCancel: () => void;
  onApply: (avatarData: string) => void;
};

async function cropAvatar(imageDataUrl: string, zoom: number, offsetX: number, offsetY: number) {
  const image = new Image();
  image.src = imageDataUrl;
  await image.decode();

  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');

  if (!context) return imageDataUrl;

  context.clearRect(0, 0, size, size);
  context.save();
  context.beginPath();
  context.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  context.clip();

  const baseScale = Math.max(size / image.width, size / image.height) * zoom;
  const drawWidth = image.width * baseScale;
  const drawHeight = image.height * baseScale;
  const previewToCanvas = size / 190;
  const drawX = (size - drawWidth) / 2 + offsetX * previewToCanvas;
  const drawY = (size - drawHeight) / 2 + offsetY * previewToCanvas;

  context.drawImage(image, drawX, drawY, drawWidth, drawHeight);
  context.restore();

  return canvas.toDataURL('image/png');
}

export function AvatarCropper({ imageDataUrl, language, onCancel, onApply }: AvatarCropperProps) {
  const [zoom, setZoom] = useState(1.15);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [drag, setDrag] = useState<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!drag) return;
    const currentDrag = drag;

    function move(event: MouseEvent) {
      setOffsetX(Math.max(-130, Math.min(130, currentDrag.baseX + event.clientX - currentDrag.startX)));
      setOffsetY(Math.max(-130, Math.min(130, currentDrag.baseY + event.clientY - currentDrag.startY)));
    }

    function up() {
      setDrag(null);
    }

    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up, { once: true });

    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [drag]);

  async function applyCrop() {
    setBusy(true);
    try {
      onApply(await cropAvatar(imageDataUrl, zoom, offsetX, offsetY));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop important" onClick={onCancel}>
      <section className="avatar-crop-window" onClick={(event) => event.stopPropagation()}>
        <div className="window-header">
          <div>
            <p className="eyebrow">Avatar</p>
            <h2>{t(language, 'avatarCropTitle')}</h2>
          </div>
          <button className="icon-action" type="button" onClick={onCancel}>
            x
          </button>
        </div>

        <p className="settings-hint">{t(language, 'avatarCropHint')}</p>

        <div className="avatar-crop-stage">
          <div
            className={drag ? 'avatar-crop-circle dragging' : 'avatar-crop-circle'}
            onMouseDown={(event) => {
              event.preventDefault();
              setDrag({ startX: event.clientX, startY: event.clientY, baseX: offsetX, baseY: offsetY });
            }}
          >
            <img
              src={imageDataUrl}
              alt=""
              style={{
                transform: `translate(${offsetX}px, ${offsetY}px) scale(${zoom})`
              }}
              draggable={false}
            />
          </div>
        </div>

        <div className="crop-controls">
          <label>
            <span>{t(language, 'zoom')}</span>
            <input type="range" min="1" max="3" step="0.01" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} />
          </label>
        </div>

        <div className="settings-actions">
          <button className="secondary-action" type="button" onClick={onCancel}>
            {t(language, 'cancel')}
          </button>
          <button className="primary-action" type="button" disabled={busy} onClick={() => void applyCrop()}>
            {busy ? t(language, 'saving') : t(language, 'apply')}
          </button>
        </div>
      </section>
    </div>
  );
}
