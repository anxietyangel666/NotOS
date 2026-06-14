import { useCallback, useState } from 'react';
import { t } from '../i18n';
import type { Language, PublicUser } from '../api/types';
import { isPinFormatValid, verifyPin } from '../utils/pin-lock';
import { PinPad } from './PinPad';
import { UserName } from './UserName';

type PinLockScreenProps = {
  language: Language;
  user: PublicUser;
  onUnlock: () => void;
  onSignOut: () => void;
};

export function PinLockScreen({ language, user, onUnlock, onSignOut }: PinLockScreenProps) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);

  const handleSubmit = useCallback(async (candidate?: string) => {
    const value = candidate ?? pin;
    if (!isPinFormatValid(value)) {
      setError(t(language, 'pinIncomplete'));
      return;
    }
    setBusy(true);
    const ok = await verifyPin(user.id, value);
    setBusy(false);
    if (!ok) {
      setError(t(language, 'pinWrong'));
      setPin('');
      setShake(true);
      window.setTimeout(() => setShake(false), 420);
      return;
    }
    onUnlock();
  }, [language, onUnlock, pin, user.id]);

  return (
    <main className="pin-lock-shell">
      <div className="onboarding-aurora" aria-hidden="true">
        <span className="onboarding-aurora-blob a" />
        <span className="onboarding-aurora-blob b" />
        <span className="onboarding-aurora-blob c" />
      </div>

      <section className={shake ? 'pin-lock-card shake' : 'pin-lock-card'}>
        <div className="pin-lock-avatar">
          <img src={user.avatarData} alt="" />
        </div>
        <UserName user={user} as="h1" />
        <p className="pin-modal-hint">{t(language, 'pinLockHint')}</p>

        <PinPad
          value={pin}
          onChange={(value) => { setPin(value); setError(''); }}
          onComplete={(value) => void handleSubmit(value)}
          invalid={Boolean(error)}
          disabled={busy}
        />

        {error ? <p className="pin-modal-error">{error}</p> : null}

        <div className="pin-lock-actions">
          <button className="primary-action" type="button" disabled={busy || pin.length !== 6} onClick={() => void handleSubmit()}>
            {t(language, 'pinUnlock')}
          </button>
          <button className="onboarding-secondary" type="button" onClick={onSignOut}>
            {t(language, 'pinForgot')}
          </button>
        </div>
      </section>
    </main>
  );
}
