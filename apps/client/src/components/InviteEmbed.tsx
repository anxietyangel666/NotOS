import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import type { Group, Language } from '../api/types';
import { nameplateToCss } from '../api/types';
import { t } from '../i18n';

type InviteEmbedProps = {
  token: string;
  language: Language;
  inviteCode: string;
  currentUserId: string;
  memberGroupIds?: Set<string>;
  onJoined?: (group: Group) => void;
  onNavigate?: (groupId: string) => void;
};

export function InviteEmbed({ token, language, inviteCode, currentUserId, memberGroupIds, onJoined, onNavigate }: InviteEmbedProps) {
  const [preview, setPreview] = useState<{ group: Group; memberCount: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError('');
    api.getGroupPreviewByInvite(token, inviteCode)
      .then((data) => setPreview(data))
      .catch(() => setError(t(language, 'inviteInvalid')))
      .finally(() => setLoading(false));
  }, [token, inviteCode, language]);

  async function handleJoin() {
    if (!preview) return;
    setJoining(true);
    try {
      const payload = await api.joinGroupByInvite(token, inviteCode);
      onJoined?.(payload.group);
      onNavigate?.(payload.group.id);
    } catch {
      setError(t(language, 'inviteJoinError'));
    }
    setJoining(false);
  }

  function handleNavigate() {
    if (!preview) return;
    onNavigate?.(preview.group.id);
  }

  if (loading) return <div className="invite-embed loading"><span /></div>;
  if (error) return <div className="invite-embed error">{error}</div>;
  if (!preview) return null;

  const isMember = memberGroupIds?.has(preview.group.id) ?? false;
  const avatarSrc = preview.group.avatarData || `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="%23444" rx="20"/><text x="50" y="58" text-anchor="middle" fill="%23fff" font-size="28" font-family="sans-serif">${(preview.group.name[0]||'?').toUpperCase()}</text></svg>`;
  // Use the group's customized nameplate as the banner. When none is set, fall
  // back to a clean gradient (no blurred avatar, which looked muddy).
  const plateCss = nameplateToCss(preview.group.nameplate);
  const bannerBackground = plateCss ?? 'linear-gradient(135deg, var(--blue) 0%, color-mix(in srgb, var(--blue) 55%, #000) 100%)';

  return (
    <div className="group-embed">
      <div className="group-embed-banner" style={{ background: bannerBackground }} />
      <div className="group-embed-head">
        <div className="group-embed-avatar-wrap">
          <img className="group-embed-avatar" src={avatarSrc} alt="" />
        </div>
        <div className="group-embed-info">
          <span className="group-embed-eyebrow">{t(language, 'groupInvite')}</span>
          <strong className="group-embed-name">{preview.group.name}</strong>
          <span className="group-embed-meta">{preview.memberCount} {t(language, 'members')}</span>
        </div>
      </div>
      {preview.group.description ? (
        <p className="group-embed-description">{preview.group.description}</p>
      ) : null}
      <div className="group-embed-actions">
        {isMember ? (
          <button className="primary-action" type="button" onClick={handleNavigate}>
            {t(language, 'openChat')}
          </button>
        ) : (
          <button className="primary-action" type="button" disabled={joining} onClick={() => void handleJoin()}>
            {joining ? '...' : t(language, 'joinGroup')}
          </button>
        )}
      </div>
    </div>
  );
}
