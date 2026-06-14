import { useCallback, useEffect, useState } from 'react';
import { t } from '../i18n';
import type { Language } from '../api/types';
import { isPinFormatValid, savePin, verifyPin, PIN_LENGTH } from '../utils/pin-lock';
import { PinPad } from './PinPad';

type Stage = 'verifyCurrent' | 'enterNew' | 'confirmNew' | 'done';

type PinSetupModalProps = {
  language: Language;
  userId: string;
  mode: 'create' | 'change';
  onClose: () => void;
  onSaved: () => void;
};

export function PinSetupModal({ language, userId, mode, onClose, onSaved }: PinSetupModalProps) {
  const [stage, setStage] = useState<Stage>(mode === 'change' ? 'verifyCurrent' : 'enterNew');
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPinValue, setConfirmPinValue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setError('');
  }, [stage]);

  const handleVerifyCurrent = useCallback(async (candidate?: string) => {
    const pin = candidate ?? currentPin;
    if (!isPinFormatValid(pin)) {
      setError(t(language, 'pinIncomplete'));
      return;
    }
    setBusy(true);
    const ok = await verifyPin(userId, pin);
    setBusy(false);
    if (!ok) {
      setError(t(language, 'pinWrong'));
      setCurrentPin('');
      return;
    }
    setStage('enterNew');
  }, [currentPin, language, userId]);

  const handleEnterNew = useCallback((candidate?: string) => {
    const pin = candidate ?? newPin;
    if (!isPinFormatValid(pin)) {
      setError(t(language, 'pinIncomplete'));
      return;
    }
    setStage('confirmNew');
  }, [newPin, language]);

  const handleConfirmNew = useCallback(async (candidate?: string) => {
    const pin = candidate ?? confirmPinValue;
    if (!isPinFormatValid(pin)) {
      setError(t(language, 'pinIncomplete'));
      return;
    }
    if (pin !== newPin) {
      setError(t(language, 'pinMismatch'));
      setConfirmPinValue('');
      return;
    }
    setBusy(true);
    await savePin(userId, pin);
    setBusy(false);
    setStage('done');
  }, [confirmPinValue, language, newPin, userId]);

  const stageLabels: Record<Stage, { eyebrow: string; hint: string }> = {
    verifyCurrent: {
      eyebrow: t(language, 'changePin'),
      hint: t(language, 'pinChangeHint')
    },
    enterNew: {
      eyebrow: t(language, 'pinSetupTitle'),
      hint: t(language, 'pinSetupCreateHint')
    },
    confirmNew: {
      eyebrow: t(language, 'pinSetupTitle'),
      hint: t(language, 'pinSetupConfirmHint')
    },
    done: {
      eyebrow: t(language, 'pinSavedTitle'),
      hint: t(language, 'pinSavedHint')
    }
  };

  const totalSteps = mode === 'change' ? 3 : 2;
  const currentStepIndex = stage === 'verifyCurrent' ? 0 : stage === 'enterNew' ? (mode === 'change' ? 1 : 0) : stage === 'confirmNew' ? (mode === 'change' ? 2 : 1) : totalSteps;

  return (
    <div className="modal-backdrop important" onClick={onClose}>
      <section className="pin-modal" onClick={(event) => event.stopPropagation()}>
        <header className="pin-modal-head">
          <p className="onboarding-eyebrow">{stageLabels[stage].eyebrow}</p>
          <h2>{stage === 'done' ? t(language, 'pinSavedTitle') : t(language, 'pinSetupTitle')}</h2>
          <p className="pin-modal-hint">{stageLabels[stage].hint}</p>
        </header>

        {stage !== 'done' ? (
          <div className="pin-progress" aria-hidden="true">
            {Array.from({ length: totalSteps }).map((_, index) => (
              <span
                key={index}
                className={index <= currentStepIndex ? 'pin-progress-dot active' : 'pin-progress-dot'}
              />
            ))}
          </div>
        ) : null}

        {stage === 'verifyCurrent' ? (
          <PinPad
            value={currentPin}
            onChange={(value) => { setCurrentPin(value); setError(''); }}
            onComplete={(value) => void handleVerifyCurrent(value)}
            invalid={Boolean(error)}
            disabled={busy}
          />
        ) : null}

        {stage === 'enterNew' ? (
          <PinPad
            value={newPin}
            onChange={(value) => { setNewPin(value); setError(''); }}
            onComplete={(value) => handleEnterNew(value)}
            invalid={Boolean(error)}
            disabled={busy}
          />
        ) : null}

        {stage === 'confirmNew' ? (
          <PinPad
            value={confirmPinValue}
            onChange={(value) => { setConfirmPinValue(value); setError(''); }}
            onComplete={(value) => void handleConfirmNew(value)}
            invalid={Boolean(error)}
            disabled={busy}
          />
        ) : null}

        {stage === 'done' ? (
          <div className="pin-success">
            <svg viewBox="0 0 24 24" width="44" height="44" aria-hidden="true">
              <path d="M5 12.5l4.5 4.5L19 7" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        ) : null}

        {error ? <p className="pin-modal-error">{error}</p> : null}

        <div className="pin-modal-actions">
          {stage === 'done' ? (
            <button className="primary-action" type="button" onClick={onSaved}>
              {t(language, 'enterDesktop')}
            </button>
          ) : (
            <>
              <button className="secondary-action" type="button" onClick={onClose} disabled={busy}>
                {t(language, 'cancel')}
              </button>
              {stage === 'verifyCurrent' ? (
                <button className="primary-action" type="button" disabled={busy || !isPinFormatValid(currentPin)} onClick={() => void handleVerifyCurrent()}>
                  {t(language, 'pinNext')}
                </button>
              ) : null}
              {stage === 'enterNew' ? (
                <button className="primary-action" type="button" disabled={busy || newPin.length !== PIN_LENGTH} onClick={() => handleEnterNew()}>
                  {t(language, 'pinNext')}
                </button>
              ) : null}
              {stage === 'confirmNew' ? (
                <button className="primary-action" type="button" disabled={busy || confirmPinValue.length !== PIN_LENGTH} onClick={() => void handleConfirmNew()}>
                  {t(language, 'pinConfirm')}
                </button>
              ) : null}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
