import { useRef, useState } from 'react';
import { api } from '../api/client';
import { readImageAsDataUrl } from '../auth/auth-file';
import type { Group, Language, NamePlate } from '../api/types';
import { DEFAULT_NAMEPLATE, nameplateToCss } from '../api/types';
import { t } from '../i18n';
import { AvatarCropper } from './AvatarCropper';
import { extractGroupInviteCode } from '../utils/group-invite-link';

type GroupCreateModalProps = {
  token: string;
  language: Language;
  onClose: () => void;
  onCreated: (group: Group) => void;
};

type Step = 'landing' | 'create' | 'join';

// A small X button pinned to the top-right of each modal view that closes the dialog.
function CloseCheck({ onClose, language }: { onClose: () => void; language: Language }) {
  return (
    <button type="button" className="modal-close-check" onClick={onClose} title={t(language, 'close')} aria-label={t(language, 'close')}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>
  );
}

export function GroupCreateModal({ token, language, onClose, onCreated }: GroupCreateModalProps) {
  const [step, setStep] = useState<Step>('landing');

  // --- Create-group state ---
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState<string | null>(null);
  const [nameplate, setNameplate] = useState<NonNullable<NamePlate>>(DEFAULT_NAMEPLATE);
  const [cropSource, setCropSource] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // Synchronous guard: `loading` updates asynchronously, so pressing Enter
  // rapidly (or Enter + click) could fire createGroup multiple times.
  const submittingRef = useRef(false);

  // --- Join-group state ---
  const [inviteText, setInviteText] = useState('');
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState('');

  async function handleAvatarFile(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith('image/') || file.size > 5_000_000) {
      setError(t(language, 'avatarTooLarge'));
      return;
    }
    try {
      setCropSource(await readImageAsDataUrl(file));
      setError('');
    } catch {
      setError(t(language, 'imageReadFailed'));
    }
  }

  async function handleNameplateImage(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith('image/') || file.size > 5_000_000) {
      setError(t(language, 'avatarTooLarge'));
      return;
    }
    try {
      const image = await readImageAsDataUrl(file);
      setNameplate((c) => ({ ...c, image }));
      setError('');
    } catch {
      setError(t(language, 'imageReadFailed'));
    }
  }

  async function handleCreate() {
    if (!name.trim() || submittingRef.current) return;
    submittingRef.current = true;
    setLoading(true);
    setError('');
    try {
      const payload = await api.createGroup(token, name.trim(), avatar ?? undefined);
      let group = payload.group;
      // Persist the chosen nameplate right after creation (createGroup only
      // accepts name + avatar).
      if (nameplate.type !== 'none') {
        try {
          const updated = await api.updateGroup(token, group.id, { nameplate });
          group = updated.group;
        } catch { /* keep the created group even if the nameplate update fails */ }
      }
      onCreated(group);
      onClose();
    } catch {
      submittingRef.current = false;
      setLoading(false);
      setError(t(language, 'unknownError'));
    }
  }

  async function handleJoin() {
    const code = extractGroupInviteCode(inviteText);
    if (!code) { setJoinError(t(language, 'inviteInvalid')); return; }
    setJoining(true);
    setJoinError('');
    try {
      const payload = await api.joinGroupByInvite(token, code);
      onCreated(payload.group);
      onClose();
    } catch {
      setJoinError(t(language, 'inviteJoinError'));
      setJoining(false);
    }
  }

  const previewAvatar = avatar || `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="%23444" rx="20"/><text x="50" y="58" text-anchor="middle" fill="%23fff" font-size="28" font-family="sans-serif">${(name[0] || '?').toUpperCase()}</text></svg>`;
  const bannerBackground = nameplateToCss(nameplate) ?? 'linear-gradient(135deg, var(--blue) 0%, color-mix(in srgb, var(--blue) 55%, #000) 100%)';

  // --- Landing: choose create or join ---
  if (step === 'landing') {
    return (
      <div className="group-onboard-panel">
        <CloseCheck onClose={onClose} language={language} />
        <div className="group-onboard-section">
          <h3>{t(language, 'createYourGroup')}</h3>
          <p className="group-onboard-blurb">{t(language, 'createGroupBlurb')}</p>
          <button type="button" className="primary-action wide" onClick={() => setStep('create')}>
            {t(language, 'createGroup')}
          </button>
        </div>
        <div className="group-onboard-divider" />
        <div className="group-onboard-section">
          <h4>{t(language, 'alreadyHaveInvite')}</h4>
          <p className="group-onboard-blurb">{t(language, 'joinGroupBlurb')}</p>
          <button type="button" className="secondary-action wide" onClick={() => setStep('join')}>
            {t(language, 'joinGroup')}
          </button>
        </div>
      </div>
    );
  }

  // --- Join: paste an invite link ---
  if (step === 'join') {
    return (
      <div className="group-create-panel">
        <CloseCheck onClose={onClose} language={language} />
        <h3>{t(language, 'joinGroup')}</h3>
        <p className="group-onboard-blurb">{t(language, 'joinGroupBlurb')}</p>
        <label>{t(language, 'inviteLink')}</label>
        <input
          type="text"
          className="messenger-input"
          value={inviteText}
          onChange={(e) => { setInviteText(e.target.value); setJoinError(''); }}
          onKeyDown={(e) => { if (e.key === 'Enter') void handleJoin(); }}
          placeholder={t(language, 'inviteLinkPlaceholder')}
          autoFocus
        />
        {joinError ? <small className="group-create-error">{joinError}</small> : null}
        <div className="group-create-actions split">
          <button type="button" className="secondary-action" onClick={() => setStep('landing')}>{t(language, 'back')}</button>
          <button type="button" className="primary-action" disabled={joining || !inviteText.trim()} onClick={() => void handleJoin()}>
            {joining ? '...' : t(language, 'joinGroup')}
          </button>
        </div>
      </div>
    );
  }

  // --- Create: form on the left, live preview on the right ---
  return (
    <div className="group-create-wide">
      <CloseCheck onClose={onClose} language={language} />
      <div className="group-create-form">
        <h3>{t(language, 'createYourGroup')}</h3>

        <div className="group-create-avatar-row">
          {avatar ? (
            <img className="group-create-avatar-preview" src={avatar} alt="" />
          ) : (
            <span className="group-create-avatar-fallback">{(name[0] ?? '?').toUpperCase()}</span>
          )}
          <input id="group-create-avatar-file" className="hidden-file" type="file" accept="image/*"
            onChange={(e) => { void handleAvatarFile(e.currentTarget.files?.[0]); e.currentTarget.value = ''; }} />
          <button type="button" className="secondary-action" onClick={() => document.getElementById('group-create-avatar-file')?.click()}>
            {t(language, 'uploadAvatar')}
          </button>
        </div>

        <label>{t(language, 'groupName')}</label>
        <input type="text" className="messenger-input" value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void handleCreate(); }}
          placeholder={t(language, 'groupName')}
          autoFocus />

        <label>{t(language, 'nameplate')}</label>
        <div className="nameplate-types">
          {(['none', 'color', 'gradient', 'image'] as const).map((type) => (
            <button
              key={type}
              type="button"
              className={nameplate.type === type ? 'nameplate-type active' : 'nameplate-type'}
              onClick={() => setNameplate((current) => ({ ...current, type }))}
            >
              {t(language, type === 'none' ? 'nameplateNone' : type === 'color' ? 'nameplateColor' : type === 'gradient' ? 'nameplateGradient' : 'nameplateImage')}
            </button>
          ))}
        </div>
        {nameplate.type === 'color' ? (
          <label className="nameplate-field">
            <span>{t(language, 'nameplateColor')}</span>
            <input type="color" value={nameplate.color} onChange={(e) => setNameplate((c) => ({ ...c, color: e.target.value }))} />
          </label>
        ) : null}
        {nameplate.type === 'gradient' ? (
          <div className="nameplate-gradient-row">
            <label className="nameplate-field">
              <span>{t(language, 'nameplateFrom')}</span>
              <input type="color" value={nameplate.gradientFrom} onChange={(e) => setNameplate((c) => ({ ...c, gradientFrom: e.target.value }))} />
            </label>
            <label className="nameplate-field">
              <span>{t(language, 'nameplateTo')}</span>
              <input type="color" value={nameplate.gradientTo} onChange={(e) => setNameplate((c) => ({ ...c, gradientTo: e.target.value }))} />
            </label>
          </div>
        ) : null}
        {nameplate.type === 'image' ? (
          <label className="secondary-action" style={{ textAlign: 'center', cursor: 'pointer' }}>
            {t(language, 'nameplateUpload')}
            <input
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.currentTarget.files?.[0];
                e.currentTarget.value = '';
                void handleNameplateImage(file);
              }}
            />
          </label>
        ) : null}

        {error ? <small className="group-create-error">{error}</small> : null}

        <div className="group-create-actions split">
          <button type="button" className="secondary-action" onClick={() => setStep('landing')}>{t(language, 'back')}</button>
          <button type="button" className="primary-action" disabled={loading || !name.trim()} onClick={() => void handleCreate()}>
            {loading ? '...' : t(language, 'createGroup')}
          </button>
        </div>
      </div>

      {/* Live preview: the same embed style the group shows in invites. */}
      <div className="group-create-preview">
        <div className="group-embed">
          <div className="group-embed-banner" style={{ background: bannerBackground }} />
          <div className="group-embed-head">
            <div className="group-embed-avatar-wrap">
              <img className="group-embed-avatar" src={previewAvatar} alt="" />
            </div>
            <div className="group-embed-info">
              <span className="group-embed-eyebrow">{t(language, 'groupInvite')}</span>
              <strong className="group-embed-name">{name || t(language, 'groupName')}</strong>
              <span className="group-embed-meta">1 {t(language, 'members')}</span>
            </div>
          </div>
          <div className="group-embed-actions">
            <button className="primary-action" type="button" disabled>{t(language, 'joinGroup')}</button>
          </div>
        </div>
      </div>

      {cropSource ? (
        <AvatarCropper
          imageDataUrl={cropSource}
          language={language}
          onCancel={() => setCropSource(null)}
          onApply={(data) => { setAvatar(data); setCropSource(null); }}
        />
      ) : null}
    </div>
  );
}
