import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { Language, PublicUser } from '../api/types';
import { t } from '../i18n';
import { nameStyleClass, nameStyleToCss } from '../utils/name-style';

type WelcomeOverlayProps = {
  language: Language;
  user: PublicUser;
  onDone: () => void;
};

// Full-screen greeting shown right after sign-in (or after unlocking the PIN
// lock). It plays the bundled Audio/Welcome.mp3 and auto-dismisses.
export function WelcomeOverlay({ language, user, onDone }: WelcomeOverlayProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const audio = new Audio(`${import.meta.env.BASE_URL}Audio/Welcome.mp3`);
    audioRef.current = audio;
    audio.volume = 0.15;
    // Playback can be blocked by autoplay policies; ignore failures silently.
    void audio.play().catch(() => undefined);

    const timer = window.setTimeout(onDone, 3200);
    return () => {
      window.clearTimeout(timer);
      audio.pause();
      audio.currentTime = 0;
    };
  }, [onDone]);

  return createPortal(
    <div className="welcome-overlay" onClick={onDone}>
      <div className="onboarding-aurora" aria-hidden="true">
        <span className="onboarding-aurora-blob a" />
        <span className="onboarding-aurora-blob b" />
        <span className="onboarding-aurora-blob c" />
      </div>
      <div className="welcome-card">
        <img className="welcome-avatar" src={user.avatarData} alt="" />
        <h1 className={`welcome-title ${nameStyleClass(user.nameStyle)}`} style={nameStyleToCss(user.nameStyle)}>
          {t(language, 'welcomeGreeting', { name: user.nickname })}
        </h1>
      </div>
    </div>,
    document.body
  );
}
