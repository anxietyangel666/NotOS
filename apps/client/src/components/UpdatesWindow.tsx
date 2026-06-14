import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { Language } from '../api/types';
import { LOCALES, t } from '../i18n';
import { UPDATES, type AppUpdate } from '../utils/updates';

type UpdatesWindowProps = {
  language: Language;
  /** When true, shows the most recent update expanded first (login popup). */
  initialUpdateId?: string | null;
  onClose: () => void;
};

function formatUpdateDate(value: string, language: Language) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(LOCALES[language], { day: '2-digit', month: 'long', year: 'numeric' }).format(date);
}

export function UpdatesWindow({ language, initialUpdateId = null, onClose }: UpdatesWindowProps) {
  const [selected, setSelected] = useState<AppUpdate | null>(() =>
    initialUpdateId ? UPDATES.find((update) => update.id === initialUpdateId) ?? null : null
  );

  return createPortal(
    <div className="modal-backdrop updates-backdrop" onClick={onClose}>
      <section className="updates-window" onClick={(event) => event.stopPropagation()}>
        <header
          className="updates-header"
          style={selected?.headerImage ? { backgroundImage: `url("${selected.headerImage}")` } : undefined}
        >
          <div className="updates-header-overlay">
            <p className="eyebrow">{t(language, 'whatsNew')}</p>
            <h2>{selected ? selected.title : t(language, 'updates')}</h2>
          </div>
          <button className="icon-action updates-close" type="button" aria-label={t(language, 'close')} onClick={onClose}>
            ✕
          </button>
        </header>

        <div className="updates-body">
          {selected ? (
            <article className="updates-detail">
              <div className="updates-detail-meta">
                <span className="updates-version">v{selected.version}</span>
                <time>{formatUpdateDate(selected.date, language)}</time>
              </div>
              {selected.body.split('\n\n').map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
              <button className="secondary-action" type="button" onClick={() => setSelected(null)}>
                ‹ {t(language, 'back')}
              </button>
            </article>
          ) : UPDATES.length === 0 ? (
            <div className="explorer-empty">{t(language, 'updatesEmpty')}</div>
          ) : (
            <div className="updates-list">
              {UPDATES.map((update) => (
                <button key={update.id} className="updates-list-item" type="button" onClick={() => setSelected(update)}>
                  <div className="updates-list-item-head">
                    <strong>{update.title}</strong>
                    <span className="updates-version">v{update.version}</span>
                  </div>
                  <small>{update.summary}</small>
                  <time>{formatUpdateDate(update.date, language)}</time>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>,
    document.body
  );
}
