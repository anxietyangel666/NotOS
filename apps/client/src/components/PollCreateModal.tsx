// Poll composer dialog shared by DMs and group channels. The caller supplies
// the actual create call; the dialog only collects question, options and the
// multiple-answers flag.
import { useState } from 'react';
import type { Language } from '../api/types';
import { t } from '../i18n';

export function PollCreateModal({
  language,
  onClose,
  onCreate
}: {
  language: Language;
  onClose: () => void;
  onCreate: (poll: { question: string; options: string[]; multi: boolean }) => Promise<void>;
}) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState<string[]>(['', '']);
  const [multi, setMulti] = useState(false);
  const [busy, setBusy] = useState(false);

  const filled = options.map((option) => option.trim()).filter(Boolean);
  const canCreate = question.trim().length > 0 && filled.length >= 2 && !busy;

  return (
    <div className="messenger-inline-modal schedule-modal-layer" onClick={onClose}>
      <div className="schedule-modal poll-create-modal" onClick={(event) => event.stopPropagation()}>
        <h3>{t(language, 'createPoll')}</h3>
        <input
          type="text"
          className="messenger-input"
          value={question}
          autoFocus
          maxLength={300}
          placeholder={t(language, 'pollQuestion')}
          onChange={(event) => setQuestion(event.target.value)}
        />
        <div className="poll-create-options">
          {options.map((option, index) => (
            <div key={index} className="poll-create-option-row">
              <input
                type="text"
                className="messenger-input"
                value={option}
                maxLength={100}
                placeholder={`${t(language, 'pollOption')} ${index + 1}`}
                onChange={(event) => setOptions((current) => current.map((value, i) => (i === index ? event.target.value : value)))}
              />
              {options.length > 2 ? (
                <button
                  type="button"
                  className="poll-create-remove"
                  aria-label={t(language, 'cancel')}
                  onClick={() => setOptions((current) => current.filter((_, i) => i !== index))}
                >✕</button>
              ) : null}
            </div>
          ))}
        </div>
        {options.length < 10 ? (
          <button type="button" className="poll-create-add" onClick={() => setOptions((current) => [...current, ''])}>
            + {t(language, 'pollAddOption')}
          </button>
        ) : null}
        <label className="poll-create-multi">
          <input type="checkbox" checked={multi} onChange={(event) => setMulti(event.target.checked)} />
          <span>{t(language, 'pollMulti')}</span>
        </label>
        <div className="schedule-modal-actions">
          <button type="button" className="secondary-action" onClick={onClose}>{t(language, 'cancel')}</button>
          <button
            type="button"
            className="primary-action"
            disabled={!canCreate}
            onClick={() => {
              setBusy(true);
              onCreate({ question: question.trim(), options: filled, multi })
                .then(onClose)
                .catch(() => setBusy(false));
            }}
          >
            {t(language, 'create')}
          </button>
        </div>
      </div>
    </div>
  );
}
