import { useState, useEffect, useRef } from 'react';
import type { Language, PublicUser } from '../api/types';
import { Twemoji } from './Twemoji';
import { LevelRing } from './LevelRing';

export type BestFriendWidgetData = {
  enabled: boolean;
  friendId: string | null;
  x: number;
  y: number;
};

export type ClockWeatherWidgetData = {
  enabled: boolean;
  x: number;
  y: number;
  city: string;
  unit: 'C' | 'F';
};

const BEST_FRIEND_STORAGE = 'notoc.desktop.widget.bestfriend.';
const CLOCK_WEATHER_STORAGE = 'notoc.desktop.widget.clock.';

export function loadBestFriendWidget(userId: string): BestFriendWidgetData {
  try {
    const raw = localStorage.getItem(`${BEST_FRIEND_STORAGE}${userId}`);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return { enabled: false, friendId: null, x: 80, y: 120 };
}

export function saveBestFriendWidget(userId: string, data: BestFriendWidgetData) {
  try {
    localStorage.setItem(`${BEST_FRIEND_STORAGE}${userId}`, JSON.stringify(data));
  } catch {
    /* ignore */
  }
}

export function loadClockWeatherWidget(userId: string): ClockWeatherWidgetData {
  try {
    const raw = localStorage.getItem(`${CLOCK_WEATHER_STORAGE}${userId}`);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return { enabled: false, x: window.innerWidth - 320, y: 80, city: 'Москва', unit: 'C' };
}

export function saveClockWeatherWidget(userId: string, data: ClockWeatherWidgetData) {
  try {
    localStorage.setItem(`${CLOCK_WEATHER_STORAGE}${userId}`, JSON.stringify(data));
  } catch {
    /* ignore */
  }
}

/* =========================================================================
   1. Best Friend Desktop Widget
   ========================================================================= */

type BestFriendWidgetProps = {
  currentUser: PublicUser;
  language: Language;
  friends: PublicUser[];
  onlineUserIds: string[] | Set<string>;
  config: BestFriendWidgetData;
  onUpdateConfig: (cfg: BestFriendWidgetData) => void;
  onOpenChat: (userId: string) => void;
  onStartCall: (user: PublicUser) => void;
  onOpenProfile: (user: PublicUser) => void;
  onClose: () => void;
};

export function DesktopBestFriendWidget({
  currentUser,
  language,
  friends,
  onlineUserIds,
  config,
  onUpdateConfig,
  onOpenChat,
  onStartCall,
  onOpenProfile,
  onClose
}: BestFriendWidgetProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isPickingFriend, setIsPickingFriend] = useState(!config.friendId);
  const dragOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const friend = friends.find((f) => f.id === config.friendId);
  const isOnline = friend ? (Array.isArray(onlineUserIds) ? onlineUserIds.includes(friend.id) : onlineUserIds.has(friend.id)) : false;

  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, input, select')) return;
    setIsDragging(true);
    dragOffsetRef.current = {
      x: e.clientX - config.x,
      y: e.clientY - config.y
    };
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const maxX = Math.max(10, window.innerWidth - 260);
      const maxY = Math.max(10, window.innerHeight - 200);
      const newX = Math.min(Math.max(10, e.clientX - dragOffsetRef.current.x), maxX);
      const newY = Math.min(Math.max(10, e.clientY - dragOffsetRef.current.y), maxY);
      onUpdateConfig({ ...config, x: newX, y: newY });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      saveBestFriendWidget(currentUser.id, config);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, config, onUpdateConfig, currentUser.id]);

  const selectFriend = (selectedId: string) => {
    const next = { ...config, friendId: selectedId };
    onUpdateConfig(next);
    saveBestFriendWidget(currentUser.id, next);
    setIsPickingFriend(false);
  };

  return (
    <div
      className={`desktop-widget desktop-widget-bestfriend ${isDragging ? 'is-dragging' : ''}`}
      style={{
        transform: `translate3d(${config.x}px, ${config.y}px, 0)`,
        position: 'absolute',
        zIndex: 11
      }}
      onMouseDown={handleMouseDown}
    >
      <div className="desktop-widget-header">
        <div className="desktop-widget-title">
          <span>{language === 'ru' ? 'Лучший друг' : 'Best Friend'}</span>
        </div>
        <div className="desktop-widget-header-actions">
          {friend ? (
            <button
              type="button"
              className="widget-icon-btn"
              title={language === 'ru' ? 'Сменить друга' : 'Change friend'}
              onClick={() => setIsPickingFriend((v) => !v)}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
              </svg>
            </button>
          ) : null}
          <button
            type="button"
            className="widget-icon-btn close-btn"
            title={language === 'ru' ? 'Закрыть виджет' : 'Close widget'}
            onClick={onClose}
          >
            ✕
          </button>
        </div>
      </div>

      {isPickingFriend || !friend ? (
        <div className="desktop-widget-picker">
          <p className="widget-picker-hint">
            {language === 'ru' ? 'Выберите близкого друга:' : 'Select your best friend:'}
          </p>
          <div className="widget-picker-list">
            {friends.length === 0 ? (
              <span className="widget-empty-text">{language === 'ru' ? 'Список друзей пуст' : 'No friends yet'}</span>
            ) : (
              friends.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className="widget-picker-item"
                  onClick={() => selectFriend(f.id)}
                >
                  <img src={f.avatarData} alt="" className="widget-picker-avatar" />
                  <span className="widget-picker-name">{f.nickname}</span>
                </button>
              ))
            )}
          </div>
        </div>
      ) : (
        <div className="desktop-widget-friend-content">
          <div className="widget-friend-main" onClick={() => onOpenProfile(friend)}>
            <div className="widget-friend-avatar-wrap">
              <img src={friend.avatarData} alt="" className="widget-friend-avatar" />
              <LevelRing xp={friend.xp || 0} language={language} />
              <span className={`widget-friend-presence ${isOnline ? 'online' : 'offline'}`} />
            </div>
            <div className="widget-friend-meta">
              <span className="widget-friend-name">{friend.nickname}</span>
              <span className="widget-friend-status">
                {isOnline
                  ? (friend.status ? friend.status : (language === 'ru' ? 'В сети' : 'Online'))
                  : (language === 'ru' ? 'Не в сети' : 'Offline')}
              </span>
            </div>
          </div>

          <div className="widget-friend-quick-actions">
            <button
              type="button"
              className="widget-quick-btn chat-btn"
              title={language === 'ru' ? 'Написать' : 'Chat'}
              onClick={() => onOpenChat(friend.id)}
            >
              {language === 'ru' ? 'Чат' : 'Chat'}
            </button>
            <button
              type="button"
              className="widget-quick-btn call-btn"
              title={language === 'ru' ? 'Позвонить' : 'Call'}
              onClick={() => onStartCall(friend)}
            >
              {language === 'ru' ? 'Звонок' : 'Call'}
            </button>
            <button
              type="button"
              className="widget-quick-btn profile-btn"
              title={language === 'ru' ? 'Профиль' : 'Profile'}
              onClick={() => onOpenProfile(friend)}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* =========================================================================
   2. Clock & Weather Desktop Widget
   ========================================================================= */

type ClockWeatherWidgetProps = {
  currentUser: PublicUser;
  language: Language;
  config: ClockWeatherWidgetData;
  onUpdateConfig: (cfg: ClockWeatherWidgetData) => void;
  onClose: () => void;
};

export function DesktopClockWeatherWidget({
  currentUser,
  language,
  config,
  onUpdateConfig,
  onClose
}: ClockWeatherWidgetProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [time, setTime] = useState(new Date());
  const [editingCity, setEditingCity] = useState(false);
  const [cityInput, setCityInput] = useState(config.city);
  const dragOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, input, select')) return;
    setIsDragging(true);
    dragOffsetRef.current = {
      x: e.clientX - config.x,
      y: e.clientY - config.y
    };
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const maxX = Math.max(10, window.innerWidth - 280);
      const maxY = Math.max(10, window.innerHeight - 200);
      const newX = Math.min(Math.max(10, e.clientX - dragOffsetRef.current.x), maxX);
      const newY = Math.min(Math.max(10, e.clientY - dragOffsetRef.current.y), maxY);
      onUpdateConfig({ ...config, x: newX, y: newY });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      saveClockWeatherWidget(currentUser.id, config);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, config, onUpdateConfig, currentUser.id]);

  const hours = time.getHours().toString().padStart(2, '0');
  const minutes = time.getMinutes().toString().padStart(2, '0');
  const seconds = time.getSeconds().toString().padStart(2, '0');

  const greeting = (() => {
    const h = time.getHours();
    if (language === 'ru') {
      if (h >= 5 && h < 12) return 'Доброе утро';
      if (h >= 12 && h < 18) return 'Добрый день';
      if (h >= 18 && h < 23) return 'Добрый вечер';
      return 'Доброй ночи';
    }
    if (h >= 5 && h < 12) return 'Good morning';
    if (h >= 12 && h < 18) return 'Good afternoon';
    if (h >= 18 && h < 23) return 'Good evening';
    return 'Good night';
  })();

  const dateStr = time.toLocaleDateString(language === 'ru' ? 'ru-RU' : 'en-US', {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  });

  const tempVal = config.unit === 'C' ? '+21°C' : '+70°F';

  const handleSaveCity = () => {
    const next = { ...config, city: cityInput.trim() || 'Москва' };
    onUpdateConfig(next);
    saveClockWeatherWidget(currentUser.id, next);
    setEditingCity(false);
  };

  const toggleUnit = () => {
    const next = { ...config, unit: (config.unit === 'C' ? 'F' : 'C') as 'C' | 'F' };
    onUpdateConfig(next);
    saveClockWeatherWidget(currentUser.id, next);
  };

  return (
    <div
      className={`desktop-widget desktop-widget-clock ${isDragging ? 'is-dragging' : ''}`}
      style={{
        transform: `translate3d(${config.x}px, ${config.y}px, 0)`,
        position: 'absolute',
        zIndex: 11
      }}
      onMouseDown={handleMouseDown}
    >
      <div className="desktop-widget-header">
        <div className="desktop-widget-title">
          <span className="widget-greeting">{greeting}, {currentUser.nickname}!</span>
        </div>
        <button
          type="button"
          className="widget-icon-btn close-btn"
          title={language === 'ru' ? 'Закрыть виджет' : 'Close widget'}
          onClick={onClose}
        >
          ✕
        </button>
      </div>

      <div className="desktop-widget-clock-body">
        <div className="clock-digits-display">
          <span className="clock-digits-main">{hours}:{minutes}</span>
          <span className="clock-digits-seconds">{seconds}</span>
        </div>
        <div className="clock-date-line">{dateStr}</div>

        <div className="clock-weather-row">
          <div className="weather-icon-temp" onClick={toggleUnit} title="Нажмите, чтобы сменить °C / °F">
            <svg className="weather-icon-svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ color: '#facc15' }}>
              <circle cx="12" cy="12" r="5" />
              <line x1="12" y1="1" x2="12" y2="3" />
              <line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1" y1="12" x2="3" y2="12" />
              <line x1="21" y1="12" x2="23" y2="12" />
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
            <span className="weather-temp">{tempVal}</span>
          </div>

          <div className="weather-location-container">
            {editingCity ? (
              <div className="weather-city-input-wrap">
                <input
                  type="text"
                  className="weather-city-input"
                  value={cityInput}
                  onChange={(e) => setCityInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveCity()}
                  autoFocus
                />
                <button type="button" className="weather-city-ok" onClick={handleSaveCity}>OK</button>
              </div>
            ) : (
              <span
                className="weather-city-label"
                onClick={() => setEditingCity(true)}
                title={language === 'ru' ? 'Нажмите, чтобы изменить город' : 'Click to change city'}
              >
                {config.city}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
