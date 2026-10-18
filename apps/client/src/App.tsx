import { useCallback, useEffect, useState } from 'react';
import { api, getApiBaseUrl } from './api/client';
import { cacheCurrentUser, clearCachedCurrentUser, loadCachedCurrentUser } from './api/user-cache';
import type { AuthenticatedResponse, Language, PublicUser, Theme } from './api/types';
import type { AuthNotice } from './app-types';
import { clearToken, getStoredToken, storeToken } from './auth/session';
import { AuthGate } from './components/AuthGate';
import { Desktop } from './components/Desktop';
import { DetachedMessenger } from './components/DetachedMessenger';
import { Onboarding } from './components/Onboarding';
import { PinLockScreen } from './components/PinLockScreen';
import { SocketProvider } from './components/SocketProvider';
import { TitleBar } from './components/TitleBar';
import { WelcomeOverlay } from './components/WelcomeOverlay';
import { getStoredLanguage, getStoredTheme, storeLanguage, storeTheme, t } from './i18n';
import { assetUrl } from './utils/assets';
import { checkClientUpdate, checkServerConnection } from './utils/client-update';
import { hasPin } from './utils/pin-lock';

export function App() {
  const [booting, setBooting] = useState(true);
  const [bootStatus, setBootStatus] = useState<'starting' | 'connection' | 'updates' | 'account' | 'ready'>('starting');
  const [onboarding, setOnboarding] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<PublicUser | null>(null);
  const [notice, setNotice] = useState<AuthNotice | null>(null);
  const [pinLocked, setPinLocked] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);
  const [language, setLanguage] = useState<Language>(() => getStoredLanguage());
  const [theme, setTheme] = useState<Theme>(() => getStoredTheme());

  const isMessengerWindow = typeof window !== 'undefined' && (
    new URLSearchParams(window.location.search).get('window') === 'messenger'
    || window.location.hash.includes('window=messenger')
  );

  useEffect(() => {
    if (isMessengerWindow) {
      document.title = 'NotOS Messenger';
    }
  }, [isMessengerWindow]);

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
    let alive = true;
    const timers: number[] = [];

    function applyAuthenticatedUser(storedToken: string, nextUser: PublicUser) {
      setToken(storedToken);
      setUser(nextUser);
      setLanguage(nextUser.language);
      setTheme(nextUser.theme);
      setPinLocked(hasPin(nextUser.id));
    }

    async function refreshStoredAccount(storedToken: string) {
      try {
        const result = await api.me(storedToken);
        if (!alive) return;
        applyAuthenticatedUser(storedToken, result.user);
        cacheCurrentUser(result.user);
      } catch {
        if (!alive) return;
        clearToken();
        clearCachedCurrentUser();
        setToken(null);
        setUser(null);
      }
    }

    async function boot() {
      const queryToken = new URLSearchParams(window.location.search).get('token');
      if (queryToken && !getStoredToken()) {
        storeToken(queryToken, true);
      }
      const storedToken = queryToken || getStoredToken();
      const hasOnboarded = localStorage.getItem('notoc.onboarded') || Boolean(storedToken);
      if (!hasOnboarded) {
        setOnboarding(true);
        setBootStatus('ready');
        setBooting(false);
        return;
      }

      if (!storedToken) {
        setBootStatus('ready');
        setBooting(false);
        return;
      }

      void window.notoc?.setServerUrl?.(getApiBaseUrl());
      void checkClientUpdate();

      setBootStatus('account');
      const cachedUser = loadCachedCurrentUser();
      if (cachedUser) {
        applyAuthenticatedUser(storedToken, cachedUser);
        setBootStatus('ready');
        setBooting(false);
        void checkServerConnection().catch(() => undefined);
        const refreshTimer = window.setTimeout(() => {
          void refreshStoredAccount(storedToken);
        }, 2500);
        timers.push(refreshTimer);
        return;
      }

      await refreshStoredAccount(storedToken);
      if (!alive) return;
      setBootStatus('ready');
      setBooting(false);
    }

    void boot();

    return () => {
      alive = false;
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  const handleAuthenticated = useCallback((result: AuthenticatedResponse, nextNotice?: AuthNotice, options?: { remember?: boolean }) => {
    const remember = options?.remember ?? true;
    storeToken(result.token, remember);
    setToken(result.token);
    setUser(result.user);
    cacheCurrentUser(result.user);
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
    cacheCurrentUser(nextUser);
    setLanguage(nextUser.language);
    setTheme(nextUser.theme);
  }, []);

  const handleLogout = useCallback(() => {
    clearToken();
    clearCachedCurrentUser();
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
    const bootLabel =
      bootStatus === 'connection' ? t(language, 'bootCheckingConnection')
      : bootStatus === 'updates' ? t(language, 'bootCheckingUpdates')
      : bootStatus === 'account' ? t(language, 'bootSigningIn')
      : t(language, 'bootStarting');
    return (
      <>
        <TitleBar language={language} />
        <main className="boot-screen">
          <section className="boot-card" aria-live="polite">
            <img className="boot-app-icon" src={assetUrl('Emoji/app-icon.png')} alt="" />
            <strong>{t(language, 'appName')}</strong>
            <div className="boot-progress" aria-hidden="true">
              <span />
            </div>
            <p>{bootLabel}</p>
          </section>
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

  if (isMessengerWindow && token && user) {
    const searchParams = new URLSearchParams(window.location.search);
    const initialChatUserId = searchParams.get('userId');
    const initialGroupId = searchParams.get('groupId');
    return (
      <SocketProvider token={token}>
        <DetachedMessenger
          token={token}
          language={language}
          currentUser={user}
          onUserChange={handleUserChange}
          onLogout={handleLogout}
          initialChatUserId={initialChatUserId}
          initialGroupId={initialGroupId}
        />
      </SocketProvider>
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
