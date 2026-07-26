import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import type { Group, Language } from '../api/types';
import { nameplateToCss } from '../api/types';
import { t } from '../i18n';

type InviteEmbedProps = {
  token: string;
  language: Language;
  inviteCode: string;
  channelId?: string | null;
  currentUserId: string;
  memberGroupIds?: Set<string>;
  onJoined?: (group: Group) => void;
  onNavigate?: (groupId: string, channelId?: string | null) => void;
};

type InvitePreview = { group: Group; memberCount: number };

const invitePreviewCache = new Map<string, Promise<InvitePreview> | InvitePreview>();

function loadInvitePreview(token: string, inviteCode: string) {
  const cached = invitePreviewCache.get(inviteCode);
  if (cached) return Promise.resolve(cached);
  const promise = api.getGroupPreviewByInvite(token, inviteCode)
    .then((data) => {
      invitePreviewCache.set(inviteCode, data);
      return data;
    })
    .catch((error) => {
      invitePreviewCache.delete(inviteCode);
      throw error;
    });
  invitePreviewCache.set(inviteCode, promise);
  return promise;
}

export function InviteEmbed({ token, language, inviteCode, channelId = null, currentUserId, memberGroupIds, onJoined, onNavigate }: InviteEmbedProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    if (!('IntersectionObserver' in window)) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: '200px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    setError('');
    loadInvitePreview(token, inviteCode)
      .then((data) => setPreview(data))
      .catch(() => setError(t(language, 'inviteInvalid')))
      .finally(() => setLoading(false));
  }, [visible, token, inviteCode, language]);

  async function handleJoin() {
    if (!preview) return;
    setJoining(true);
    try {
      const payload = await api.joinGroupByInvite(token, inviteCode);
      onJoined?.(payload.group);
      onNavigate?.(payload.group.id, channelId);
    } catch {
      setError(t(language, 'inviteJoinError'));
    }
    setJoining(false);
  }

  function handleNavigate() {
    if (!preview) return;
    onNavigate?.(preview.group.id, channelId);
  }

  if (!visible || loading) return <div ref={rootRef} className="invite-embed loading"><span /></div>;
  if (error) return <div ref={rootRef} className="invite-embed error">{error}</div>;
  if (!preview) return null;

  const isMember = memberGroupIds?.has(preview.group.id) ?? false;
  const avatarSrc = preview.group.avatarData || `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="%23444" rx="20"/><text x="50" y="58" text-anchor="middle" fill="%23fff" font-size="28" font-family="sans-serif">${(preview.group.name[0]||'?').toUpperCase()}</text></svg>`;
  // Use the group's customized nameplate as the banner. When none is set, fall
  // back to a clean gradient (no blurred avatar, which looked muddy).
  const plateCss = nameplateToCss(preview.group.nameplate);
  const bannerBackground = plateCss ?? 'linear-gradient(135deg, var(--blue) 0%, color-mix(in srgb, var(--blue) 55%, #000) 100%)';

  return (
    <div ref={rootRef} className="group-embed">
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
