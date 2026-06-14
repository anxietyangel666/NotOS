import { t } from '../i18n';
import type { Language } from '../api/types';

export type SaveBarProps = {
  language: Language;
  /** Whether there are unsaved changes; controls visibility. */
  dirty: boolean;
  /** Bumping this value (e.g. a counter) triggers the shake animation. */
  shakeKey?: number;
  saving?: boolean;
  /** Optional custom prompt text. Defaults to the localized save/reset prompt. */
  prompt?: string;
  onSave: () => void;
  onReset: () => void;
};

/**
 * Slide-up "you have unsaved changes" bar shown at the bottom of a settings
 * surface. Left side holds the prompt, right side the Reset / Save buttons.
 * When `shakeKey` changes it shakes red to signal a blocked close attempt.
 */
export function SaveBar({ language, dirty, shakeKey = 0, saving = false, prompt, onSave, onReset }: SaveBarProps) {
  if (!dirty) return null;
  return (
    <div className={'app-save-bar' + (shakeKey ? ' shake' : '')} key={shakeKey}>
      <span className="app-save-bar-text">{prompt ?? t(language, 'saveBarPrompt')}</span>
      <div className="app-save-bar-actions">
        <button type="button" className="app-save-bar-reset" disabled={saving} onClick={onReset}>
          {t(language, 'resetChanges')}
        </button>
        <button type="button" className="app-save-bar-save" disabled={saving} onClick={onSave}>
          {saving ? t(language, 'saving') : t(language, 'saveChanges')}
        </button>
      </div>
    </div>
  );
}
