import { useState } from 'react';
import type { Language } from '../api/types';
import { t } from '../i18n';
import { assetUrl } from '../utils/assets';
import { checkClientUpdate, type ClientUpdateStatus } from '../utils/client-update';

type TitleBarProps = {
  language: Language;
};

function updateText(language: Language, key: 'button' | 'title' | 'checking' | 'current' | 'available' | 'error' | 'currentVersion' | 'latestVersion' | 'updateClient' | 'noLink' | 'server') {
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
    server: 'Проверяется через сервер NotOS'
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
    server: 'Перевіряється через сервер NotOS'
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
    server: 'Checked through the NotOS server'
  };
  return (language === 'ru' ? ru : language === 'uk' ? uk : en)[key];
}

export function TitleBar({ language }: TitleBarProps) {
  const [updateOpen, setUpdateOpen] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<ClientUpdateStatus | null>(null);

  if (!window.notoc) return null;

  async function openUpdateDialog() {
    setUpdateOpen(true);
    setCheckingUpdate(true);
    setUpdateStatus(null);
    const status = await checkClientUpdate();
    setUpdateStatus(status);
    setCheckingUpdate(false);
  }

  function closeUpdateDialog() {
    setUpdateOpen(false);
  }

  async function updateClient() {
    if (updateStatus?.state !== 'available' || !updateStatus.url) return;
    await window.notoc?.openExternal?.(updateStatus.url);
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
      {updateOpen ? (
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
                  <button className="primary-action" type="button" disabled={!updateStatus.url} onClick={() => void updateClient()}>
                    {updateText(language, 'updateClient')}
                  </button>
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
        </div>
      ) : null}
    </>
  );
}
