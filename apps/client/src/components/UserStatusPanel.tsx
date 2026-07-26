import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { Language, PublicUser } from '../api/types';
import { t } from '../i18n';
import { UserName } from './UserName';
import { PRESENCE_ORDER, type PresenceStatus, type VoiceSelfState } from '../utils/user-status';

type UserStatusPanelProps = {
  language: Language;
  user: PublicUser;
  status: PresenceStatus;
  voice: VoiceSelfState;
  // Anchor rect of the trigger so the panel pops up just above it (Discord-style).
  anchor: { left: number; bottom: number };
  triggerElement?: HTMLElement | null;
  onSelectStatus: (status: PresenceStatus) => void;
  onToggleMute: () => void;
  onToggleDeafen: () => void;
  onOpenVoiceSettings: () => void;
  statusOnly?: boolean;
  onClose: () => void;
};

const STATUS_LABEL_KEY: Record<PresenceStatus, 'statusOnline' | 'statusIdle' | 'statusDnd' | 'statusInvisible'> = {
  online: 'statusOnline',
  idle: 'statusIdle',
  dnd: 'statusDnd',
  invisible: 'statusInvisible'
};

const STATUS_DESC_KEY: Record<PresenceStatus, 'statusOnlineDesc' | 'statusIdleDesc' | 'statusDndDesc' | 'statusInvisibleDesc'> = {
  online: 'statusOnlineDesc',
  idle: 'statusIdleDesc',
  dnd: 'statusDndDesc',
  invisible: 'statusInvisibleDesc'
};

export function UserStatusPanel({
  language,
  user,
  status,
  voice,
  anchor,
  triggerElement,
  onSelectStatus,
  onToggleMute,
  onToggleDeafen,
  onOpenVoiceSettings,
  statusOnly = false,
  onClose
}: UserStatusPanelProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Dismiss on outside click / Escape.
  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (triggerElement?.contains(target)) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    // Defer so the opening click does not immediately close the panel.
    const id = window.setTimeout(() => {
      window.addEventListener('mousedown', onDown, true);
      window.addEventListener('keydown', onKey);
    }, 0);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose, triggerElement]);

  // The panel grows upward from the trigger; bottom edge sits just above it.
  const bottom = Math.max(8, window.innerHeight - anchor.bottom + 6);
  const left = Math.max(8, anchor.left);

  return createPortal(
    <div
      ref={panelRef}
      className={statusOnly ? 'user-status-panel status-only' : 'user-status-panel'}
      style={{ left, bottom }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {!statusOnly ? (
        <div className="user-status-panel-head">
          <div className="user-status-panel-avatar">
            <img src={user.avatarData} alt="" />
            <i className={`presence-dot lg status-${status}`} />
          </div>
          <UserName user={user} />
        </div>
      ) : null}

      <div className="user-status-panel-section">
        {PRESENCE_ORDER.map((option) => (
          <button
            key={option}
            type="button"
            className={option === status ? 'user-status-option active' : 'user-status-option'}
            onClick={() => onSelectStatus(option)}
          >
            <i className={`presence-dot status-${option}`} />
            <span className="user-status-option-text">
              <span className="user-status-option-label">{t(language, STATUS_LABEL_KEY[option])}</span>
              <span className="user-status-option-desc">{t(language, STATUS_DESC_KEY[option])}</span>
            </span>
          </button>
        ))}
      </div>

      {!statusOnly ? <div className="user-status-panel-divider" /> : null}

      {!statusOnly ? <div className="user-status-voice-bar">
        <button
          type="button"
          className={voice.muted ? 'voice-ctrl-btn danger' : 'voice-ctrl-btn'}
          title={voice.muted ? t(language, 'unmuteMic') : t(language, 'muteMic')}
          aria-pressed={voice.muted}
          onClick={onToggleMute}
        >
          {voice.muted ? (
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M2.7 3.7 1.3 5.1l8.7 8.7V14a2 2 0 0 0 2 2 2 2 0 0 0 .8-.2l1.5 1.5A6 6 0 0 1 6 12H4a8 8 0 0 0 7 7.9V22h2v-2.1a8 8 0 0 0 3.2-1.1l3.5 3.5 1.4-1.4L2.7 3.7zM14 11.2V5a2 2 0 0 0-4 0v2.2l4 4zM18 12a6 6 0 0 1-.5 2.4l1.5 1.5A8 8 0 0 0 20 12h-2z"/></svg>
          ) : (
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-3.1A7 7 0 0 0 19 11h-2z"/></svg>
          )}
        </button>
        <button
          type="button"
          className={voice.deafened ? 'voice-ctrl-btn danger' : 'voice-ctrl-btn'}
          title={voice.deafened ? t(language, 'undeafen') : t(language, 'deafen')}
          aria-pressed={voice.deafened}
          onClick={onToggleDeafen}
        >
          {voice.deafened ? (
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M2.7 3.7 1.3 5.1 4.4 8.2A9 9 0 0 0 3 13v4a3 3 0 0 0 3 3h1v-7H5v-1a7 7 0 0 1 .9-3.4l13 13 1.4-1.4L2.7 3.7zM12 4a9 9 0 0 1 9 9v4a3 3 0 0 1-1.6 2.6L17 17.2V13h2v-0a7 7 0 0 0-9.3-6.6L8.1 4.8A9 9 0 0 1 12 4z"/></svg>
          ) : (
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 3a9 9 0 0 0-9 9v5a3 3 0 0 0 3 3h1v-7H5v-1a7 7 0 0 1 14 0v1h-2v7h1a3 3 0 0 0 3-3v-5a9 9 0 0 0-9-9z"/></svg>
          )}
        </button>
        <button
          type="button"
          className="voice-ctrl-btn"
          title={t(language, 'voiceVideoSettings')}
          onClick={onOpenVoiceSettings}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M19.4 13a7.8 7.8 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-1.7-1l-.3-2.6h-4l-.3 2.6a7.6 7.6 0 0 0-1.7 1l-2.4-1-2 3.4L4.6 11a7.8 7.8 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 1.7 1l.3 2.6h4l.3-2.6a7.6 7.6 0 0 0 1.7-1l2.4 1 2-3.4-2-1.6zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"/></svg>
        </button>
      </div> : null}
    </div>,
    document.body
  );
}
