import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { Language, PublicUser } from '../api/types';
import { t } from '../i18n';
import { getUserVolume, setUserVolume, USER_VOLUME_CHANGED_EVENT } from '../utils/user-volume';
import { UserName } from './UserName';

type Props = {
  user: PublicUser;
  anchor: { x: number; y: number };
  language: Language;
  onClose: () => void;
};

export function UserVolumePopover({ user, anchor, language, onClose }: Props) {
  const [volume, setVolume] = useState(() => getUserVolume(user.id));
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleVolumeChange = (e: Event) => {
      const detail = (e as CustomEvent<{ userId: string; volume: number }>).detail;
      if (detail && detail.userId === user.id) {
        setVolume(detail.volume);
      }
    };
    window.addEventListener(USER_VOLUME_CHANGED_EVENT, handleVolumeChange as EventListener);
    return () => window.removeEventListener(USER_VOLUME_CHANGED_EVENT, handleVolumeChange as EventListener);
  }, [user.id]);

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onMouseDown, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onMouseDown, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  // Clamp popover position so it stays fully inside the viewport
  const popoverWidth = 240;
  const popoverHeight = 110;
  const margin = 12;
  const x = Math.max(margin, Math.min(window.innerWidth - popoverWidth - margin, anchor.x));
  const y = Math.max(margin, Math.min(window.innerHeight - popoverHeight - margin, anchor.y));

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    setVolume(val);
    setUserVolume(user.id, val);
  };

  return createPortal(
    <div
      ref={popoverRef}
      className="user-volume-popover"
      style={{
        position: 'fixed',
        left: `${x}px`,
        top: `${y}px`,
        zIndex: 99999
      } as CSSProperties}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="user-volume-header">
        <div className="user-volume-user">
          <img className="user-volume-avatar" src={user.avatarData} alt="" />
          <div className="user-volume-name">
            <UserName user={user} />
          </div>
        </div>
      </div>

      <div className="user-volume-body">
        <div className="user-volume-label-row">
          <span className="user-volume-label">{t(language, 'userVolume')}</span>
          <span className={`user-volume-percent${volume === 0 ? ' muted' : ''}`}>{volume}%</span>
        </div>

        <div className="user-volume-slider-row">
          <input
            type="range"
            min={0}
            max={200}
            step={1}
            value={volume}
            onChange={handleSliderChange}
            className="user-volume-slider"
          />
        </div>
      </div>
    </div>,
    document.body
  );
}
