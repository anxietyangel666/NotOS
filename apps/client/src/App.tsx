import { useCallback, useEffect, useState } from 'react';
import { api } from './api/client';
import { cacheUser } from './api/user-cache';
import type { AuthenticatedResponse, Language, PublicUser, Theme } from './api/types';
import type { AuthNotice } from './app-types';
import { clearToken, getStoredToken, storeToken } from './auth/session';
import { AuthGate } from './components/AuthGate';
import { Desktop } from './components/Desktop';
import { Onboarding } from './components/Onboarding';
import { PinLockScreen } from './components/PinLockScreen';
import { SocketProvider } from './components/SocketProvider';
import { TitleBar } from './components/TitleBar';
import { WelcomeOverlay } from './components/WelcomeOverlay';
import { getStoredLanguage, getStoredTheme, storeLanguage, storeTheme, t } from './i18n';
import { hasPin } from './utils/pin-lock';

export function App() {
  const [booting, setBooting] = useState(true);
  const [onboarding, setOnboarding] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<PublicUser | null>(null);
  const [notice, setNotice] = useState<AuthNotice | null>(null);
  const [pinLocked, setPinLocked] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);
  const [language, setLanguage] = useState<Language>(() => getStoredLanguage());
  const [theme, setTheme] = useState<Theme>(() => getStoredTheme());

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    storeTheme(theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.style.setProperty('--blue', user?.accentColor ?? '#2AABEE');
    document.documentElement.dataset.transparency = user?.transparencyEnabled === false ? 'off' : 'on';
  }, [user?.accentColor, user?.transparencyEnabled]);

  useEffect(() => {
    document.documentElement.lang = language;
    storeLanguage(language);
  }, [language]);

  useEffect(() => {
    const hasOnboarded = localStorage.getItem('notoc.onboarded');
    if (!hasOnboarded) {
      setOnboarding(true);
      setBooting(false);
      return;
    }

    const storedToken = getStoredToken();
    if (!storedToken) {
      setBooting(false);
      return;
    }

    let alive = true;

    api
      .me(storedToken)
      .then((result) => {
        if (!alive) return;
        setToken(storedToken);
        setUser(result.user);
        setLanguage(result.user.language);
        setTheme(result.user.theme);
        setPinLocked(hasPin(result.user.id));
      })
      .catch(() => {
        clearToken();
      })
      .finally(() => {
        if (alive) setBooting(false);
      });

    return () => {
      alive = false;
    };
  }, []);

  const handleAuthenticated = useCallback((result: AuthenticatedResponse, nextNotice?: AuthNotice, options?: { remember?: boolean }) => {
    const remember = options?.remember ?? true;
    storeToken(result.token, remember);
    setToken(result.token);
    setUser(result.user);
    cacheUser(result.user);
    setLanguage(result.user.language);
    setTheme(result.user.theme);
    setNotice(nextNotice ?? null);
    const locked = hasPin(result.user.id);
    setPinLocked(locked);
    // Greet immediately after sign-in. When a PIN is set the greeting is
    // deferred until the lock screen is cleared (see handlePinUnlock).
    setShowWelcome(!locked);
  }, []);

  const handleUserChange = useCallback((nextUser: PublicUser) => {
    setUser(nextUser);
    setLanguage(nextUser.language);
    setTheme(nextUser.theme);
  }, []);

  const handleLogout = useCallback(() => {
    clearToken();
    setToken(null);
    setUser(null);
    setNotice(null);
    setPinLocked(false);
    setShowWelcome(false);
  }, []);

  const handlePinUnlock = useCallback(() => {
    setPinLocked(false);
    setShowWelcome(true);
  }, []);

  const handleOnboardingComplete = useCallback((selectedLanguage: Language, selectedTheme: Theme) => {
    localStorage.setItem('notoc.onboarded', '1');
    setOnboarding(false);
    setLanguage(selectedLanguage);
    setTheme(selectedTheme);
  }, []);

  if (booting) {
    return (
      <>
        <TitleBar language={language} />
        <main className="boot-screen">
          <div className="boot-core" />
          <p>{t(language, 'loading')}</p>
        </main>
      </>
    );
  }

  if (onboarding) {
    return (
      <>
        <TitleBar language={language} />
        <Onboarding
          language={language}
          onLanguageChange={setLanguage}
          onComplete={handleOnboardingComplete}
        />
      </>
    );
  }

  if (!token || !user) {
    return (
      <>
        <TitleBar language={language} />
        <AuthGate language={language} theme={theme} onLanguageChange={setLanguage} onAuthenticated={handleAuthenticated} />
      </>
    );
  }

  if (pinLocked) {
    return (
      <>
        <TitleBar language={language} />
        <PinLockScreen
          language={language}
          user={user}
          onUnlock={handlePinUnlock}
          onSignOut={handleLogout}
        />
      </>
    );
  }

  return (
    <>
      <TitleBar language={language} />
      <SocketProvider token={token}>
        <Desktop
          token={token}
          user={user}
          language={language}
          notice={notice}
          onNoticeClose={() => setNotice(null)}
          onUserChange={handleUserChange}
          onLogout={handleLogout}
        />
        {showWelcome ? (
          <WelcomeOverlay language={language} user={user} onDone={() => setShowWelcome(false)} />
        ) : null}
      </SocketProvider>
    </>
  );
}
