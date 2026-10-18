import { useState, useEffect, useRef } from 'react';
import type { Language, PublicUser } from '../api/types';

export type StickyColor = 'yellow' | 'pink' | 'blue' | 'green' | 'purple' | 'dark';

export type DesktopStickyNoteData = {
  id: string;
  text: string;
  color: StickyColor;
  x: number;
  y: number;
  width: number;
  height: number;
  pinned?: boolean;
  authorName?: string;
  createdAt: string;
};

const COLOR_MAP: Record<StickyColor, { bg: string; border: string; text: string; header: string }> = {
  yellow: {
    bg: 'linear-gradient(135deg, rgba(254, 240, 138, 0.95), rgba(253, 224, 71, 0.92))',
    border: 'rgba(234, 179, 8, 0.5)',
    text: '#422006',
    header: 'rgba(234, 179, 8, 0.35)'
  },
  pink: {
    bg: 'linear-gradient(135deg, rgba(251, 207, 232, 0.95), rgba(244, 114, 182, 0.92))',
    border: 'rgba(236, 72, 153, 0.5)',
    text: '#500724',
    header: 'rgba(236, 72, 153, 0.35)'
  },
  blue: {
    bg: 'linear-gradient(135deg, rgba(191, 219, 254, 0.95), rgba(96, 165, 250, 0.92))',
    border: 'rgba(59, 130, 246, 0.5)',
    text: '#172554',
    header: 'rgba(59, 130, 246, 0.35)'
  },
  green: {
    bg: 'linear-gradient(135deg, rgba(187, 247, 208, 0.95), rgba(74, 222, 128, 0.92))',
    border: 'rgba(34, 197, 94, 0.5)',
    text: '#052e16',
    header: 'rgba(34, 197, 94, 0.35)'
  },
  purple: {
    bg: 'linear-gradient(135deg, rgba(233, 213, 255, 0.95), rgba(192, 132, 252, 0.92))',
    border: 'rgba(168, 85, 247, 0.5)',
    text: '#3b0764',
    header: 'rgba(168, 85, 247, 0.35)'
  },
  dark: {
    bg: 'linear-gradient(135deg, rgba(30, 41, 59, 0.95), rgba(15, 23, 42, 0.95))',
    border: 'rgba(99, 102, 241, 0.5)',
    text: '#f1f5f9',
    header: 'rgba(99, 102, 241, 0.35)'
  }
};

const STICKIES_STORAGE_PREFIX = 'notoc.desktop.stickies.';

export function loadStickyNotes(userId: string): DesktopStickyNoteData[] {
  try {
    const raw = localStorage.getItem(`${STICKIES_STORAGE_PREFIX}${userId}`);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore parse error */
  }
  return [];
}

export function saveStickyNotes(userId: string, notes: DesktopStickyNoteData[]) {
  try {
    localStorage.setItem(`${STICKIES_STORAGE_PREFIX}${userId}`, JSON.stringify(notes));
  } catch {
    /* ignore storage quota */
  }
}

type StickyProps = {
  note: DesktopStickyNoteData;
  language: Language;
  onUpdate: (updated: DesktopStickyNoteData) => void;
  onDelete: (id: string) => void;
};

export function DesktopStickyNoteItem({ note, language, onUpdate, onDelete }: StickyProps) {
  const [isDragging, setIsDragging] = useState(false);
  const dragOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const theme = COLOR_MAP[note.color] || COLOR_MAP.yellow;

  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, textarea, input, select')) return;
    setIsDragging(true);
    dragOffsetRef.current = {
      x: e.clientX - note.x,
      y: e.clientY - note.y
    };
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const maxX = Math.max(10, window.innerWidth - note.width - 20);
      const maxY = Math.max(10, window.innerHeight - note.height - 50);
      const newX = Math.min(Math.max(10, e.clientX - dragOffsetRef.current.x), maxX);
      const newY = Math.min(Math.max(10, e.clientY - dragOffsetRef.current.y), maxY);
      onUpdate({ ...note, x: newX, y: newY });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, note, onUpdate]);

  const colors: StickyColor[] = ['yellow', 'pink', 'blue', 'green', 'purple', 'dark'];

  return (
    <div
      className={`desktop-sticky-note ${note.pinned ? 'is-pinned' : ''} ${isDragging ? 'is-dragging' : ''}`}
      style={{
        transform: `translate3d(${note.x}px, ${note.y}px, 0)`,
        width: `${note.width}px`,
        minHeight: `${note.height}px`,
        background: theme.bg,
        borderColor: theme.border,
        color: theme.text,
        boxShadow: isDragging
          ? '0 20px 40px rgba(0,0,0,0.35), 0 0 15px rgba(255,255,255,0.1)'
          : '0 8px 24px rgba(0,0,0,0.22)'
      }}
      onMouseDown={handleMouseDown}
    >
      <div className="desktop-sticky-header" style={{ borderBottomColor: theme.header }}>
        <div className="desktop-sticky-author">
          <svg className="sticky-pin-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 17v5M9 3h6l-1 7h3l-5 7-5-7h3L9 3z" />
          </svg>
          <span className="sticky-author-text">{note.authorName || (language === 'ru' ? 'Записка' : 'Sticky Note')}</span>
        </div>
        <div className="desktop-sticky-actions">
          <button
            type="button"
            className={`sticky-btn-pin ${note.pinned ? 'active' : ''}`}
            title={note.pinned ? (language === 'ru' ? 'Открепить' : 'Unpin') : (language === 'ru' ? 'Закрепить' : 'Pin')}
            onClick={() => onUpdate({ ...note, pinned: !note.pinned })}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill={note.pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 17v5M9 3h6l-1 7h3l-5 7-5-7h3L9 3z" />
            </svg>
          </button>
          <button
            type="button"
            className="sticky-btn-close"
            title={language === 'ru' ? 'Удалить стикер' : 'Delete note'}
            onClick={() => onDelete(note.id)}
          >
            ✕
          </button>
        </div>
      </div>

      <textarea
        className="desktop-sticky-body"
        value={note.text}
        placeholder={language === 'ru' ? 'Введите текст заметки...' : 'Type a note here...'}
        style={{ color: theme.text }}
        onChange={(e) => onUpdate({ ...note, text: e.target.value })}
        rows={6}
      />

      <div className="desktop-sticky-footer" style={{ borderTopColor: theme.header }}>
        <div className="sticky-color-palette">
          {colors.map((c) => (
            <button
              key={c}
              type="button"
              className={`sticky-color-dot color-${c} ${note.color === c ? 'selected' : ''}`}
              title={c}
              onClick={() => onUpdate({ ...note, color: c })}
            />
          ))}
        </div>
        <span className="sticky-date-label">
          {new Date(note.createdAt).toLocaleDateString([], { day: '2-digit', month: '2-digit' })}
        </span>
      </div>
    </div>
  );
}

export function DesktopStickyNotesLayer({
  currentUser,
  language,
  stickies,
  onStickiesChange
}: {
  currentUser: PublicUser;
  language: Language;
  stickies: DesktopStickyNoteData[];
  onStickiesChange: (notes: DesktopStickyNoteData[]) => void;
}) {
  const handleUpdate = (updated: DesktopStickyNoteData) => {
    const next = stickies.map((s) => (s.id === updated.id ? updated : s));
    onStickiesChange(next);
    saveStickyNotes(currentUser.id, next);
  };

  const handleDelete = (id: string) => {
    const next = stickies.filter((s) => s.id !== id);
    onStickiesChange(next);
    saveStickyNotes(currentUser.id, next);
  };

  return (
    <div className="desktop-stickies-container" style={{ pointerEvents: 'none', position: 'absolute', inset: 0, zIndex: 12 }}>
      {stickies.map((note) => (
        <div key={note.id} style={{ pointerEvents: 'auto' }}>
          <DesktopStickyNoteItem
            note={note}
            language={language}
            onUpdate={handleUpdate}
            onDelete={handleDelete}
          />
        </div>
      ))}
    </div>
  );
}
