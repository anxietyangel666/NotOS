import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api/client';
import type { Language, PublicUser } from '../api/types';
import { t } from '../i18n';
import { Twemoji } from './Twemoji';
import { UserName } from './UserName';
import { UserBadges } from './UserBadges';

type UserEmbedProps = {
  token: string;
  language: Language;
  userId: string;
  currentUserId: string;
  onOpenChat?: (user: PublicUser) => void;
  onOpenProfile?: (user: PublicUser) => void;
  onOpenDesktop?: (user: PublicUser) => void;
  onEditProfile?: () => void;
};

export function UserEmbed({ token, language, userId, currentUserId, onOpenChat, onOpenProfile, onOpenDesktop, onEditProfile }: UserEmbedProps) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [friendState, setFriendState] = useState<'none' | 'pending' | 'friends'>('none');
  const [friendBusy, setFriendBusy] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const isSelf = userId === currentUserId;

  function wallpaperBackground(value: string, theme: string) {
    const isDark = theme === 'dark' || theme === 'system-black';
    if (!value) {
      return isDark
        ? 'linear-gradient(135deg, #111827 0%, #172033 48%, #0b1220 100%)'
        : 'linear-gradient(135deg, #dff1ff 0%, #f7fbff 48%, #e8f0f8 100%)';
    }
    if (value.startsWith('data:image/')) return `url("${value}")`;
    return value;
  }

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    api.getPublicUser(token, userId)
      .then((data) => { if (alive) setUser(data.user); })
      .catch(() => { if (alive) setError(t(language, 'unknownError')); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [token, userId, language]);

  useEffect(() => {
    if (isSelf) return;
    let alive = true;
    Promise.all([api.getFriends(token), api.getFriendRequests(token)])
      .then(([friendsResult, requestsResult]) => {
        if (!alive) return;
        if (friendsResult.friends.some((f) => f.id === userId)) setFriendState('friends');
        else if (requestsResult.requests.outgoing.some((f) => f.id === userId)) setFriendState('pending');
        else setFriendState('none');
      })
      .catch(() => { if (alive) setFriendState('none'); });
    return () => { alive = false; };
  }, [token, userId, isSelf]);

  useEffect(() => {
    if (!menu) return;
    function close(event: globalThis.MouseEvent) {
      const target = event.target as Element | null;
      if (target?.closest?.('.context-menu')) return;
      setMenu(null);
    }
    const raf = window.requestAnimationFrame(() => window.addEventListener('mousedown', close));
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('mousedown', close);
    };
  }, [menu]);

  async function toggleFriend() {
    if (isSelf || friendBusy) return;
    if (friendState === 'friends') {
      setConfirmRemove(true);
      return;
    }
    setFriendBusy(true);
    try {
      if (friendState === 'pending') {
        await api.deleteFriendRequest(token, userId);
        setFriendState('none');
      } else {
        const result = await api.addFriend(token, userId);
        setFriendState(result.status === 'pending' ? 'pending' : 'friends');
      }
    } catch {
      // ignore
    } finally {
      setFriendBusy(false);
    }
  }

  async function removeFriendConfirmed() {
    if (isSelf || friendBusy) return;
    setFriendBusy(true);
    try {
      await api.removeFriend(token, userId);
      setFriendState('none');
    } catch {
      // ignore
    } finally {
      setFriendBusy(false);
      setConfirmRemove(false);
    }
  }

  if (loading) return <div className="invite-embed loading"><span /></div>;
  if (error || !user) return <div className="invite-embed error">{error || t(language, 'unknownError')}</div>;

  return (
    <div
      className="user-embed profile-themed"
      style={{
        ['--profile-primary' as string]: user.profilePrimaryColor || '#2AABEE',
        ['--profile-accent' as string]: user.profileAccentColor || '#5865F2'
      }}
    >
      <div
        className="user-embed-banner"
        style={{ backgroundImage: wallpaperBackground(user.wallpaper, user.theme) }}
      />
      <div className="user-embed-head">
        <div
          className="user-embed-avatar-wrap"
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setMenu({ x: event.clientX, y: event.clientY });
          }}
          onClick={() => onOpenProfile?.(user)}
        >
          <img className="user-embed-avatar" src={user.avatarData} alt="" />
        </div>
        <div className="user-embed-info">
          <UserName user={user} as="strong" className="user-embed-name" />
          <UserBadges user={user} language={language} />
          {user.status ? <span className="user-embed-meta">{user.status}</span> : null}
        </div>
      </div>
      {!isSelf ? (
        <div className="user-embed-actions">
          <button className="primary-action" type="button" onClick={() => onOpenChat?.(user)}>
            {t(language, 'sendMessage')}
          </button>
          <button
            className={friendState === 'friends' ? 'profile-friend-btn remove' : 'profile-friend-btn add'}
            type="button"
            disabled={friendBusy}
            onClick={() => void toggleFriend()}
            title={friendState === 'friends'
              ? t(language, 'removeFriend')
              : friendState === 'pending'
                ? t(language, 'cancelRequest')
                : t(language, 'addFriend')}
          >
            <Twemoji emoji={friendState === 'friends' ? '❌' : friendState === 'pending' ? '⏳' : '➕'} size={18} />
          </button>
        </div>
      ) : onEditProfile ? (
        <div className="user-embed-actions">
          <button className="primary-action" type="button" onClick={() => onEditProfile()}>
            {t(language, 'editProfile')}
          </button>
        </div>
      ) : null}

      {confirmRemove ? createPortal(
        <div className="modal-backdrop important" onClick={() => setConfirmRemove(false)}>
          <section className="confirm-dialog" onClick={(event) => event.stopPropagation()}>
            <p>{t(language, 'confirmRemoveFriend')}</p>
            <div className="confirm-actions">
              <button className="secondary-action" type="button" disabled={friendBusy} onClick={() => setConfirmRemove(false)}>
                {t(language, 'cancel')}
              </button>
              <button className="primary-action danger-text" type="button" disabled={friendBusy} onClick={() => void removeFriendConfirmed()}>
                {t(language, 'removeFriend')}
              </button>
            </div>
          </section>
        </div>,
        document.body
      ) : null}

      {menu ? createPortal(
        <div
          className="context-menu messenger-user-menu"
          style={{ left: menu.x, top: menu.y }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <button type="button" onClick={() => { onOpenProfile?.(user); setMenu(null); }}>
            {t(language, 'viewProfile')}
          </button>
          {onOpenDesktop ? (
            <button type="button" onClick={() => { onOpenDesktop(user); setMenu(null); }}>
              {t(language, 'viewDesktop')}
            </button>
          ) : null}
        </div>,
        document.body
      ) : null}
    </div>
  );
}
