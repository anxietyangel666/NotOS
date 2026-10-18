import { useState, useEffect } from 'react';
import type { Language } from '../api/types';

export type TimeCapsuleData = {
  unlockAt: string;
  title?: string;
  content: string;
  isUnlocked: boolean;
};

export function parseTimeCapsule(text: string): TimeCapsuleData | null {
  if (!text || !text.startsWith('[time-capsule')) return null;
  const match = text.match(/^\[time-capsule\s+unlock="([^"]+)"(?:\s+title="([^"]*)")?\]([\s\S]*?)\[\/time-capsule\]$/);
  if (!match) return null;
  const unlockAt = match[1];
  const title = match[2] || undefined;
  const content = match[3];
  const isUnlocked = new Date(unlockAt).getTime() <= Date.now();
  return { unlockAt, title, content, isUnlocked };
}

export function formatTimeCapsuleTag(content: string, unlockAt: string, title?: string): string {
  const safeTitle = title ? ` title="${title.replace(/"/g, '&quot;')}"` : '';
  return `[time-capsule unlock="${unlockAt}"${safeTitle}]${content}[/time-capsule]`;
}

type TimeCapsuleCardProps = {
  data: TimeCapsuleData;
  language: Language;
  onUnlocked?: () => void;
};

export function TimeCapsuleCard({ data, language, onUnlocked }: TimeCapsuleCardProps) {
  const [timeLeft, setTimeLeft] = useState<{ days: number; hours: number; minutes: number; seconds: number; isPast: boolean }>(() => {
    const diff = new Date(data.unlockAt).getTime() - Date.now();
    if (diff <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0, isPast: true };
    const s = Math.floor(diff / 1000);
    return {
      days: Math.floor(s / 86400),
      hours: Math.floor((s % 86400) / 3600),
      minutes: Math.floor((s % 3600) / 60),
      seconds: s % 60,
      isPast: false
    };
  });

  useEffect(() => {
    if (timeLeft.isPast) return;

    const timer = setInterval(() => {
      const diff = new Date(data.unlockAt).getTime() - Date.now();
      if (diff <= 0) {
        setTimeLeft({ days: 0, hours: 0, minutes: 0, seconds: 0, isPast: true });
        clearInterval(timer);
        onUnlocked?.();
      } else {
        const s = Math.floor(diff / 1000);
        setTimeLeft({
          days: Math.floor(s / 86400),
          hours: Math.floor((s % 86400) / 3600),
          minutes: Math.floor((s % 3600) / 60),
          seconds: s % 60,
          isPast: false
        });
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [data.unlockAt, timeLeft.isPast, onUnlocked]);

  const unlockDateStr = new Date(data.unlockAt).toLocaleString(language === 'ru' ? 'ru-RU' : 'en-US', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  if (timeLeft.isPast || data.isUnlocked) {
    return (
      <div className="time-capsule-card unlocked">
        <div className="time-capsule-badge">
          <span>{language === 'ru' ? 'Капсула времени открыта!' : 'Time Capsule Unlocked!'}</span>
        </div>
        {data.title ? <h4 className="time-capsule-title">«{data.title}»</h4> : null}
        <div className="time-capsule-revealed-content">
          {data.content}
        </div>
        <div className="time-capsule-date-tag">
          {language === 'ru' ? `Открылась: ${unlockDateStr}` : `Opened: ${unlockDateStr}`}
        </div>
      </div>
    );
  }

  const pad = (n: number) => n.toString().padStart(2, '0');

  return (
    <div className="time-capsule-card locked">
      <div className="time-capsule-holo-glow" />
      <div className="time-capsule-header">
        <svg className="time-capsule-lock-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        <div className="time-capsule-info">
          <h4 className="time-capsule-heading">
            {data.title ? `«${data.title}»` : (language === 'ru' ? 'Капсула времени' : 'Time Capsule')}
          </h4>
          <span className="time-capsule-subtext">
            {language === 'ru' ? 'Запечатано во времени' : 'Sealed in time'}
          </span>
        </div>
      </div>

      <div className="time-capsule-countdown">
        <span className="countdown-label">
          {language === 'ru' ? 'Откроется через:' : 'Opens in:'}
        </span>
        <div className="countdown-timer">
          {timeLeft.days > 0 ? (
            <div className="countdown-unit">
              <span className="countdown-val">{timeLeft.days}</span>
              <span className="countdown-unit-name">{language === 'ru' ? 'дн' : 'd'}</span>
            </div>
          ) : null}
          <div className="countdown-unit">
            <span className="countdown-val">{pad(timeLeft.hours)}</span>
            <span className="countdown-unit-name">{language === 'ru' ? 'ч' : 'h'}</span>
          </div>
          <span className="countdown-sep">:</span>
          <div className="countdown-unit">
            <span className="countdown-val">{pad(timeLeft.minutes)}</span>
            <span className="countdown-unit-name">{language === 'ru' ? 'мин' : 'm'}</span>
          </div>
          <span className="countdown-sep">:</span>
          <div className="countdown-unit">
            <span className="countdown-val">{pad(timeLeft.seconds)}</span>
            <span className="countdown-unit-name">{language === 'ru' ? 'сек' : 's'}</span>
          </div>
        </div>
      </div>

      <div className="time-capsule-footer">
        <span className="time-capsule-unlock-date">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ verticalAlign: 'middle', marginRight: 4 }}>
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          {language === 'ru' ? `Дата вскрытия: ${unlockDateStr}` : `Unlock date: ${unlockDateStr}`}
        </span>
      </div>
    </div>
  );
}

type TimeCapsuleModalProps = {
  language: Language;
  recipientName: string;
  onClose: () => void;
  onSend: (unlockAt: string, title?: string) => void;
};

export function TimeCapsuleModal({ language, recipientName, onClose, onSend }: TimeCapsuleModalProps) {
  const [choice, setChoice] = useState<'1d' | '3d' | '1w' | '1m' | 'newyear' | 'custom'>('1d');
  const [customDateTime, setCustomDateTime] = useState('');
  const [title, setTitle] = useState('');

  const calculateUnlockDate = (): Date | null => {
    const now = new Date();
    if (choice === '1d') {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      return d;
    }
    if (choice === '3d') {
      const d = new Date();
      d.setDate(d.getDate() + 3);
      d.setHours(12, 0, 0, 0);
      return d;
    }
    if (choice === '1w') {
      const d = new Date();
      d.setDate(d.getDate() + 7);
      d.setHours(12, 0, 0, 0);
      return d;
    }
    if (choice === '1m') {
      const d = new Date();
      d.setMonth(d.getMonth() + 1);
      d.setHours(12, 0, 0, 0);
      return d;
    }
    if (choice === 'newyear') {
      const nextYear = now.getFullYear() + 1;
      return new Date(nextYear, 0, 1, 0, 0, 0, 0);
    }
    if (customDateTime) {
      const parsed = new Date(customDateTime);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    return null;
  };

  const handleConfirm = () => {
    const unlock = calculateUnlockDate();
    if (!unlock || unlock.getTime() <= Date.now() + 30_000) {
      alert(language === 'ru' ? 'Выберите дату в будущем (минимум через минуту)' : 'Please pick a future time');
      return;
    }
    onSend(unlock.toISOString(), title.trim() || undefined);
  };

  return (
    <div className="messenger-inline-modal time-capsule-modal-layer" onClick={onClose}>
      <div className="time-capsule-modal" onClick={(e) => e.stopPropagation()}>
        <div className="time-capsule-modal-header">
          <div className="time-capsule-icon-wrap">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>
          <div className="time-capsule-header-text">
            <h3>{language === 'ru' ? 'Капсула времени' : 'Time Capsule'}</h3>
            <p>{language === 'ru' ? `Запечатайте послание для ${recipientName}` : `Seal a secret message for ${recipientName}`}</p>
          </div>
          <button type="button" className="time-capsule-modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="time-capsule-modal-body">
          <label className="time-capsule-label">
            {language === 'ru' ? 'Название или повод (необязательно):' : 'Capsule Title / Hint (optional):'}
          </label>
          <input
            type="text"
            className="messenger-input time-capsule-title-input"
            placeholder={language === 'ru' ? 'Например: Открыть на день рождения' : 'e.g. Open on Birthday'}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={60}
          />

          <label className="time-capsule-label">
            {language === 'ru' ? 'Когда вскрыть капсулу?' : 'When should the capsule unlock?'}
          </label>
          <div className="time-capsule-presets-grid">
            {[
              ['1d', language === 'ru' ? 'Завтра утром (09:00)' : 'Tomorrow morning'],
              ['3d', language === 'ru' ? 'Через 3 дня' : 'In 3 days'],
              ['1w', language === 'ru' ? 'Через 1 неделю' : 'In 1 week'],
              ['1m', language === 'ru' ? 'Через 1 месяц' : 'In 1 month'],
              ['newyear', language === 'ru' ? 'На Новый Год' : 'On New Year'],
              ['custom', language === 'ru' ? 'Выбрать дату...' : 'Custom date...']
            ].map(([val, label]) => (
              <button
                key={val}
                type="button"
                className={`time-capsule-preset-btn ${choice === val ? 'selected' : ''}`}
                onClick={() => setChoice(val as typeof choice)}
              >
                {label}
              </button>
            ))}
          </div>

          {choice === 'custom' ? (
            <div className="time-capsule-custom-date">
              <input
                type="datetime-local"
                className="messenger-input time-capsule-date-picker"
                value={customDateTime}
                onChange={(e) => setCustomDateTime(e.target.value)}
              />
            </div>
          ) : null}

          <div className="time-capsule-preview-hint">
            {language === 'ru'
              ? 'Содержимое текущего сообщения и прикрепленные файлы будут надежно спрятаны до указанного момента.'
              : 'The message and attachments will stay sealed and hidden until the unlock date arrives.'}
          </div>
        </div>

        <div className="time-capsule-modal-footer">
          <button type="button" className="secondary-action" onClick={onClose}>
            {language === 'ru' ? 'Отмена' : 'Cancel'}
          </button>
          <button type="button" className="primary-action time-capsule-submit-btn" onClick={handleConfirm}>
            {language === 'ru' ? 'Запечатать и отправить' : 'Seal & Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
