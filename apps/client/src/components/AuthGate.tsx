import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api/client';
import type { AuthenticatedResponse, Language, Theme } from '../api/types';
import type { AuthNotice } from '../app-types';
import {
  createGeneratedAvatar,
  downloadAuthFile,
  openNativeAuthFile,
  openNativeImageFile,
  readFileAsText,
  readImageAsDataUrl
} from '../auth/auth-file';
import { AvatarCropper } from './AvatarCropper';
import { LANGUAGES, t, getStoredTheme } from '../i18n';

type AuthMode = 'login' | 'register' | 'recover';

type AuthGateProps = {
  language: Language;
  theme: Theme;
  onLanguageChange: (language: Language) => void;
  onAuthenticated: (result: AuthenticatedResponse, notice?: AuthNotice, options?: { remember?: boolean }) => void;
};

const REMEMBER_PREF_KEY = 'notoc.auth.remember-pref';

function getErrorMessage(error: unknown, language: Language) {
  return error instanceof Error ? error.message : t(language, 'unknownError');
}

export function AuthGate({ language, theme, onLanguageChange, onAuthenticated }: AuthGateProps) {
  const [mode, setMode] = useState<AuthMode>('login');
  const [nickname, setNickname] = useState('');
  const [recoverNickname, setRecoverNickname] = useState('');
  const [recoveryKey, setRecoveryKey] = useState('');
  const [avatarData, setAvatarData] = useState(() => createGeneratedAvatar('NotOS'));
  const [customAvatar, setCustomAvatar] = useState(false);
  const [cropSource, setCropSource] = useState<string | null>(null);
  const [busy, setBusy] = useState<AuthMode | null>(null);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [remember, setRemember] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(REMEMBER_PREF_KEY);
      return stored === null ? true : stored === '1';
    } catch {
      return true;
    }
  });

  function handleRememberChange(next: boolean) {
    setRemember(next);
    try { localStorage.setItem(REMEMBER_PREF_KEY, next ? '1' : '0'); } catch { /* ignore */ }
  }

  useEffect(() => {
    if (!customAvatar) {
      setAvatarData(createGeneratedAvatar(nickname || 'NotOS'));
    }
  }, [customAvatar, nickname]);

  function switchMode(nextMode: AuthMode) {
    setMode(nextMode);
    setError('');
  }

  async function handleAvatarFile(file: File | undefined) {
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError(t(language, 'invalidAvatarType'));
      return;
    }

    if (file.size > 900_000) {
      setError(t(language, 'avatarTooLarge'));
      return;
    }

    try {
      setCropSource(await readImageAsDataUrl(file));
      setError('');
    } catch (avatarError) {
      setError(getErrorMessage(avatarError, language));
    }
  }

  async function handleChooseAvatar() {
    try {
      const nativeImage = await openNativeImageFile();

      if (nativeImage) {
        setCropSource(nativeImage.dataUrl);
        setError('');
      } else {
        document.getElementById('avatar-file')?.click();
      }
    } catch (avatarError) {
      setError(getErrorMessage(avatarError, language));
    }
  }

  async function handleRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy('register');
    setError('');

    try {
      const result = await api.register({ nickname, avatarData, language, theme });
      const saveResult = await downloadAuthFile(result.authFile);
      onAuthenticated(result, {
        title: t(language, 'accountCreated'),
        message: saveResult.canceled
          ? t(language, 'accountCreatedCanceled')
          : t(language, 'accountCreatedSaved', { path: saveResult.filePath }),
        recoveryKey: result.recoveryKey,
        authFile: result.authFile
      }, { remember });
    } catch (registerError) {
      setError(getErrorMessage(registerError, language));
    } finally {
      setBusy(null);
    }
  }

  async function loginWithContent(content: string) {
    setBusy('login');
    setError('');

    try {
      const result = await api.login(content);
      onAuthenticated(result, undefined, { remember });
    } catch (loginError) {
      setError(getErrorMessage(loginError, language));
    } finally {
      setBusy(null);
      setDragging(false);
    }
  }

  async function loginWithFile(file: File | undefined) {
    if (!file) return;

    if (file.size > 100_000) {
      setError(t(language, 'authFileTooLarge'));
      return;
    }

    try {
      await loginWithContent(await readFileAsText(file));
    } catch (loginError) {
      setError(getErrorMessage(loginError, language));
    }
  }

  async function handleChooseAuthFile() {
    try {
      const nativeFile = await openNativeAuthFile();

      if (nativeFile) {
        await loginWithContent(nativeFile.content);
      } else {
        document.getElementById('auth-file')?.click();
      }
    } catch (loginError) {
      setError(getErrorMessage(loginError, language));
      setBusy(null);
    }
  }

  async function handleRecover(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy('recover');
    setError('');

    try {
      const result = await api.recover({ nickname: recoverNickname, recoveryKey });
      const saveResult = await downloadAuthFile(result.authFile);
      onAuthenticated(result, {
        title: t(language, 'accessRecovered'),
        message: saveResult.canceled
          ? t(language, 'accessRecoveredCanceled')
          : t(language, 'accessRecoveredSaved', { path: saveResult.filePath }),
        authFile: result.authFile
      }, { remember });
    } catch (recoverError) {
      setError(getErrorMessage(recoverError, language));
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="auth-shell">
      <div className="auth-bg">
        <div className="auth-bg-layer" style={{ backgroundImage: 'url("/1_OS.png")' }} />
        <div className="auth-bg-layer" style={{ backgroundImage: 'url("/2_OS.png")' }} />
      </div>
      <section className="auth-panel">
        <div className="auth-header">
          <div className="brand-topline">
            <div className="app-mark">N</div>
            <span>{t(language, 'appName')}</span>
          </div>
          <select className="compact-select" value={language} onChange={(event) => onLanguageChange(event.target.value as Language)}>
            {LANGUAGES.map((item) => (
              <option key={item.code} value={item.code}>
                {item.name}
              </option>
            ))}
          </select>
        </div>

        <div className="mode-switch" role="tablist" aria-label={t(language, 'settings')}>
          <button className={mode === 'login' ? 'mode-pill active' : 'mode-pill'} onClick={() => switchMode('login')} type="button">
            {t(language, 'login')}
          </button>
          <button className={mode === 'register' ? 'mode-pill active' : 'mode-pill'} onClick={() => switchMode('register')} type="button">
            {t(language, 'register')}
          </button>
          <button className={mode === 'recover' ? 'mode-pill active' : 'mode-pill'} onClick={() => switchMode('recover')} type="button">
            {t(language, 'recover')}
          </button>
        </div>

        {error ? <div className="inline-error">{error}</div> : null}

        {mode === 'login' ? (
          <div className="login-stack">
            <div
              className={dragging ? 'drop-zone dragging' : 'drop-zone'}
              onDragEnter={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={(event) => {
                event.preventDefault();
                setDragging(false);
              }}
              onDrop={(event) => {
                event.preventDefault();
                void loginWithFile(event.dataTransfer.files[0]);
              }}
            >
              <div className="file-glyph">AUTH</div>
              <h2>{t(language, 'authTitle')}</h2>
              <p>{t(language, 'authHint')}</p>
              <input
                id="auth-file"
                className="hidden-file"
                type="file"
                accept=".json,.auth,application/json,application/vnd.notoc.auth+json"
                onChange={(event) => void loginWithFile(event.currentTarget.files?.[0])}
              />
              <button className="primary-action" type="button" onClick={() => void handleChooseAuthFile()}>
                {busy === 'login' ? t(language, 'checking') : t(language, 'chooseAuthFile')}
              </button>
            </div>
          </div>
        ) : null}

        {mode === 'register' ? (
          <form className="form-stack" onSubmit={(event) => void handleRegister(event)}>
            <label className="field-label" htmlFor="nickname">
              {t(language, 'nickname')}
            </label>
            <input
              id="nickname"
              className="text-field"
              value={nickname}
              maxLength={24}
              placeholder={t(language, 'nicknamePlaceholder')}
              onChange={(event) => setNickname(event.target.value)}
            />

            <div className="avatar-row">
              <img className="avatar-preview" src={avatarData} alt={t(language, 'userAvatar')} />
              <div>
                <p className="field-label compact">{t(language, 'userAvatar')}</p>
                <input
                  id="avatar-file"
                  className="hidden-file"
                  type="file"
                  accept="image/*"
                  onChange={(event) => void handleAvatarFile(event.currentTarget.files?.[0])}
                />
                <button className="secondary-action" type="button" onClick={() => void handleChooseAvatar()}>
                  {t(language, 'uploadAvatar')}
                </button>
                <button className="link-action" type="button" onClick={() => setCustomAvatar(false)}>
                  {t(language, 'generateAvatar')}
                </button>
              </div>
            </div>

            <button className="primary-action wide" disabled={busy === 'register'} type="submit">
              {busy === 'register' ? t(language, 'creating') : t(language, 'continue')}
            </button>
          </form>
        ) : null}

        {mode === 'recover' ? (
          <form className="form-stack" onSubmit={(event) => void handleRecover(event)}>
            <label className="field-label" htmlFor="recover-nickname">
              {t(language, 'accountNickname')}
            </label>
            <input
              id="recover-nickname"
              className="text-field"
              value={recoverNickname}
              maxLength={24}
              placeholder={t(language, 'accountNicknamePlaceholder')}
              onChange={(event) => setRecoverNickname(event.target.value)}
            />
            <label className="field-label" htmlFor="recovery-key">
              {t(language, 'recoveryKey')}
            </label>
            <input
              id="recovery-key"
              className="text-field mono"
              value={recoveryKey}
              placeholder="XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
              onChange={(event) => setRecoveryKey(event.target.value)}
            />
            <button className="primary-action wide" disabled={busy === 'recover'} type="submit">
              {busy === 'recover' ? t(language, 'recovering') : t(language, 'issueNewAuthFile')}
            </button>
          </form>
        ) : null}

        <label className="auth-remember">
          <input
            type="checkbox"
            checked={remember}
            onChange={(event) => handleRememberChange(event.currentTarget.checked)}
          />
          <span className="auth-remember-box" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="12" height="12">
              <path d="M5 12.5l4.5 4.5L19 7" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="auth-remember-text">
            <strong>{t(language, 'rememberMe')}</strong>
            <small>{t(language, 'rememberMeHint')}</small>
          </span>
        </label>
      </section>

      {cropSource ? (
        <AvatarCropper
          imageDataUrl={cropSource}
          language={language}
          onCancel={() => setCropSource(null)}
          onApply={(nextAvatar) => {
            setAvatarData(nextAvatar);
            setCustomAvatar(true);
            setCropSource(null);
          }}
        />
      ) : null}
    </main>
  );
}
