import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Language } from '../api/types';
import { t } from '../i18n';
import { assetUrl } from '../utils/assets';
import { checkClientUpdate, type ClientUpdateStatus } from '../utils/client-update';

type TitleBarProps = {
  language: Language;
};

type UpdateTextKey =
  | 'button'
  | 'title'
  | 'checking'
  | 'current'
  | 'available'
  | 'error'
  | 'currentVersion'
  | 'latestVersion'
  | 'updateClient'
  | 'noLink'
  | 'server'
  | 'downloading'
  | 'installAndRestart'
  | 'readyToInstall';

function updateText(language: Language, key: UpdateTextKey) {
  const ru = {
    button: 'Update',
    title: 'Обновление клиента',
    checking: 'Проверка обновления...',
    current: 'Версия актуальна',
    available: 'Доступно обновление',
    error: 'Не удалось проверить обновления',
    currentVersion: 'Текущая версия',
    latestVersion: 'Новая версия',
    updateClient: 'Обновить клиент',
    noLink: 'Ссылка на обновление не настроена',
    server: 'Проверяется через сервер NotOS',
    downloading: 'Загрузка обновления...',
    installAndRestart: 'Перезапустить NotOS',
    readyToInstall: 'Обновление загружено'
  };
  const uk = {
    button: 'Update',
    title: 'Оновлення клієнта',
    checking: 'Перевірка оновлення...',
    current: 'Версія актуальна',
    available: 'Доступне оновлення',
    error: 'Не вдалося перевірити оновлення',
    currentVersion: 'Поточна версія',
    latestVersion: 'Нова версія',
    updateClient: 'Оновити клієнт',
    noLink: 'Посилання на оновлення не налаштоване',
    server: 'Перевіряється через сервер NotOS',
    downloading: 'Завантаження оновлення...',
    installAndRestart: 'Перезапустити NotOS',
    readyToInstall: 'Оновлення завантажено'
  };
  const zh = {
    button: 'Update',
    title: '客户端更新',
    checking: '正在检查更新…',
    current: '已是最新版本',
    available: '有可用更新',
    error: '无法检查更新',
    currentVersion: '当前版本',
    latestVersion: '新版本',
    updateClient: '更新客户端',
    noLink: '未配置更新链接',
    server: '通过 NotOS 服务器检查',
    downloading: '正在下载更新…',
    installAndRestart: '重启 NotOS',
    readyToInstall: '更新已下载完毕'
  };
  const zhTW = {
    button: 'Update',
    title: '用戶端更新',
    checking: '正在檢查更新…',
    current: '已是最新版本',
    available: '有可用更新',
    error: '無法檢查更新',
    currentVersion: '目前版本',
    latestVersion: '新版本',
    updateClient: '更新用戶端',
    noLink: '未設定更新連結',
    server: '透過 NotOS 伺服器檢查',
    downloading: '正在下載更新…',
    installAndRestart: '重啟 NotOS',
    readyToInstall: '更新已下載完畢'
  };
  const en = {
    button: 'Update',
    title: 'Client update',
    checking: 'Checking for updates...',
    current: 'You are up to date',
    available: 'Update available',
    error: 'Could not check for updates',
    currentVersion: 'Current version',
    latestVersion: 'New version',
    updateClient: 'Update client',
    noLink: 'Update link is not configured',
    server: 'Checked through the NotOS server',
    downloading: 'Downloading update...',
    installAndRestart: 'Restart NotOS',
    readyToInstall: 'Update downloaded'
  };
  return (language === 'ru' ? ru : language === 'uk' ? uk : language === 'zh' ? zh : language === 'zh-TW' ? zhTW : en)[key];
}

export function TitleBar({ language }: TitleBarProps) {
  const [updateOpen, setUpdateOpen] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<ClientUpdateStatus | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadPercent, setDownloadPercent] = useState(0);
  const [downloadedPath, setDownloadedPath] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    if (!window.notoc?.onUpdateProgress) return;
    const unsub = window.notoc.onUpdateProgress((data) => {
      if (typeof data?.percent === 'number') {
        setDownloadPercent(Math.round(data.percent));
      }
    });
    return unsub;
  }, []);

  if (!window.notoc) return null;

  async function openUpdateDialog() {
    setUpdateOpen(true);
    setCheckingUpdate(true);
    setUpdateStatus(null);
    setDownloading(false);
    setDownloadPercent(0);
    setDownloadedPath(null);
    setDownloadError(null);
    const status = await checkClientUpdate();
    setUpdateStatus(status);
    setCheckingUpdate(false);
  }

  function closeUpdateDialog() {
    setUpdateOpen(false);
  }

  async function updateClient() {
    if (updateStatus?.state !== 'available') return;
    if (window.notoc?.startUpdate) {
      setDownloading(true);
      setDownloadPercent(0);
      setDownloadError(null);
      try {
        const targetUrl = updateStatus.url || updateStatus.installerUrl;
        const res = await window.notoc.startUpdate(targetUrl);
        setDownloading(false);
        if (res?.ok && res?.filePath) {
          setDownloadedPath(res.filePath);
        } else {
          setDownloadError(res?.error || 'Update failed');
        }
        return;
      } catch (err) {
        setDownloading(false);
        setDownloadError(err instanceof Error ? err.message : 'Update failed');
        return;
      }
    }
    // If in-app updater is not available (older client or external environment),
    // open the official installer executable (.exe) in browser, NEVER raw .zip archive!
    const externalUrl = updateStatus.installerUrl || updateStatus.url;
    if (externalUrl) {
      await window.notoc?.openExternal?.(externalUrl);
    }
  }

  async function restartAndApply() {
    if (!downloadedPath) return;
    await window.notoc?.applyUpdate?.(downloadedPath);
  }

  return (
    <>
      <header className="titlebar">
        <div className="titlebar-drag">
          <img className="titlebar-mark" src={assetUrl('Emoji/app-icon.png')} alt="" />
          <span>{t(language, 'appName')}</span>
        </div>
        <div className="titlebar-actions">
          <button className="titlebar-update-btn" type="button" title={updateText(language, 'button')} aria-label={updateText(language, 'button')} onClick={() => void openUpdateDialog()}>
            <span className="titlebar-update-icon" aria-hidden="true" />
          </button>
          <div className="window-controls">
            <button type="button" aria-label={t(language, 'minimize')} onClick={() => void window.notoc?.minimizeWindow()}>
              -
            </button>
            <button type="button" aria-label={t(language, 'maximize')} onClick={() => void window.notoc?.toggleMaximizeWindow()}>
              □
            </button>
            <button className="danger" type="button" aria-label={t(language, 'close')} onClick={() => void window.notoc?.closeWindow()}>
              x
            </button>
          </div>
        </div>
      </header>
      {updateOpen && typeof document !== 'undefined'
        ? createPortal(
            <div className="modal-backdrop update-check-backdrop" onClick={closeUpdateDialog}>
              <section className="update-check-dialog" onClick={(event) => event.stopPropagation()}>
                <header className="update-check-head">
                  <img src={assetUrl('Emoji/app-icon.png')} alt="" />
                  <div>
                    <strong>{updateText(language, 'title')}</strong>
                    <span>{updateText(language, 'server')}</span>
                  </div>
                  <button className="icon-action" type="button" aria-label={t(language, 'close')} onClick={closeUpdateDialog}>
                    ×
                  </button>
                </header>

                <div className="update-check-body">
                  {checkingUpdate ? (
                    <div className="update-check-state">
                      <span className="update-spinner" aria-hidden="true" />
                      <strong>{updateText(language, 'checking')}</strong>
                    </div>
                  ) : updateStatus?.state === 'available' ? (
                    <>
                      <div className="update-check-state available">
                        <span className="update-check-status-dot" aria-hidden="true" />
                        <strong>{updateText(language, 'available')}</strong>
                      </div>
                      <div className="update-version-grid">
                        <span>{updateText(language, 'currentVersion')}</span>
                        <strong>v{updateStatus.currentVersion}</strong>
                        <span>{updateText(language, 'latestVersion')}</span>
                        <strong>v{updateStatus.latestVersion}</strong>
                      </div>
                      {updateStatus.notes ? <p>{updateStatus.notes}</p> : null}
                      {!updateStatus.url ? <p className="update-check-warning">{updateText(language, 'noLink')}</p> : null}

                      {downloadError ? (
                        <div style={{ marginTop: '8px' }}>
                          <p className="inline-error">{downloadError}</p>
                          {updateStatus.installerUrl ? (
                            <button
                              className="secondary-action"
                              type="button"
                              style={{ marginTop: '6px', width: '100%' }}
                              onClick={() => void window.notoc?.openExternal?.(updateStatus.installerUrl)}
                            >
                              {language === 'ru' ? 'Скачать установщик вручную (.exe)' : language === 'uk' ? 'Завантажити інсталятор вручну (.exe)' : 'Download installer manually (.exe)'}
                            </button>
                          ) : null}
                        </div>
                      ) : null}

                      {downloadedPath ? (
                        <button className="primary-action" type="button" onClick={() => void restartAndApply()}>
                          {updateText(language, 'installAndRestart')}
                        </button>
                      ) : downloading ? (
                        <div style={{ width: '100%', marginTop: '8px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                            <span>{updateText(language, 'downloading')}</span>
                            <span>{downloadPercent}%</span>
                          </div>
                          <div style={{ width: '100%', height: '6px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px', overflow: 'hidden' }}>
                            <div style={{ width: `${downloadPercent}%`, height: '100%', background: 'var(--blue)', transition: 'width 0.2s ease' }} />
                          </div>
                        </div>
                      ) : (
                        <button className="primary-action" type="button" disabled={!updateStatus.url && !updateStatus.installerUrl} onClick={() => void updateClient()}>
                          {window.notoc?.startUpdate ? updateText(language, 'updateClient') : (language === 'ru' ? 'Скачать установщик (.exe)' : language === 'uk' ? 'Завантажити інсталятор (.exe)' : 'Download installer (.exe)')}
                        </button>
                      )}
                    </>
                  ) : updateStatus?.state === 'current' ? (
                    <>
                      <div className="update-check-state current">
                        <span className="update-check-status-dot" aria-hidden="true" />
                        <strong>{updateText(language, 'current')}</strong>
                      </div>
                      <div className="update-version-grid">
                        <span>{updateText(language, 'currentVersion')}</span>
                        <strong>v{updateStatus.currentVersion}</strong>
                      </div>
                    </>
                  ) : (
                    <div className="update-check-state error">
                      <span className="update-check-status-dot" aria-hidden="true" />
                      <strong>{updateText(language, 'error')}</strong>
                      {updateStatus?.state === 'error' ? <small>{updateStatus.message}</small> : null}
                    </div>
                  )}
                </div>
              </section>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
