import { createPortal } from 'react-dom';
import type { CustomCategory, Group, Language } from '../api/types';
import { t } from '../i18n';
import { Twemoji } from './Twemoji';

type CustomizationModalProps = {
  language: Language;
  group: Group;
  categories: CustomCategory[];
  selectedOptionIds: string[];
  // When true the modal is a blocking onboarding step: it cannot be dismissed
  // until the member presses "Done", and required categories must be answered.
  onboardingRequired: boolean;
  onToggle: (optionId: string) => void;
  onComplete: () => void;
  onClose: () => void;
};

// Member-facing "Customize profile" modal. Renders the admin-defined categories
// as checkbox (multi) or radio (single) groups with emoji + colored pills.
export function CustomizationModal({
  language,
  group,
  categories,
  selectedOptionIds,
  onboardingRequired,
  onToggle,
  onComplete,
  onClose
}: CustomizationModalProps) {
  const selected = new Set(selectedOptionIds);

  // Onboarding can only be completed once every required category has a pick.
  const requiredUnanswered = categories.some(
    (c) => c.required && !c.options.some((o) => selected.has(o.id))
  );

  function handleBackdrop() {
    // A blocking onboarding modal ignores backdrop clicks.
    if (!onboardingRequired) onClose();
  }

  return createPortal(
    <div className="modal-backdrop important customization-backdrop" onClick={handleBackdrop}>
      <section className="customization-modal" onClick={(e) => e.stopPropagation()}>
        <header className="customization-header">
          <h2>
            {onboardingRequired
              ? t(language, 'onboardingWelcome')
              : t(language, 'customizeProfile')}
          </h2>
          <p className="customization-subtitle">
            {onboardingRequired
              ? t(language, 'onboardingSubtitle')
              : t(language, 'customizeSubtitle').replace('{group}', group.name)}
          </p>
          {!onboardingRequired ? (
            <button type="button" className="customization-close" aria-label={t(language, 'close')} onClick={onClose}>✕</button>
          ) : null}
        </header>

        <div className="customization-body">
          {categories.length === 0 ? (
            <p className="muted-line">{t(language, 'customizeEmpty')}</p>
          ) : null}

          {categories.map((category) => (
            <div key={category.id} className="customization-category">
              <div className="customization-category-head">
                <h3>{category.name} - {category.options.length}</h3>
                {category.required ? (
                  <span className="customization-required-badge">{t(language, 'required')}</span>
                ) : null}
              </div>

              <div className="customization-options">
                {category.options.map((option) => {
                  const isSelected = selected.has(option.id);
                  return (
                    <button
                      key={option.id}
                      type="button"
                      className={'customization-option' + (isSelected ? ' active' : '')}
                      style={isSelected ? { borderColor: option.color, boxShadow: `0 0 0 1px ${option.color}` } : undefined}
                      onClick={() => onToggle(option.id)}
                    >
                      <span
                        className={'customization-option-mark ' + (category.selectionType === 'single' ? 'radio' : 'check')}
                        style={isSelected ? { background: option.color, borderColor: option.color } : undefined}
                      />
                      {option.emoji ? (
                        <span className="customization-option-emoji"><Twemoji emoji={option.emoji} /></span>
                      ) : null}
                      <span className="customization-option-label" style={{ color: option.color }}>{option.label}</span>
                    </button>
                  );
                })}
                {category.options.length === 0 ? (
                  <span className="muted-line">{t(language, 'customizeNoOptions')}</span>
                ) : null}
              </div>
            </div>
          ))}
        </div>

        <footer className="customization-footer">
          {onboardingRequired ? (
            <button
              type="button"
              className="primary-action"
              disabled={requiredUnanswered}
              title={requiredUnanswered ? t(language, 'onboardingPickRequired') : undefined}
              onClick={onComplete}
            >
              {t(language, 'done')}
            </button>
          ) : (
            <button type="button" className="primary-action" onClick={onClose}>
              {t(language, 'done')}
            </button>
          )}
        </footer>
      </section>
    </div>,
    document.body
  );
}
