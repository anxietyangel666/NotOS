import type { Language } from '../api/types';
import { t } from '../i18n';

type TitleBarProps = {
  language: Language;
};

export function TitleBar({ language }: TitleBarProps) {
  if (!window.notoc) return null;

  return (
    <header className="titlebar">
      <div className="titlebar-drag">
        <span className="titlebar-mark">N</span>
        <span>{t(language, 'appName')}</span>
      </div>
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
    </header>
  );
}
