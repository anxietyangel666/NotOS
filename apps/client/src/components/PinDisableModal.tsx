import { useCallback, useState } from 'react';
import { t } from '../i18n';
import type { Language } from '../api/types';
import { isPinFormatValid, removePin, verifyPin } from '../utils/pin-lock';
import { PinPad } from './PinPad';

type PinDisableModalProps = {
  language: Language;
  userId: string;
  onClose: () => void;
  onRemoved: () => void;
};

export function PinDisableModal({ language, userId, onClose, onRemoved }: PinDisableModalProps) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = useCallback(async (candidate?: string) => {
    const value = candidate ?? pin;
    if (!isPinFormatValid(value)) {
      setError(t(language, 'pinIncomplete'));
      return;
    }
    setBusy(true);
    const ok = await verifyPin(userId, value);
    setBusy(false);
    if (!ok) {
      setError(t(language, 'pinWrong'));
      setPin('');
      return;
    }
    removePin(userId);
    onRemoved();
  }, [language, onRemoved, pin, userId]);

  return (
    <div className="modal-backdrop important" onClick={onClose}>
      <section className="pin-modal" onClick={(event) => event.stopPropagation()}>
        <header className="pin-modal-head">
          <p className="onboarding-eyebrow">{t(language, 'securityPin')}</p>
          <h2>{t(language, 'pinDisableTitle')}</h2>
          <p className="pin-modal-hint">{t(language, 'pinDisableHint')}</p>
        </header>

        <PinPad
          value={pin}
          onChange={(value) => { setPin(value); setError(''); }}
          onComplete={(value) => void handleSubmit(value)}
          invalid={Boolean(error)}
          disabled={busy}
        />

        {error ? <p className="pin-modal-error">{error}</p> : null}

        <div className="pin-modal-actions">
          <button className="secondary-action" type="button" onClick={onClose} disabled={busy}>
            {t(language, 'cancel')}
          </button>
          <button className="primary-action danger-text" type="button" disabled={busy || pin.length !== 6} onClick={() => void handleSubmit()}>
            {t(language, 'removePin')}
          </button>
        </div>
      </section>
    </div>
  );
}
