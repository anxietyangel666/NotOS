import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Language } from '../api/types';
import { t } from '../i18n';
import { api } from '../api/client';
import { getOrFetchUser } from '../api/user-cache';
import { installSharedPack, findInstalledSharedPack, removePack, subscribeCustomEmoji, type SharedPack } from '../utils/custom-emoji';

// Fallback avatar (a neutral circle with the sharer's initial) for when the
// shared-pack snapshot carries no avatar.
function fallbackAvatar(name: string): string {
  const letter = (name[0] || '?').toUpperCase();
  return `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="%23444" rx="50"/><text x="50" y="60" text-anchor="middle" fill="%23fff" font-size="42" font-family="sans-serif">${letter}</text></svg>`;
}

type Props = {
  token: string;
  language: Language;
  shared: SharedPack;
};

// Inline chat embed for a shared custom-emoji pack. Shows a strip of emoji at
// the top, a gradient fade, and Add / View actions. "View" opens a modal with
// the sharer's identity and the full emoji list.
export function CustomEmojiPackEmbed({ token, language, shared }: Props) {
  // Track whether an identical pack is already installed, and the local id of
  // that copy so the embed can remove it. Stays in sync via the shared store.
  const [installedId, setInstalledId] = useState<string | null>(() => findInstalledSharedPack(shared)?.id ?? null);
  const [viewOpen, setViewOpen] = useState(false);
  // Live sharer profile (avatar + name). The link only carries a snapshot (and
  // may omit a large avatar), so fetch the current profile by id and prefer it.
  const [liveSharer, setLiveSharer] = useState<{ name: string; avatar: string } | null>(null);

  useEffect(() => subscribeCustomEmoji(() => setInstalledId(findInstalledSharedPack(shared)?.id ?? null)), [shared]);

  const { pack, sharedBy } = shared;

  useEffect(() => {
    let alive = true;
    if (!sharedBy.id) return;
    getOrFetchUser(sharedBy.id, (id) => api.getPublicUser(token, id).then((res) => res.user))
      .then((user) => {
        if (alive) setLiveSharer({ name: user.nickname, avatar: user.avatarData });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [token, sharedBy.id]);

  const previewEmojis = useMemo(() => pack.emojis.slice(0, 8), [pack.emojis]);
  const sharerName = liveSharer?.name || sharedBy.name;
  const avatar = liveSharer?.avatar || sharedBy.avatar || fallbackAvatar(sharerName);
  const installed = installedId !== null;

  function handleToggle() {
    if (installedId) {
      removePack(installedId);
    } else {
      installSharedPack(shared);
    }
  }

  return (
    <div className="pack-embed">
      <div className="pack-embed-preview">
        {previewEmojis.length > 0 ? (
          previewEmojis.map((emoji) => (
            <img key={emoji.id} src={emoji.url} alt={`:${emoji.name}:`} title={`:${emoji.name}:`} width={34} height={34} loading="lazy" decoding="async" draggable={false} />
          ))
        ) : null}
        <span className="pack-embed-fade" />
      </div>
      <div className="pack-embed-body">
        <span className="pack-embed-eyebrow">{t(language, 'customEmojiPackShared')}</span>
        <strong className="pack-embed-name">{pack.name}</strong>
        <span className="pack-embed-meta">{t(language, 'customEmojiCount', { count: String(pack.emojis.length) })}</span>
      </div>
      <div className="pack-embed-actions">
        {installed ? (
          <button type="button" className="secondary-action danger-text compact-action" onClick={handleToggle}>
            {t(language, 'customEmojiRemove')}
          </button>
        ) : (
          <button type="button" className="primary-action compact-action" onClick={handleToggle}>
            {t(language, 'customEmojiAdd')}
          </button>
        )}
        <button type="button" className="secondary-action compact-action" onClick={() => setViewOpen(true)}>
          {t(language, 'customEmojiView')}
        </button>
      </div>

      {viewOpen
        ? createPortal(
            <div className="pack-view-backdrop" onMouseDown={() => setViewOpen(false)}>
              <div className="pack-view-modal" onMouseDown={(event) => event.stopPropagation()}>
                <header className="pack-view-head">
                  <div className="pack-view-sharer">
                    <img src={avatar} alt="" className="pack-view-avatar" draggable={false} />
                    <div className="pack-view-titles">
                      <strong>{pack.name}</strong>
                      <small>{t(language, 'customEmojiSharedBy', { name: sharerName })}</small>
                    </div>
                  </div>
                  <button type="button" className="pack-view-close" aria-label={t(language, 'close')} onClick={() => setViewOpen(false)}>×</button>
                </header>
                <div className="pack-view-grid">
                  {pack.emojis.map((emoji) => (
                    <div className="pack-view-emoji" key={emoji.id} title={`:${emoji.name}:`}>
                      <img src={emoji.url} alt={`:${emoji.name}:`} width={44} height={44} loading="lazy" decoding="async" draggable={false} />
                      <span>:{emoji.name}:</span>
                    </div>
                  ))}
                </div>
                <footer className="pack-view-foot">
                  {installed ? (
                    <button type="button" className="secondary-action danger-text" onClick={handleToggle}>
                      {t(language, 'customEmojiRemove')}
                    </button>
                  ) : (
                    <button type="button" className="primary-action" onClick={handleToggle}>
                      {t(language, 'customEmojiAdd')}
                    </button>
                  )}
                </footer>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
