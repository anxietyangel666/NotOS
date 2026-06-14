import { useEffect, useState, useCallback } from 'react';
import { LANGUAGES, THEMES, t } from '../i18n';
import type { Language, Theme } from '../api/types';
import { storeTheme, getStoredTheme } from '../i18n';

type OnboardingStep = 'welcome' | 'language' | 'theme' | 'ready';

type OnboardingProps = {
  language: Language;
  onLanguageChange: (language: Language) => void;
  onComplete: (language: Language, theme: Theme) => void;
};

const STEP_ORDER: OnboardingStep[] = ['welcome', 'language', 'theme', 'ready'];

export function Onboarding({ language, onLanguageChange, onComplete }: OnboardingProps) {
  const [step, setStep] = useState<OnboardingStep>('welcome');
  const [theme, setTheme] = useState<Theme>(() => getStoredTheme());
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const id = window.setTimeout(() => setMounted(true), 40);
    return () => window.clearTimeout(id);
  }, []);

  const goNext = useCallback(() => {
    setStep((current) => {
      const index = STEP_ORDER.indexOf(current);
      return STEP_ORDER[Math.min(index + 1, STEP_ORDER.length - 1)];
    });
  }, []);

  const goBack = useCallback(() => {
    setStep((current) => {
      const index = STEP_ORDER.indexOf(current);
      return STEP_ORDER[Math.max(index - 1, 0)];
    });
  }, []);

  const handleLanguageSelect = useCallback((lang: Language) => {
    onLanguageChange(lang);
  }, [onLanguageChange]);

  const handleThemeSelect = useCallback((selectedTheme: Theme) => {
    setTheme(selectedTheme);
    storeTheme(selectedTheme);
    document.documentElement.dataset.theme = selectedTheme;
  }, []);

  const handleFinish = useCallback(() => {
    onComplete(language, theme);
  }, [language, theme, onComplete]);

  const stepIndex = STEP_ORDER.indexOf(step);

  return (
    <main className={mounted ? 'onboarding-shell mounted' : 'onboarding-shell'}>
      <div className="onboarding-aurora" aria-hidden="true">
        <span className="onboarding-aurora-blob a" />
        <span className="onboarding-aurora-blob b" />
        <span className="onboarding-aurora-blob c" />
      </div>

      <div className="onboarding-progress" aria-hidden="true">
        {STEP_ORDER.map((stepName, index) => (
          <span
            key={stepName}
            className={index <= stepIndex ? 'onboarding-progress-dot active' : 'onboarding-progress-dot'}
          />
        ))}
      </div>

      <div className="onboarding-stage" key={step}>
        {step === 'welcome' ? (
          <section className="onboarding-card welcome">
            <div className="onboarding-logo-wrap">
              <div className="onboarding-logo">N</div>
              <span className="onboarding-logo-ring" aria-hidden="true" />
              <span className="onboarding-logo-glow" aria-hidden="true" />
            </div>
            <h1>{t(language, 'welcomeTitle')}</h1>
            <p>{t(language, 'welcomeSubtitle')}</p>
            <div className="onboarding-actions single">
              <button className="onboarding-primary" type="button" onClick={goNext}>
                {t(language, 'onboardingGetStarted')}
              </button>
            </div>
          </section>
        ) : null}

        {step === 'language' ? (
          <section className="onboarding-card">
            <header className="onboarding-card-head">
              <p className="onboarding-eyebrow">{t(language, 'onboardingStepLanguage')}</p>
              <h1>{t(language, 'onboardingLanguage')}</h1>
              <p className="onboarding-sub">{t(language, 'onboardingLanguageHint')}</p>
            </header>
            <div className="onboarding-options">
              {LANGUAGES.map((lang) => (
                <button
                  key={lang.code}
                  className={language === lang.code ? 'onboarding-option active' : 'onboarding-option'}
                  type="button"
                  onClick={() => handleLanguageSelect(lang.code)}
                >
                  <span className="onboarding-option-flag" aria-hidden="true">{flagFor(lang.code)}</span>
                  <span className="onboarding-option-label">{lang.name}</span>
                  <span className="onboarding-option-check" aria-hidden="true">✓</span>
                </button>
              ))}
            </div>
            <div className="onboarding-actions">
              <button className="onboarding-secondary" type="button" onClick={goBack}>
                {t(language, 'onboardingBack')}
              </button>
              <button className="onboarding-primary" type="button" onClick={goNext}>
                {t(language, 'onboardingNext')}
              </button>
            </div>
          </section>
        ) : null}

        {step === 'theme' ? (
          <section className="onboarding-card">
            <header className="onboarding-card-head">
              <p className="onboarding-eyebrow">{t(language, 'onboardingStepTheme')}</p>
              <h1>{t(language, 'onboardingTheme')}</h1>
              <p className="onboarding-sub">{t(language, 'onboardingThemeHint')}</p>
            </header>
            <div className="onboarding-themes">
              {THEMES.map((themeItem) => (
                <button
                  key={themeItem.code}
                  className={theme === themeItem.code ? 'onboarding-theme active' : 'onboarding-theme'}
                  type="button"
                  onClick={() => handleThemeSelect(themeItem.code)}
                >
                  <div className={`onboarding-theme-preview ${themeItem.code}`}>
                    <span className="onboarding-theme-bar" />
                    <span className="onboarding-theme-dot" />
                  </div>
                  <span className="onboarding-theme-label">{t(language, themeItem.nameKey)}</span>
                </button>
              ))}
            </div>
            <div className="onboarding-actions">
              <button className="onboarding-secondary" type="button" onClick={goBack}>
                {t(language, 'onboardingBack')}
              </button>
              <button className="onboarding-primary" type="button" onClick={goNext}>
                {t(language, 'onboardingNext')}
              </button>
            </div>
          </section>
        ) : null}

        {step === 'ready' ? (
          <section className="onboarding-card ready">
            <div className="onboarding-success">
              <svg viewBox="0 0 24 24" width="44" height="44" aria-hidden="true">
                <path d="M5 12.5l4.5 4.5L19 7" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <h1>{t(language, 'onboardingReadyTitle')}</h1>
            <p>{t(language, 'onboardingReadyHint')}</p>
            <div className="onboarding-actions">
              <button className="onboarding-secondary" type="button" onClick={goBack}>
                {t(language, 'onboardingBack')}
              </button>
              <button className="onboarding-primary" type="button" onClick={handleFinish}>
                {t(language, 'onboardingFinish')}
              </button>
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}

function flagFor(code: Language): string {
  switch (code) {
    case 'en': return '🇬🇧';
    case 'ru': return '🇷🇺';
    case 'uk': return '🇺🇦';
    default: return '🌐';
  }
}
