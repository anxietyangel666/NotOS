import { useState } from 'react';
import { api } from '../api/client';
import type { AiSettings } from '../api/types';
import type { Language } from '../api/types';
import { t, type TranslationKey } from '../i18n';

// Reusable persona/character editor used by both the AI settings "Persona" tab
// and the first-run onboarding overlay. Controlled component: the parent owns
// the draft state so it can save / submit.

type Option<T extends string> = { value: T; labelKey: TranslationKey };

const GENDERS: Option<AiSettings['gender']>[] = [
  { value: 'male', labelKey: 'aiGenderMale' },
  { value: 'female', labelKey: 'aiGenderFemale' },
  { value: 'neutral', labelKey: 'aiGenderNeutral' }
];

const PERSONAS: Option<AiSettings['persona']>[] = [
  { value: 'friendly', labelKey: 'aiPersonaFriendly' },
  { value: 'professional', labelKey: 'aiPersonaProfessional' },
  { value: 'playful', labelKey: 'aiPersonaPlayful' },
  { value: 'mentor', labelKey: 'aiPersonaMentor' },
  { value: 'concise', labelKey: 'aiPersonaConcise' },
  { value: 'enthusiastic', labelKey: 'aiPersonaEnthusiastic' }
];

const TONES: Option<AiSettings['tone']>[] = [
  { value: 'formal', labelKey: 'aiToneFormal' },
  { value: 'balanced', labelKey: 'aiToneBalanced' },
  { value: 'casual', labelKey: 'aiToneCasual' }
];

const LENGTHS: Option<AiSettings['responseLength']>[] = [
  { value: 'short', labelKey: 'aiLengthShort' },
  { value: 'balanced', labelKey: 'aiLengthBalanced' },
  { value: 'detailed', labelKey: 'aiLengthDetailed' }
];

const EMOJIS: Option<AiSettings['emojiUsage']>[] = [
  { value: 'none', labelKey: 'aiEmojiNone' },
  { value: 'some', labelKey: 'aiEmojiSome' },
  { value: 'many', labelKey: 'aiEmojiMany' }
];

type SegmentedProps<T extends string> = {
  language: Language;
  label: string;
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
};

function Segmented<T extends string>({ language, label, value, options, onChange }: SegmentedProps<T>) {
  return (
    <div className="ai-persona-field">
      <label className="ai-persona-label">{label}</label>
      <div className="ai-persona-segmented" role="group" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={value === option.value ? 'ai-seg-btn active' : 'ai-seg-btn'}
            onClick={() => onChange(option.value)}
          >
            {t(language, option.labelKey)}
          </button>
        ))}
      </div>
    </div>
  );
}

type AiPersonaFormProps = {
  token: string;
  language: Language;
  draft: AiSettings;
  onChange: (patch: Partial<AiSettings>) => void;
};

export function AiPersonaForm({ token, language, draft, onChange }: AiPersonaFormProps) {
  const [generating, setGenerating] = useState(false);

  // Random/AI-assisted generator for the "how should the AI talk to you" field.
  // Uses whatever is already typed as a seed; otherwise generates from scratch.
  async function generateInstructions() {
    if (generating) return;
    setGenerating(true);
    try {
      const seed = draft.customInstructions.trim();
      const result = await api.generateAiPersonaInstructions(token, {
        seed: seed || undefined,
        language
      });
      onChange({ customInstructions: result.text });
    } catch {
      // Non-critical: leave the existing text untouched on failure.
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="ai-persona-form">
      <div className="ai-persona-block">
        <p className="ai-persona-block-title">{t(language, 'aiSectionIdentity')}</p>
        <div className="ai-persona-field">
          <label className="ai-persona-label" htmlFor="ai-persona-name">{t(language, 'aiPersonaName')}</label>
          <input
            id="ai-persona-name"
            className="text-field"
            type="text"
            maxLength={40}
            value={draft.assistantName}
            placeholder={t(language, 'aiPersonaNamePlaceholder')}
            onChange={(event) => onChange({ assistantName: event.target.value })}
          />
        </div>
        <Segmented
          language={language}
          label={t(language, 'aiPersonaGender')}
          value={draft.gender}
          options={GENDERS}
          onChange={(gender) => onChange({ gender })}
        />
      </div>

      <div className="ai-persona-block">
        <p className="ai-persona-block-title">{t(language, 'aiSectionPersonality')}</p>
        <Segmented
          language={language}
          label={t(language, 'aiPersonaCharacter')}
          value={draft.persona}
          options={PERSONAS}
          onChange={(persona) => onChange({ persona })}
        />
        <Segmented
          language={language}
          label={t(language, 'aiPersonaTone')}
          value={draft.tone}
          options={TONES}
          onChange={(tone) => onChange({ tone })}
        />
      </div>

      <div className="ai-persona-block">
        <p className="ai-persona-block-title">{t(language, 'aiSectionResponses')}</p>
        <Segmented
          language={language}
          label={t(language, 'aiPersonaLength')}
          value={draft.responseLength}
          options={LENGTHS}
          onChange={(responseLength) => onChange({ responseLength })}
        />
        <Segmented
          language={language}
          label={t(language, 'aiPersonaEmoji')}
          value={draft.emojiUsage}
          options={EMOJIS}
          onChange={(emojiUsage) => onChange({ emojiUsage })}
        />
      </div>

      <div className="ai-persona-block">
        <p className="ai-persona-block-title">{t(language, 'aiSectionInstructions')}</p>
        <div className="ai-persona-field span-2">
          <label className="ai-persona-label" htmlFor="ai-persona-address">{t(language, 'aiPersonaAddress')}</label>
          <input
            id="ai-persona-address"
            className="text-field"
            type="text"
            maxLength={40}
            value={draft.addressName}
            placeholder={t(language, 'aiPersonaAddressPlaceholder')}
            onChange={(event) => onChange({ addressName: event.target.value })}
          />
        </div>
        <div className="ai-persona-field span-2">
          <div className="ai-persona-label-row">
            <label className="ai-persona-label" htmlFor="ai-persona-custom">{t(language, 'aiPersonaCustom')}</label>
            <button
              type="button"
              className="ai-persona-random"
              disabled={generating}
              title={t(language, 'aiPersonaRandomHint')}
              onClick={() => void generateInstructions()}
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>
              {generating ? t(language, 'aiPersonaGenerating') : t(language, 'aiPersonaRandom')}
            </button>
          </div>
          <textarea
            id="ai-persona-custom"
            className="text-field ai-persona-textarea"
            rows={3}
            maxLength={2000}
            value={draft.customInstructions}
            placeholder={t(language, 'aiPersonaCustomPlaceholder')}
            onChange={(event) => onChange({ customInstructions: event.target.value })}
          />
        </div>
      </div>
    </div>
  );
}
