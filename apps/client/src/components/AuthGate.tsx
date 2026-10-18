import { useEffect, useState, type FormEvent } from 'react';
import { api, getApiBaseUrl, setApiBaseUrl } from '../api/client';
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
import { assetUrl } from '../utils/assets';

type AuthMode = 'login' | 'register' | 'recover';
type AuthMethod = 'secure' | 'password';

type AuthGateProps = {
  language: Language;
  theme: Theme;
  onLanguageChange: (language: Language) => void;
  onAuthenticated: (result: AuthenticatedResponse, notice?: AuthNotice, options?: { remember?: boolean }) => void;
};

const REMEMBER_PREF_KEY = 'notoc.auth.remember-pref';

function authCopy(language: Language) {
  if (language === 'ru') {
    return {
      heroTitle: 'Добро пожаловать в NotOS',
      heroText: 'Выберите защищенный вход через auth-файл или обычный вход по логину и паролю.',
      secureMethod: 'Защищенный',
      passwordMethod: 'Логин / пароль',
      secureCaption: 'Auth-файл хранит ключ доступа локально и подходит для основного аккаунта.',
      passwordCaption: 'Обычный способ: никнейм и пароль без выбора файла.',
      loginLabel: 'Логин',
      loginPlaceholder: 'например, neon_admin',
      password: 'Пароль',
      passwordPlaceholder: 'Введите пароль',
      repeatPassword: 'Повтор пароля',
      repeatPasswordPlaceholder: 'Повторите пароль',
      email: 'Email',
      emailPlaceholder: 'name@example.com',
      createPassword: 'Придумайте пароль',
      passwordLoginTitle: 'Вход по паролю',
      passwordLoginHint: 'Введите логин и пароль, которые были указаны при обычной регистрации.',
      secureRegisterTitle: 'Защищенная регистрация',
      passwordRegisterTitle: 'Обычная регистрация',
      secureRegisterHint: 'После создания аккаунта NotOS сохранит auth-файл и покажет recovery-ключ.',
      passwordRegisterHint: 'Аккаунт будет открываться по никнейму и паролю. Auth-файл не потребуется.',
      passwordAccountCreated: 'Аккаунт создан. Recovery-ключ показывается один раз; он нужен для восстановления доступа.',
      passwordMismatch: 'Пароли не совпадают.',
      signIn: 'Войти',
      signingIn: 'Вход...',
      createAccount: 'Создать аккаунт'
    };
  }

  if (language === 'uk') {
    return {
      heroTitle: 'Ласкаво просимо до NotOS',
      heroText: 'Оберіть захищений вхід через auth-файл або звичайний вхід за логіном і паролем.',
      secureMethod: 'Захищений',
      passwordMethod: 'Логін / пароль',
      secureCaption: 'Auth-файл зберігає ключ доступу локально і підходить для основного акаунта.',
      passwordCaption: 'Звичайний спосіб: нікнейм і пароль без вибору файла.',
      loginLabel: 'Логін',
      loginPlaceholder: 'наприклад, neon_admin',
      password: 'Пароль',
      passwordPlaceholder: 'Введіть пароль',
      repeatPassword: 'Повтор пароля',
      repeatPasswordPlaceholder: 'Повторіть пароль',
      email: 'Email',
      emailPlaceholder: 'name@example.com',
      createPassword: 'Створіть пароль',
      passwordLoginTitle: 'Вхід за паролем',
      passwordLoginHint: 'Введіть логін і пароль, указані під час звичайної реєстрації.',
      secureRegisterTitle: 'Захищена реєстрація',
      passwordRegisterTitle: 'Звичайна реєстрація',
      secureRegisterHint: 'Після створення акаунта NotOS збереже auth-файл і покаже recovery-ключ.',
      passwordRegisterHint: 'Акаунт відкриватиметься за нікнеймом і паролем. Auth-файл не потрібен.',
      passwordAccountCreated: 'Акаунт створено. Recovery-ключ показується один раз; він потрібен для відновлення доступу.',
      passwordMismatch: 'Паролі не збігаються.',
      signIn: 'Увійти',
      signingIn: 'Вхід...',
      createAccount: 'Створити акаунт'
    };
  }

  if (language === 'zh') {
    return {
      heroTitle: '欢迎来到 NotOS',
      heroText: '选择通过授权文件的安全登录，或使用用户名和密码的普通登录。',
      secureMethod: '安全登录',
      passwordMethod: '用户名 / 密码',
      secureCaption: '授权文件在本地保存访问密钥，适合主账户使用。',
      passwordCaption: '普通方式：昵称和密码，无需选择文件。',
      loginLabel: '用户名',
      loginPlaceholder: '例如 neon_admin',
      password: '密码',
      passwordPlaceholder: '输入密码',
      repeatPassword: '确认密码',
      repeatPasswordPlaceholder: '再次输入密码',
      email: '邮箱',
      emailPlaceholder: 'name@example.com',
      createPassword: '设置密码',
      passwordLoginTitle: '密码登录',
      passwordLoginHint: '输入普通注册时设置的用户名和密码。',
      secureRegisterTitle: '安全注册',
      passwordRegisterTitle: '普通注册',
      secureRegisterHint: '创建账户后，NotOS 会保存授权文件并显示恢复密钥。',
      passwordRegisterHint: '账户将通过昵称和密码打开，无需授权文件。',
      passwordAccountCreated: '账户已创建。恢复密钥只显示一次，用于恢复访问权限。',
      passwordMismatch: '两次密码不一致。',
      signIn: '登录',
      signingIn: '正在登录…',
      createAccount: '创建账户'
    };
  }

  if (language === 'zh-TW') {
    return {
      heroTitle: '歡迎來到 NotOS',
      heroText: '選擇透過授權檔的安全登入，或使用使用者名稱和密碼的一般登入。',
      secureMethod: '安全登入',
      passwordMethod: '使用者名稱 / 密碼',
      secureCaption: '授權檔在本機保存存取金鑰，適合主要帳戶使用。',
      passwordCaption: '一般方式：暱稱和密碼，無需選擇檔案。',
      loginLabel: '使用者名稱',
      loginPlaceholder: '例如 neon_admin',
      password: '密碼',
      passwordPlaceholder: '輸入密碼',
      repeatPassword: '確認密碼',
      repeatPasswordPlaceholder: '再次輸入密碼',
      email: '電子郵件',
      emailPlaceholder: 'name@example.com',
      createPassword: '設定密碼',
      passwordLoginTitle: '密碼登入',
      passwordLoginHint: '輸入一般註冊時設定的使用者名稱和密碼。',
      secureRegisterTitle: '安全註冊',
      passwordRegisterTitle: '一般註冊',
      secureRegisterHint: '建立帳戶後，NotOS 會儲存授權檔並顯示復原金鑰。',
      passwordRegisterHint: '帳戶將透過暱稱和密碼開啟，無需授權檔。',
      passwordAccountCreated: '帳戶已建立。復原金鑰只顯示一次，用於復原存取權限。',
      passwordMismatch: '兩次密碼不一致。',
      signIn: '登入',
      signingIn: '正在登入…',
      createAccount: '建立帳戶'
    };
  }

  return {
    heroTitle: 'Welcome to NotOS',
    heroText: 'Choose protected auth-file access or classic nickname and password sign-in.',
    secureMethod: 'Protected',
    passwordMethod: 'Login / password',
    secureCaption: 'The auth file keeps your access key locally and is best for a primary account.',
    passwordCaption: 'Classic access: nickname and password without choosing a file.',
    loginLabel: 'Login',
    loginPlaceholder: 'for example, neon_admin',
    password: 'Password',
    passwordPlaceholder: 'Enter password',
    repeatPassword: 'Repeat password',
    repeatPasswordPlaceholder: 'Repeat password',
    email: 'Email',
    emailPlaceholder: 'name@example.com',
    createPassword: 'Create password',
    passwordLoginTitle: 'Password sign-in',
    passwordLoginHint: 'Enter the login and password used during classic registration.',
    secureRegisterTitle: 'Protected registration',
    passwordRegisterTitle: 'Classic registration',
    secureRegisterHint: 'After creating the account, NotOS will save an auth file and show a recovery key.',
    passwordRegisterHint: 'The account will open with nickname and password. No auth file is required.',
    passwordAccountCreated: 'Account created. The recovery key is shown once and is needed to restore access.',
    passwordMismatch: 'Passwords do not match.',
    signIn: 'Sign in',
    signingIn: 'Signing in...',
    createAccount: 'Create account'
  };
}

function getErrorMessage(error: unknown, language: Language) {
  return error instanceof Error ? error.message : t(language, 'unknownError');
}

export function AuthGate({ language, theme, onLanguageChange, onAuthenticated }: AuthGateProps) {
  const [mode, setMode] = useState<AuthMode>('login');
  const [loginMethod, setLoginMethod] = useState<AuthMethod>('secure');
  const [registerMethod, setRegisterMethod] = useState<AuthMethod>('secure');
  const [nickname, setNickname] = useState('');
  const [loginName, setLoginName] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [registerLogin, setRegisterLogin] = useState('');
  const [registerPassword, setRegisterPassword] = useState('');
  const [registerPasswordRepeat, setRegisterPasswordRepeat] = useState('');
  const [registerEmail, setRegisterEmail] = useState('');
  const [recoverNickname, setRecoverNickname] = useState('');
  const [recoveryKey, setRecoveryKey] = useState('');
  const [avatarData, setAvatarData] = useState(() => createGeneratedAvatar('NotOS'));
  const [customAvatar, setCustomAvatar] = useState(false);
  const [cropSource, setCropSource] = useState<string | null>(null);
  const [busy, setBusy] = useState<AuthMode | null>(null);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [serverUrlDraft, setServerUrlDraft] = useState(() => getApiBaseUrl());
  const [serverStatus, setServerStatus] = useState<'idle' | 'checking' | 'ok' | 'error'>('idle');
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

  async function handleServerCheck() {
    const normalized = setApiBaseUrl(serverUrlDraft);
    setServerUrlDraft(normalized);
    setServerStatus('checking');
    setError('');
    try {
      await api.health();
      setServerStatus('ok');
    } catch (serverError) {
      setServerStatus('error');
      setError(getErrorMessage(serverError, language));
    }
  }

  useEffect(() => {
    if (!customAvatar) {
      const avatarSeed = registerMethod === 'password' ? registerLogin : nickname;
      setAvatarData(createGeneratedAvatar(avatarSeed || 'NotOS'));
    }
  }, [customAvatar, nickname, registerLogin, registerMethod]);

  function switchMode(nextMode: AuthMode) {
    setMode(nextMode);
    setError('');
  }

  function switchLoginMethod(nextMethod: AuthMethod) {
    setLoginMethod(nextMethod);
    setError('');
  }

  function switchRegisterMethod(nextMethod: AuthMethod) {
    setRegisterMethod(nextMethod);
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
      if (registerMethod === 'password') {
        if (registerPassword !== registerPasswordRepeat) {
          setError(copy.passwordMismatch);
          return;
        }
        const result = await api.registerPassword({ login: registerLogin, email: registerEmail, password: registerPassword, avatarData, language, theme });
        onAuthenticated(result, {
          title: t(language, 'accountCreated'),
          message: copy.passwordAccountCreated,
          recoveryKey: result.recoveryKey
        }, { remember });
      } else {
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
      }
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

  async function handlePasswordLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy('login');
    setError('');

    try {
      const result = await api.loginPassword({ login: loginName, password: loginPassword });
      onAuthenticated(result, undefined, { remember });
    } catch (loginError) {
      setError(getErrorMessage(loginError, language));
    } finally {
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

  const copy = authCopy(language);

  return (
    <main className="auth-shell">
      <div className="auth-bg">
        <div className="auth-bg-layer" style={{ backgroundImage: `url("${assetUrl('1_OS.png')}")` }} />
        <div className="auth-bg-layer" style={{ backgroundImage: `url("${assetUrl('2_OS.png')}")` }} />
      </div>
      <section className="auth-panel">
        <div className="auth-header">
          <div className="brand-topline">
            <img className="app-mark" src={assetUrl('Emoji/app-icon.png')} alt="" />
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

        <div className="auth-hero">
          <h1>{copy.heroTitle}</h1>
          <p>{copy.heroText}</p>
        </div>

        <div className="server-url-card">
          <label className="field-label" htmlFor="server-url">
            Server URL
          </label>
          <div className="server-url-row">
            <input
              id="server-url"
              className="text-field"
              value={serverUrlDraft}
              placeholder="https://your-app.up.railway.app"
              spellCheck={false}
              onChange={(event) => {
                setServerUrlDraft(event.target.value);
                setServerStatus('idle');
              }}
              onBlur={() => {
                const normalized = setApiBaseUrl(serverUrlDraft);
                setServerUrlDraft(normalized);
              }}
            />
            <button className="secondary-action" type="button" onClick={() => void handleServerCheck()}>
              {serverStatus === 'checking' ? 'Checking...' : 'Test'}
            </button>
          </div>
          <p className={serverStatus === 'ok' ? 'server-url-status ok' : serverStatus === 'error' ? 'server-url-status error' : 'server-url-status'}>
            {serverStatus === 'ok'
              ? 'Connected'
              : serverStatus === 'error'
                ? 'Cannot reach this server'
                : 'Paste your Railway server URL here after deploy.'}
          </p>
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
            <div className="auth-method-switch" role="tablist" aria-label="Authentication method">
              <button className={loginMethod === 'secure' ? 'auth-method active' : 'auth-method'} onClick={() => switchLoginMethod('secure')} type="button">
                <strong>{copy.secureMethod}</strong>
                <span>{copy.secureCaption}</span>
              </button>
              <button className={loginMethod === 'password' ? 'auth-method active' : 'auth-method'} onClick={() => switchLoginMethod('password')} type="button">
                <strong>{copy.passwordMethod}</strong>
                <span>{copy.passwordCaption}</span>
              </button>
            </div>

            {loginMethod === 'secure' ? (
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
            ) : (
              <form className="form-stack auth-card" onSubmit={(event) => void handlePasswordLogin(event)}>
                <div className="auth-card-heading">
                  <h2>{copy.passwordLoginTitle}</h2>
                  <p>{copy.passwordLoginHint}</p>
                </div>
                <label className="field-label" htmlFor="login-nickname">
                  {copy.loginLabel}
                </label>
                <input
                  id="login-nickname"
                  className="text-field"
                  value={loginName}
                  maxLength={32}
                  placeholder={copy.loginPlaceholder}
                  onChange={(event) => setLoginName(event.target.value)}
                />
                <label className="field-label" htmlFor="login-password">
                  {copy.password}
                </label>
                <input
                  id="login-password"
                  className="text-field"
                  type="password"
                  value={loginPassword}
                  maxLength={128}
                  placeholder={copy.passwordPlaceholder}
                  onChange={(event) => setLoginPassword(event.target.value)}
                />
                <button className="primary-action wide" disabled={busy === 'login'} type="submit">
                  {busy === 'login' ? copy.signingIn : copy.signIn}
                </button>
              </form>
            )}
          </div>
        ) : null}

        {mode === 'register' ? (
          <form className="form-stack" onSubmit={(event) => void handleRegister(event)}>
            <div className="auth-method-switch" role="tablist" aria-label="Registration method">
              <button className={registerMethod === 'secure' ? 'auth-method active' : 'auth-method'} onClick={() => switchRegisterMethod('secure')} type="button">
                <strong>{copy.secureMethod}</strong>
                <span>{copy.secureRegisterHint}</span>
              </button>
              <button className={registerMethod === 'password' ? 'auth-method active' : 'auth-method'} onClick={() => switchRegisterMethod('password')} type="button">
                <strong>{copy.passwordMethod}</strong>
                <span>{copy.passwordRegisterHint}</span>
              </button>
            </div>

            <div className="auth-card-heading">
              <h2>{registerMethod === 'secure' ? copy.secureRegisterTitle : copy.passwordRegisterTitle}</h2>
            </div>

            {registerMethod === 'secure' ? (
              <>
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
              </>
            ) : (
              <>
                <label className="field-label" htmlFor="register-login">
                  {copy.loginLabel}
                </label>
                <input
                  id="register-login"
                  className="text-field"
                  value={registerLogin}
                  maxLength={32}
                  placeholder={copy.loginPlaceholder}
                  onChange={(event) => setRegisterLogin(event.target.value)}
                />

                <label className="field-label" htmlFor="register-password">
                  {copy.createPassword}
                </label>
                <input
                  id="register-password"
                  className="text-field"
                  type="password"
                  value={registerPassword}
                  minLength={6}
                  maxLength={128}
                  placeholder={copy.passwordPlaceholder}
                  onChange={(event) => setRegisterPassword(event.target.value)}
                />

                <label className="field-label" htmlFor="register-password-repeat">
                  {copy.repeatPassword}
                </label>
                <input
                  id="register-password-repeat"
                  className="text-field"
                  type="password"
                  value={registerPasswordRepeat}
                  minLength={6}
                  maxLength={128}
                  placeholder={copy.repeatPasswordPlaceholder}
                  onChange={(event) => setRegisterPasswordRepeat(event.target.value)}
                />

                <label className="field-label" htmlFor="register-email">
                  {copy.email}
                </label>
                <input
                  id="register-email"
                  className="text-field"
                  type="email"
                  value={registerEmail}
                  maxLength={254}
                  placeholder={copy.emailPlaceholder}
                  onChange={(event) => setRegisterEmail(event.target.value)}
                />
              </>
            )}

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
              {busy === 'register' ? t(language, 'creating') : copy.createAccount}
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
