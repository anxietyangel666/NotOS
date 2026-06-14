import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Language, NameStyle, PublicUser } from '../api/types';
import { LOCALES, t } from '../i18n';
import { UserBadges } from './UserBadges';
import {
  DEFAULT_NAME_STYLE,
  NAME_STYLE_COLORS,
  NAME_STYLE_EFFECTS,
  NAME_STYLE_FONTS,
  nameStyleClass,
  nameStyleToCss
} from '../utils/name-style';

const RECENT_NAME_COLORS_KEY = 'notoc.name-style.recent-colors';

function bannerBackground(value: string, theme: string) {
  const isDark = theme === 'dark' || theme === 'system-black';
  if (!value) {
    return isDark
      ? 'linear-gradient(135deg, #111827 0%, #172033 48%, #0b1220 100%)'
      : 'linear-gradient(135deg, #dff1ff 0%, #f7fbff 48%, #e8f0f8 100%)';
  }
  if (value.startsWith('data:image/')) return `url("${value}")`;
  return value;
}

function loadRecentColors(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_NAME_COLORS_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.slice(0, 6) : [];
  } catch {
    return [];
  }
}

type NameStyleModalProps = {
  language: Language;
  user: PublicUser;
  initialStyle: NameStyle;
  zIndex?: number;
  onCancel: () => void;
  onAccept: (style: NonNullable<NameStyle>) => void;
};

export function NameStyleModal({ language, user, initialStyle, zIndex, onCancel, onAccept }: NameStyleModalProps) {
  const [font, setFont] = useState(initialStyle?.font ?? DEFAULT_NAME_STYLE.font);
  const [effect, setEffect] = useState(initialStyle?.effect ?? DEFAULT_NAME_STYLE.effect);
  const [color, setColor] = useState(initialStyle?.color ?? DEFAULT_NAME_STYLE.color);
  const [recentColors, setRecentColors] = useState<string[]>(loadRecentColors);
  const colorInputRef = useRef<HTMLInputElement | null>(null);

  const draftStyle: NonNullable<NameStyle> = { font, effect, color };

  function formatDate(value: string) {
    return new Intl.DateTimeFormat(LOCALES[language], { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(value));
  }

  function rememberColor(value: string) {
    setRecentColors((current) => {
      const next = [value, ...current.filter((c) => c.toLowerCase() !== value.toLowerCase())].slice(0, 6);
      localStorage.setItem(RECENT_NAME_COLORS_KEY, JSON.stringify(next));
      return next;
    });
  }

  function handleAccept() {
    rememberColor(color);
    onAccept(draftStyle);
  }

  return createPortal(
    <div
      className="modal-backdrop important name-style-backdrop"
      style={zIndex !== undefined ? { zIndex } : undefined}
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section className="name-style-modal" onClick={(event) => event.stopPropagation()}>
        <header className="name-style-head">
          <h2>{t(language, 'nameStyleTitle')}</h2>
        </header>

        <div className="name-style-body">
          <div className="name-style-settings">
            <div className="name-style-group">
              <p className="field-label compact">{t(language, 'nameStyleChooseFont')}</p>
              <div className="name-style-font-grid">
                {NAME_STYLE_FONTS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={font === item.id ? 'name-style-font-tile active' : 'name-style-font-tile'}
                    style={{ fontFamily: item.fontFamily }}
                    onClick={() => setFont(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="name-style-group">
              <p className="field-label compact">{t(language, 'nameStyleChooseEffect')}</p>
              <div className="name-style-effect-grid">
                {NAME_STYLE_EFFECTS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={effect === item.id ? 'name-style-effect-tile active' : 'name-style-effect-tile'}
                    onClick={() => setEffect(item.id)}
                  >
                    <span className={nameStyleClass({ font, effect: item.id, color })} style={nameStyleToCss({ font, effect: item.id, color })}>{item.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="name-style-group">
              <p className="field-label compact">{t(language, 'nameStyleChooseColour')}</p>
              <div className="name-style-color-row">
                <button
                  type="button"
                  className="name-style-color-custom"
                  style={{ background: color }}
                  title={t(language, 'customColor')}
                  onClick={() => colorInputRef.current?.click()}
                >
                  <span className="name-style-color-custom-plus">+</span>
                  <input
                    ref={colorInputRef}
                    type="color"
                    value={color}
                    className="name-style-color-native"
                    onChange={(event) => setColor(event.target.value)}
                  />
                </button>
                {recentColors.length > 0 ? (
                  <div className="name-style-recent">
                    {recentColors.map((value) => (
                      <button
                        key={value}
                        type="button"
                        className="name-style-color-tile"
                        style={{ background: value }}
                        onClick={() => setColor(value)}
                      />
                    ))}
                  </div>
                ) : null}
                <div className="name-style-color-grid">
                  {NAME_STYLE_COLORS.map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={color.toLowerCase() === value.toLowerCase() ? 'name-style-color-tile active' : 'name-style-color-tile'}
                      style={{ background: value }}
                      onClick={() => setColor(value)}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="name-style-preview">
            <p className="field-label compact">{t(language, 'nameStylePreview')}</p>

            <div
              className="profile-modal-card profile-themed name-style-profile-card"
              style={{
                ['--profile-primary' as string]: user.profilePrimaryColor || '#2AABEE',
                ['--profile-accent' as string]: user.profileAccentColor || '#5865F2'
              }}
            >
              <div
                className="profile-banner"
                style={{ backgroundImage: bannerBackground(user.wallpaper, user.theme), height: 76 }}
              />
              <div className="profile-body">
                <div className="profile-main">
                  <div className="profile-avatar-wrap">
                    <img src={user.avatarData} alt="" />
                    <span className="profile-presence online" />
                  </div>
                  <div className="profile-info">
                    <div className="profile-name-row">
                      <h3 className={nameStyleClass(draftStyle)} style={nameStyleToCss(draftStyle)}>{user.nickname}</h3>
                      <small className="profile-state online">{t(language, 'online')}</small>
                    </div>
                    <UserBadges user={user} language={language} />
                    {user.status ? <p className="profile-status">{user.status}</p> : null}
                    <div className="profile-dates">
                      <small>{t(language, 'memberSince')}: {formatDate(user.createdAt)}</small>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="name-style-preview-message">
              <img src={user.avatarData} alt="" />
              <div className="name-style-preview-bubble">
                <strong className={nameStyleClass(draftStyle)} style={nameStyleToCss(draftStyle)}>{user.nickname}</strong>
                <p>Helllo World!</p>
              </div>
            </div>
            <div className="name-style-preview-identity">
              <img src={user.avatarData} alt="" />
              <strong className={nameStyleClass(draftStyle)} style={nameStyleToCss(draftStyle)}>{user.nickname}</strong>
            </div>
          </div>
        </div>

        <footer className="name-style-actions">
          <button className="secondary-action" type="button" onClick={onCancel}>
            {t(language, 'cancel')}
          </button>
          <button className="primary-action" type="button" onClick={handleAccept}>
            {t(language, 'accept')}
          </button>
        </footer>
      </section>
    </div>,
    document.body
  );
}
