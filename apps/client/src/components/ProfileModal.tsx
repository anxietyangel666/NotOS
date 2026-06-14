import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api/client';
import type { Group, GroupRole, Language, PublicUser } from '../api/types';
import { LOCALES, t } from '../i18n';
import { buildProfileLink } from '../utils/profile-link';
import { nameStyleClass, nameStyleToCss } from '../utils/name-style';
import { Twemoji } from './Twemoji';
import { UserBadges } from './UserBadges';
import { EmojiPicker } from './EmojiPicker';
import { EmojiToggleIcon } from './ChatComposeIcons';

export type ProfileModalProps = {
  user: PublicUser;
  currentUser: PublicUser;
  group?: Group;
  onlineUserIds?: string[];
  language: Language;
  token: string;
  zIndex?: number;
  /** When opened from the desktop, render the card semi-transparent. */
  translucent?: boolean;
  onClose: () => void;
  onUserChange?: (user: PublicUser) => void;
  onOpenChat?: (userId: string) => void;
  onOpenDesktop?: (user: PublicUser) => void;
  onOpenProfile?: (user: PublicUser) => void;
  onOpenGroup?: (group: Group) => void;
  onEditProfile?: () => void;
};

function wallpaperToBackground(value: string, theme: string) {
  const isDark = theme === 'dark' || theme === 'system-black';
  if (!value) {
    return isDark
      ? 'linear-gradient(135deg, #111827 0%, #172033 48%, #0b1220 100%)'
      : 'linear-gradient(135deg, #dff1ff 0%, #f7fbff 48%, #e8f0f8 100%)';
  }
  if (value.startsWith('data:image/')) return `url("${value}")`;
  return value;
}

export function ProfileModal({
  user,
  currentUser,
  group,
  onlineUserIds,
  language,
  token,
  zIndex,
  translucent = false,
  onClose,
  onUserChange,
  onOpenChat,
  onOpenDesktop,
  onOpenProfile,
  onOpenGroup,
  onEditProfile
}: ProfileModalProps) {
  const isSelf = user.id === currentUser.id;
  const isOnline = isSelf || (onlineUserIds ?? []).includes(user.id);
  const [statusDraft, setStatusDraft] = useState(user.status ?? '');
  const [savingStatus, setSavingStatus] = useState(false);
  const [editingStatus, setEditingStatus] = useState(false);
  const [messageDraft, setMessageDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [friendSince, setFriendSince] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [mutualTab, setMutualTab] = useState<'friends' | 'groups'>('friends');
  const [mutualFriends, setMutualFriends] = useState<PublicUser[] | null>(null);
  const [mutualGroups, setMutualGroups] = useState<Group[] | null>(null);
  const [avatarMenu, setAvatarMenu] = useState<{ x: number; y: number } | null>(null);
  const [mutualFriendMenu, setMutualFriendMenu] = useState<{ x: number; y: number; friend: PublicUser } | null>(null);
  const [groupRoles, setGroupRoles] = useState<GroupRole[]>([]);
  const [userRoles, setUserRoles] = useState<GroupRole[]>([]);
  const [friendState, setFriendState] = useState<'none' | 'pending' | 'friends'>('none');
  const [friendBusy, setFriendBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [profileEmojiOpen, setProfileEmojiOpen] = useState(false);
  const profileEmojiAnchorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (group) {
      void api.getGroupRoles(token, group.id).then((payload) => {
        setGroupRoles(payload.roles);
        void api.getGroupMembers(token, group.id).then((memPayload) => {
          const member = memPayload.members.find((m) => m.user.id === user.id);
          if (member?.roleId) {
            setUserRoles(payload.roles.filter((r) => r.id === member.roleId));
          }
        });
      });
    } else {
      setGroupRoles([]);
      setUserRoles([]);
    }
  }, [token, group, user.id]);

  useEffect(() => {
    setStatusDraft(user.status ?? '');
    setEditingStatus(false);
  }, [user.status, user.id]);

  useEffect(() => {
    if (isSelf) {
      setStatusDraft(currentUser.status ?? '');
    }
  }, [currentUser.status, currentUser.id, isSelf]);

  useEffect(() => {
    if (isSelf) setExpanded(false);
  }, [isSelf, user.id]);

  useEffect(() => {
    if (!isSelf) {
      api.getFriendshipDate(token, user.id)
        .then((result) => setFriendSince(result.createdAt))
        .catch(() => setFriendSince(null));
    }
  }, [token, user.id, isSelf]);

  useEffect(() => {
    if (isSelf) return;
    let alive = true;
    Promise.all([api.getFriends(token), api.getFriendRequests(token)])
      .then(([friendsResult, requestsResult]) => {
        if (!alive) return;
        if (friendsResult.friends.some((f) => f.id === user.id)) {
          setFriendState('friends');
        } else if (requestsResult.requests.outgoing.some((f) => f.id === user.id)) {
          setFriendState('pending');
        } else {
          setFriendState('none');
        }
      })
      .catch(() => { if (alive) setFriendState('none'); });
    return () => { alive = false; };
  }, [token, user.id, isSelf]);

  async function toggleFriend() {
    if (isSelf || friendBusy) return;
    // Removing a friend requires explicit confirmation.
    if (friendState === 'friends') {
      setConfirmRemove(true);
      return;
    }
    setFriendBusy(true);
    try {
      if (friendState === 'pending') {
        await api.deleteFriendRequest(token, user.id);
        setFriendState('none');
      } else {
        const result = await api.addFriend(token, user.id);
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
      await api.removeFriend(token, user.id);
      setFriendState('none');
    } catch {
      // ignore
    } finally {
      setFriendBusy(false);
      setConfirmRemove(false);
    }
  }



  useEffect(() => {
    if (expanded && !isSelf) {
      api.getMutualFriends(token, user.id)
        .then((result) => setMutualFriends(result.friends))
        .catch(() => setMutualFriends([]));
      api.getMutualGroups(token, user.id)
        .then((result) => setMutualGroups(result.groups))
        .catch(() => setMutualGroups([]));
    }
  }, [expanded, token, user.id, isSelf]);

  useEffect(() => {
    if (!avatarMenu && !mutualFriendMenu) return;
    function closeMenu(event: globalThis.MouseEvent) {
      const target = event.target as Node | null;
      if (target && (target as Element).closest?.('.context-menu')) return;
      setAvatarMenu(null);
      setMutualFriendMenu(null);
    }
    const rafId = window.requestAnimationFrame(() => {
      window.addEventListener('mousedown', closeMenu);
    });
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('mousedown', closeMenu);
    };
  }, [avatarMenu, mutualFriendMenu]);

  function formatDate(value: string) {
    return new Intl.DateTimeFormat(LOCALES[language], {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    }).format(new Date(value));
  }

  async function saveStatus() {
    if (!isSelf) return;
    setSavingStatus(true);
    try {
      const result = await api.updateMe(token, { status: statusDraft.trim() });
      onUserChange?.(result.user);
      // Close the editor and show the saved status once persisted.
      setStatusDraft(result.user.status ?? '');
      setEditingStatus(false);
    } catch {
      // ignore
    } finally {
      setSavingStatus(false);
    }
  }

  async function sendMessage() {
    if (!messageDraft.trim() || isSelf) return;
    setSending(true);
    try {
      await api.sendMessage(token, user.id, messageDraft.trim());
      setMessageDraft('');
      onOpenChat?.(user.id);
    } catch {
      // ignore
    } finally {
      setSending(false);
    }
  }

  return createPortal(
    <div
      className="modal-backdrop important"
      style={zIndex !== undefined ? { zIndex } : undefined}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={`profile-modal-card profile-themed${expanded ? ' expanded' : ''}${translucent ? ' translucent' : ''}`}
        style={{
          ['--profile-primary' as string]: user.profilePrimaryColor || '#2AABEE',
          ['--profile-accent' as string]: user.profileAccentColor || '#5865F2'
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div
          className="profile-banner"
          style={{ backgroundImage: wallpaperToBackground(user.wallpaper, user.theme) }}
        >
          {!isSelf ? (
            <div className="profile-friend-btn-wrap">
              <button
                className={friendState === 'friends' ? 'profile-friend-btn remove profile-banner-friend-btn' : 'profile-friend-btn add profile-banner-friend-btn'}
                type="button"
                disabled={friendBusy}
                onClick={() => void toggleFriend()}
              >
                <Twemoji emoji={friendState === 'friends' ? '❌' : friendState === 'pending' ? '⏳' : '➕'} size={18} />
              </button>
              <span className="profile-friend-tooltip" role="tooltip">
                {friendState === 'friends'
                  ? t(language, 'removeFriend')
                  : friendState === 'pending'
                    ? t(language, 'cancelRequest')
                    : t(language, 'addFriend')}
              </span>
            </div>
          ) : null}
        </div>
        <div className="profile-body">
          <div className="profile-main">
            <div
              className="profile-avatar-wrap"
              style={{ cursor: isSelf ? undefined : 'pointer' }}
              onClick={() => {
                if (!isSelf) setExpanded((v) => !v);
              }}
              onContextMenu={isSelf ? undefined : (event) => {
                event.preventDefault();
                event.stopPropagation();
                setAvatarMenu({ x: event.clientX, y: event.clientY });
              }}
            >
              <img src={user.avatarData} alt="" draggable={false} />
              <span className={isOnline ? 'profile-presence online' : 'profile-presence'} />
            </div>
            <div className="profile-link-row">
              <input
                className="text-field profile-link-input"
                type="text"
                readOnly
                value={buildProfileLink(user.id)}
                onFocus={(event) => event.currentTarget.select()}
              />
            </div>
            <div className="profile-info">
              <div className="profile-name-row">
                <h3 className={nameStyleClass(user.nameStyle)} style={nameStyleToCss(user.nameStyle)}>{user.nickname}</h3>
                <small className={isOnline ? 'profile-state online' : 'profile-state'}>
                  {isOnline ? t(language, 'online') : t(language, 'offline')}
                </small>
              </div>
              <UserBadges user={user} language={language} />
              {group && userRoles.length > 0 ? (
                <div className="profile-group-roles">
                  {userRoles.map((role) => (
                    <span key={role.id} className="profile-group-role" style={{ color: role.color }}>
                      {role.name}
                    </span>
                  ))}
                </div>
              ) : null}

              {isSelf ? (
                editingStatus ? (
                  <div className="profile-status-editor">
                    <label className="field-label compact">{t(language, 'profileStatus')}</label>
                    <div style={{ position: 'relative' }}>
                      <textarea
                        className="text-field"
                        value={statusDraft}
                        maxLength={200}
                        rows={3}
                        style={{ resize: 'none' }}
                        onChange={(event) => setStatusDraft(event.target.value)}
                      />
                      <span className="char-count" style={{ position: 'absolute', top: 6, right: 10, pointerEvents: 'none' }}>{statusDraft.length}/200</span>
                    </div>
                    <div className="profile-actions">
                      <button
                        className="primary-action"
                        type="button"
                        disabled={savingStatus || statusDraft.trim() === (user.status ?? '').trim()}
                        onClick={() => void saveStatus()}
                      >
                        {savingStatus ? t(language, 'saving') : t(language, 'save')}
                      </button>
                      <button
                        className="secondary-action"
                        type="button"
                        disabled={savingStatus}
                        onClick={() => { setEditingStatus(false); setStatusDraft(user.status ?? ''); }}
                      >
                        {t(language, 'cancel')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="profile-status" style={{ cursor: 'pointer' }} onDoubleClick={() => setEditingStatus(true)}>
                    {user.status || t(language, 'noStatus')}
                  </p>
                )
              ) : (
                <p className="profile-status">{user.status || t(language, 'noStatus')}</p>
              )}

              <div className="profile-dates">
                <small>{t(language, 'memberSince')}: {formatDate(user.createdAt)}</small>
                {!isSelf && friendSince ? (
                  <small>{t(language, 'friendsSince')}: {formatDate(friendSince)}</small>
                ) : null}
              </div>

              {isSelf && onEditProfile ? (
                <div className="profile-actions">
                  <button
                    className="primary-action"
                    type="button"
                    onClick={() => {
                      onEditProfile();
                      onClose();
                    }}
                  >
                    {t(language, 'editProfile')}
                  </button>
                </div>
              ) : null}

              {!isSelf ? (
                <div className="profile-message-area">
                  <div className="emoji-input-shell profile-message-compose">
                    <input
                      className="emoji-inline-input"
                      type="text"
                      placeholder={t(language, 'typeMessage')}
                      value={messageDraft}
                      maxLength={2000}
                      disabled={sending}
                      onChange={(event) => setMessageDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.shiftKey) {
                          event.preventDefault();
                          void sendMessage();
                        }
                      }}
                    />
                    <div ref={profileEmojiAnchorRef} className="emoji-host inline">
                      <button
                        className="emoji-toggle inline"
                        type="button"
                        aria-label={t(language, 'emoji')}
                        onMouseDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          setProfileEmojiOpen((v) => !v);
                        }}
                      >
                        <EmojiToggleIcon />
                      </button>
                      {profileEmojiOpen ? (
                        <EmojiPicker
                          language={language}
                          anchorRef={profileEmojiAnchorRef}
                          placement="top-end"
                          onSelect={(emoji) => {
                            setMessageDraft((v) => `${v}${emoji}`);
                            setProfileEmojiOpen(false);
                          }}
                          onClose={() => setProfileEmojiOpen(false)}
                        />
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          {expanded && !isSelf ? (
            <div className="profile-side">
              <div className="profile-mutual-tabs" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={mutualTab === 'friends'}
                  className={mutualTab === 'friends' ? 'profile-mutual-tab active' : 'profile-mutual-tab'}
                  onClick={() => setMutualTab('friends')}
                >
                  {t(language, 'mutualFriends')}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mutualTab === 'groups'}
                  className={mutualTab === 'groups' ? 'profile-mutual-tab active' : 'profile-mutual-tab'}
                  onClick={() => setMutualTab('groups')}
                >
                  {t(language, 'mutualGroups')}
                </button>
              </div>

              {mutualTab === 'friends' ? (
                mutualFriends === null ? (
                  <div className="explorer-empty">{t(language, 'loading')}</div>
                ) : mutualFriends.length === 0 ? (
                  <div className="explorer-empty">{t(language, 'noFriends')}</div>
                ) : (
                  <div className="profile-mutual-list">
                    {mutualFriends.map((friend) => (
                      <div className="profile-mutual-item" key={friend.id} style={{ cursor: 'pointer' }} onContextMenu={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setMutualFriendMenu({ x: event.clientX, y: event.clientY, friend });
                      }}>
                        <img src={friend.avatarData} alt="" />
                        <span>{friend.nickname}</span>
                      </div>
                    ))}
                  </div>
                )
              ) : (
                mutualGroups === null ? (
                  <div className="explorer-empty">{t(language, 'loading')}</div>
                ) : mutualGroups.length === 0 ? (
                  <div className="explorer-empty">{t(language, 'mutualGroups')}: 0</div>
                ) : (
                  <div className="profile-mutual-list">
                    {mutualGroups.map((mutualGroup) => (
                      <div
                        className="profile-mutual-item"
                        key={mutualGroup.id}
                        style={onOpenGroup ? { cursor: 'pointer' } : undefined}
                        onClick={() => {
                          if (!onOpenGroup) return;
                          onOpenGroup(mutualGroup);
                          onClose();
                        }}
                      >
                        <img
                          src={mutualGroup.avatarData || `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="%23444" rx="20"/><text x="50" y="58" text-anchor="middle" fill="%23fff" font-size="28" font-family="sans-serif">${(mutualGroup.name[0] || '?').toUpperCase()}</text></svg>`}
                          alt=""
                        />
                        <span>{mutualGroup.name}</span>
                      </div>
                    ))}
                  </div>
                )
              )}
            </div>
          ) : null}
        </div>
      </div>

      {confirmRemove ? createPortal(
        <div
          className="modal-backdrop important"
          style={{ zIndex: (zIndex ?? 1000) + 5 }}
          onClick={() => setConfirmRemove(false)}
        >
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

      {avatarMenu ? createPortal(
        <div
          className="context-menu messenger-user-menu"
          style={{ left: avatarMenu.x, top: avatarMenu.y }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <button type="button" onClick={() => { if (!isSelf) setExpanded(true); setAvatarMenu(null); }}>
            {t(language, 'viewProfile')}
          </button>
          {onOpenDesktop ? (
            <button type="button" onClick={() => { onOpenDesktop(user); setAvatarMenu(null); }}>
              {t(language, 'viewDesktop')}
            </button>
          ) : null}
        </div>,
        document.body
      ) : null}
      {mutualFriendMenu ? createPortal(
        <div
          className="context-menu messenger-user-menu"
          style={{ left: mutualFriendMenu.x, top: mutualFriendMenu.y }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <button type="button" onClick={() => {
            const friend = mutualFriendMenu.friend;
            setMutualFriendMenu(null);
            onOpenProfile?.(friend);
          }}>
            {t(language, 'viewProfile')}
          </button>
          {onOpenDesktop ? (
            <button type="button" onClick={() => {
              onOpenDesktop(mutualFriendMenu.friend);
              setMutualFriendMenu(null);
            }}>
              {t(language, 'viewDesktop')}
            </button>
          ) : null}
        </div>,
        document.body
      ) : null}
    </div>,
    document.body
  );
}
