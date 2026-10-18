import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api/client';
import { cacheUser, getCachedUser } from '../api/user-cache';
import type { Group, GroupRole, Language, PublicUser, UserConnection } from '../api/types';
import { LOCALES, t } from '../i18n';
import { buildProfileLink } from '../utils/profile-link';
import { buildGroupInviteLink } from '../utils/group-invite-link';
import { InviteEmbed } from './InviteEmbed';
import { nameStyleClass, nameStyleToCss } from '../utils/name-style';
import { Twemoji, MessagePreviewText } from './Twemoji';
import { UserBadges } from './UserBadges';
import { EmojiPicker } from './EmojiPicker';
import { customEmojiToShortcodes, expandCustomEmojiShortcodes } from '../utils/custom-emoji';
import { EmojiToggleIcon } from './ChatComposeIcons';
import { saveUserStatus, useUserStatus, type PresenceStatus } from '../utils/user-status';
import { UserStatusPanel } from './UserStatusPanel';
import { ProfilePreviewCard } from './ProfilePreviewCard';
import { currentActivityProgressMs, useUserActivities } from './UserActivityStatus';
import { assetUrl } from '../utils/assets';
import { LevelRing } from './LevelRing';
import { ProfileVoiceBio } from './ProfileVoiceBio';

const CONNECTION_ICONS = {
  spotify: assetUrl('Icons/spotify.png'),
  riot: assetUrl('Icons/riot.png')
};

export type ProfileModalProps = {
  user: PublicUser;
  currentUser: PublicUser;
  group?: Group;
  /** Preloaded group roles (the full role list of the group). */
  initialGroupRoles?: GroupRole[];
  /** Preloaded roles held by the viewed member, shown instantly on open. */
  initialUserRoles?: GroupRole[];
  onlineUserIds?: string[];
  presenceStatuses?: Record<string, PresenceStatus>;
  language: Language;
  token: string;
  zIndex?: number;
  /** When opened from the desktop, render the card semi-transparent. */
  translucent?: boolean;
  /**
   * Plain viewport rect of the avatar/element the profile was opened from. When
   * provided, the card pops out anchored next to it (Discord-style) instead of
   * the centered, blurred modal. Captured at click time so it survives the
   * portal without a live ref.
   */
  anchorRect?: { left: number; top: number; right: number; bottom: number } | null;
  onClose: () => void;
  onUserChange?: (user: PublicUser) => void;
  onOpenChat?: (userId: string) => void;
  onOpenDesktop?: (user: PublicUser) => void;
  onOpenProfile?: (user: PublicUser) => void;
  onOpenGroup?: (group: Group) => void;
  onEditProfile?: () => void;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

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

function formatActivityTime(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function ProfileModal({
  user,
  currentUser,
  group,
  initialGroupRoles,
  initialUserRoles,
  onlineUserIds,
  presenceStatuses,
  language,
  token,
  zIndex,
  translucent = false,
  anchorRect,
  onClose,
  onUserChange,
  onOpenChat,
  onOpenDesktop,
  onOpenProfile,
  onOpenGroup,
  onEditProfile
}: ProfileModalProps) {
  const isSelf = user.id === currentUser.id;
  const selfStatus = useUserStatus();
  const remoteStatus = presenceStatuses?.[user.id] ?? ((onlineUserIds ?? []).includes(user.id) ? 'online' : null);
  const profilePresenceClass = isSelf
    ? `profile-presence presence-dot status-${selfStatus.status}`
    : remoteStatus
      ? `profile-presence presence-dot status-${remoteStatus}`
      : 'profile-presence presence-dot';
  // Authors embedded in message lists arrive "lite" (no wallpaper) to keep
  // those payloads small. We fetch the full user on open and store the heavy
  // wallpaper here so the card background fills in once available.
  const [fullWallpaper, setFullWallpaper] = useState(user.wallpaper);
  // Global account XP -> level. Lite payloads carry xp too, but a stale
  // cached prop may not, so revalidate together with the wallpaper fetch.
  const [profileXp, setProfileXp] = useState(user.xp ?? 0);
  const [statusDraft, setStatusDraft] = useState(() => customEmojiToShortcodes(user.status ?? ''));
  const [savingStatus, setSavingStatus] = useState(false);
  const [editingStatus, setEditingStatus] = useState(false);
  const [friendSince, setFriendSince] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [profileLinkCopied, setProfileLinkCopied] = useState(false);
  const [mutualTab, setMutualTab] = useState<'friends' | 'groups'>('friends');
  const [mutualFriends, setMutualFriends] = useState<PublicUser[] | null>(null);
  const [mutualGroups, setMutualGroups] = useState<Group[] | null>(null);
  const [profileConnections, setProfileConnections] = useState<UserConnection[]>([]);
  const [connectionsExpanded, setConnectionsExpanded] = useState(false);
  const { activities, loadedAt: activitiesLoadedAt } = useUserActivities(token, user.id, 20_000);
  const [activityNow, setActivityNow] = useState(Date.now());
  const [avatarMenu, setAvatarMenu] = useState<{ x: number; y: number } | null>(null);
  const [mutualFriendMenu, setMutualFriendMenu] = useState<{ x: number; y: number; friend: PublicUser } | null>(null);
  // Seed from preloaded data (passed by the group view) so roles show instantly
  // instead of waiting ~2s for the network fetch; revalidated in the effect.
  const [groupRoles, setGroupRoles] = useState<GroupRole[]>(initialGroupRoles ?? []);
  const [userRoles, setUserRoles] = useState<GroupRole[]>(initialUserRoles ?? []);
  const [friendState, setFriendState] = useState<'none' | 'pending' | 'friends'>('none');
  const [friendBusy, setFriendBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [moreMenuPos, setMoreMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [inviteMenuOpen, setInviteMenuOpen] = useState(false);
  const [myGroups, setMyGroups] = useState<Group[] | null>(null);
  const [inviteSentGroupId, setInviteSentGroupId] = useState<string | null>(null);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);
  const moreBtnRef = useRef<HTMLButtonElement | null>(null);
  const [statusEmojiOpen, setStatusEmojiOpen] = useState(false);
  const statusEmojiAnchorRef = useRef<HTMLButtonElement | null>(null);
  const statusTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [currentGroupRoleIds, setCurrentGroupRoleIds] = useState<string[]>([]);
  const [removingGroupRoleId, setRemovingGroupRoleId] = useState<string | null>(null);
  const [presencePanel, setPresencePanel] = useState<{ left: number; bottom: number } | null>(null);
  const presenceAnchorRef = useRef<HTMLSpanElement | null>(null);
  // Bumped to shake the save bar when the user tries to close the profile
  // card while the status editor has unsaved changes.

  // Anchored (Discord-style) popout positioning. Only used when `anchorRect`
  // is supplied by the opener; otherwise the card stays centered.
  const anchored = !!anchorRect;
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [popoverPos, setPopoverPos] = useState<CSSProperties>(
    anchored ? { position: 'fixed', left: 0, top: 0, visibility: 'hidden' } : {}
  );

  useLayoutEffect(() => {
    if (!anchorRect) return;
    const card = cardRef.current;
    if (!card) return;

    function place() {
      const node = cardRef.current;
      if (!node || !anchorRect) return;
      // On small screens there is no room beside an avatar — fall back to a
      // centered card (the CSS media query also relaxes the fixed sizing).
      if (window.innerWidth <= 800) {
        setPopoverPos({});
        return;
      }
      const gap = 12;
      const margin = 12;
      const availableRight = window.innerWidth - anchorRect.right - gap - margin;
      const availableLeft = anchorRect.left - gap - margin;
      const compactWidth = Math.min(440, window.innerWidth * 0.92);
      const side: 'right' | 'left' = availableRight >= compactWidth || availableRight >= availableLeft ? 'right' : 'left';
      const maxWidth = Math.max(280, side === 'right' ? availableRight : availableLeft);
      const maxHeight = Math.min(680, window.innerHeight * 0.86);
      const height = Math.min(node.offsetHeight, maxHeight);
      // Vertically align the card's top with the avatar, clamped to viewport.
      let top = anchorRect.top;
      top = clamp(top, margin, window.innerHeight - height - margin);
      const nextPos: CSSProperties = {
        position: 'fixed',
        top,
        maxWidth,
        transformOrigin: `${side === 'right' ? 'left' : 'right'} top`,
        visibility: 'visible'
      };
      if (side === 'right') {
        nextPos.left = Math.max(margin, anchorRect.right + gap);
        nextPos.right = 'auto';
      } else {
        nextPos.left = 'auto';
        nextPos.right = Math.max(margin, window.innerWidth - anchorRect.left + gap);
      }
      setPopoverPos(nextPos);
    }

    // Measure after layout so width/height reflect the rendered card.
    const raf = window.requestAnimationFrame(place);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorRect]);

  useLayoutEffect(() => {
    if (!editingStatus) return;
    const node = statusTextareaRef.current;
    if (!node) return;
    const maxHeight = 132;
    node.style.height = '46px';
    const nextHeight = Math.min(Math.max(46, node.scrollHeight), maxHeight);
    node.style.height = `${nextHeight}px`;
    node.style.overflowY = node.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [editingStatus, statusDraft]);

  const statusDirty = isSelf && editingStatus && statusDraft.trim() !== customEmojiToShortcodes(user.status ?? '').trim();
  const canManageProfileRoles = Boolean(
    group && (
      currentUser.id === group.ownerId ||
      groupRoles.some((role) => currentGroupRoleIds.includes(role.id) && (role.isOwner || role.permissions.includes('ManageRoles')))
    )
  );

  function requestCloseProfile() {
    if (statusDirty) return;
    onClose();
  }

  useEffect(() => {
    if (group) {
      if (initialGroupRoles) setGroupRoles(initialGroupRoles);
      if (initialUserRoles) setUserRoles(initialUserRoles);
      // Fetch roles and members in parallel so the profile fills in quickly
      // instead of waiting for two sequential round-trips.
      void Promise.all([
        api.getGroupRoles(token, group.id),
        api.getGroupMembers(token, group.id)
      ]).then(([rolePayload, memPayload]) => {
        setGroupRoles(rolePayload.roles);
        const currentMember = memPayload.members.find((m) => m.user.id === currentUser.id);
        setCurrentGroupRoleIds(
          currentMember?.roleIds && currentMember.roleIds.length > 0
            ? currentMember.roleIds
            : currentMember?.roleId ? [currentMember.roleId] : []
        );
        const member = memPayload.members.find((m) => m.user.id === user.id);
        if (!member) return;
        // Show every role the member holds (primary + customization roles),
        // not just the single primary one. Fall back to roleId for safety.
        const heldRoleIds = new Set(
          member.roleIds && member.roleIds.length > 0
            ? member.roleIds
            : member.roleId ? [member.roleId] : []
        );
        setUserRoles(
          rolePayload.roles
            .filter((r) => heldRoleIds.has(r.id))
            .sort((a, b) => a.position - b.position)
        );
      });
    } else {
      setGroupRoles([]);
      setUserRoles([]);
      setCurrentGroupRoleIds([]);
    }
  }, [token, group, user.id, currentUser.id, initialGroupRoles, initialUserRoles]);

  useEffect(() => {
    setStatusDraft(customEmojiToShortcodes(user.status ?? ''));
    setEditingStatus(false);
  }, [user.status, user.id]);

  useEffect(() => {
    if (isSelf) {
      setStatusDraft(customEmojiToShortcodes(currentUser.status ?? ''));
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

  // Authors embedded in lists (wall, chat) are sent "lite" without the heavy
  // base64 wallpaper to keep those payloads small. Show whatever the prop
  // carries first, then fetch the full user on open to fill in the real
  // wallpaper. For self we already hold the complete user.
  useEffect(() => {
    setFullWallpaper(user.wallpaper);
    setProfileXp(user.xp ?? 0);
    if (user.wallpaper) return; // already complete, nothing to upgrade
    // Paint a previously-fetched wallpaper immediately (even if the cache
    // entry expired) so reopening a profile never flashes empty, then
    // revalidate with a fresh fetch below.
    const known = getCachedUser(user.id);
    if (known?.wallpaper) setFullWallpaper(known.wallpaper);
    // Even for our own profile the prop can arrive "lite" (opened from a list),
    // so fetch the full user whenever the wallpaper is missing.
    let alive = true;
    api.getPublicUser(token, user.id)
      .then(({ user: full }) => {
        if (!alive) return;
        cacheUser(full);
        setFullWallpaper(full.wallpaper);
        setProfileXp(full.xp ?? 0);
      })
      .catch(() => { /* keep the lite data already shown */ });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, user.id, user.wallpaper]);

  useEffect(() => {
    if (!activities.some((activity) => activity.provider === 'spotify')) return;
    const timer = window.setInterval(() => setActivityNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [activities]);

  useEffect(() => {
    let alive = true;
    api.getUserConnections(token, user.id)
      .then((payload) => { if (alive) setProfileConnections(payload.connections); })
      .catch(() => { if (alive) setProfileConnections([]); });
    return () => { alive = false; };
  }, [token, user.id]);

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
    if (!isSelf) {
      setMutualFriends(null);
      setMutualGroups(null);
      api.getMutualFriends(token, user.id)
        .then((result) => setMutualFriends(result.friends))
        .catch(() => setMutualFriends([]));
      api.getMutualGroups(token, user.id)
        .then((result) => setMutualGroups(result.groups))
        .catch(() => setMutualGroups([]));
    }
  }, [token, user.id, isSelf]);

  useEffect(() => {
    if (!moreMenuOpen) return;
    function closeMore(event: globalThis.MouseEvent) {
      const target = event.target as Element | null;
      if (target?.closest?.('.profile-more-menu')) return;
      if (target?.closest?.('.profile-more-wrap')) return;
      setMoreMenuOpen(false);
      setInviteMenuOpen(false);
    }
    const rafId = window.requestAnimationFrame(() => {
      window.addEventListener('mousedown', closeMore);
    });
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('mousedown', closeMore);
    };
  }, [moreMenuOpen]);

  useEffect(() => {
    if (!inviteMenuOpen || myGroups !== null) return;
    api.getGroups(token)
      .then((result) => setMyGroups(result.groups))
      .catch(() => setMyGroups([]));
  }, [inviteMenuOpen, token, myGroups]);

  async function sendGroupInvite(group: Group) {
    try {
      await api.sendMessage(token, user.id, buildGroupInviteLink(group.inviteCode));
      setInviteSentGroupId(group.id);
      setTimeout(() => setInviteSentGroupId(null), 2000);
    } catch {
      // ignore
    }
  }

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
      const result = await api.updateMe(token, { status: expandCustomEmojiShortcodes(statusDraft.trim()) });
      onUserChange?.(result.user);
      // Close the editor and show the saved status once persisted.
      setStatusDraft(customEmojiToShortcodes(result.user.status ?? ''));
      setEditingStatus(false);
    } catch {
      // ignore
    } finally {
      setSavingStatus(false);
    }
  }

  function selectPresenceStatus(status: PresenceStatus) {
    saveUserStatus({ ...selfStatus, status });
    setPresencePanel(null);
  }

  async function removeProfileGroupRole(role: GroupRole) {
    if (!group || !canManageProfileRoles || role.isOwner || removingGroupRoleId) return;
    const previousRoles = userRoles;
    setRemovingGroupRoleId(role.id);
    setUserRoles((current) => current.filter((item) => item.id !== role.id));
    try {
      const payload = await api.updateGroupMemberRole(token, group.id, user.id, { removeRoleId: role.id });
      const member = payload.members.find((item) => item.user.id === user.id);
      const heldRoleIds = new Set(
        member?.roleIds && member.roleIds.length > 0
          ? member.roleIds
          : member?.roleId ? [member.roleId] : []
      );
      const currentMember = payload.members.find((item) => item.user.id === currentUser.id);
      setCurrentGroupRoleIds(
        currentMember?.roleIds && currentMember.roleIds.length > 0
          ? currentMember.roleIds
          : currentMember?.roleId ? [currentMember.roleId] : []
      );
      setUserRoles(groupRoles.filter((item) => heldRoleIds.has(item.id)).sort((a, b) => a.position - b.position));
    } catch {
      setUserRoles(previousRoles);
    } finally {
      setRemovingGroupRoleId(null);
    }
  }

  function copyProfileLink() {
    navigator.clipboard.writeText(buildProfileLink(user.id)).catch(() => {});
    setProfileLinkCopied(true);
    window.setTimeout(() => setProfileLinkCopied(false), 1400);
  }

  function toggleFullProfile() {
    setExpanded((open) => !open);
  }

  function toggleMutualPanel(tab: 'friends' | 'groups') {
    if (expanded && mutualTab === tab) {
      setExpanded(false);
      return;
    }
    setMutualTab(tab);
    setExpanded(true);
  }

  return createPortal(
    <div
      className={anchored ? 'profile-popover-backdrop' : 'modal-backdrop important'}
      style={zIndex !== undefined ? { zIndex } : undefined}
      onClick={(event) => {
        if (event.target === event.currentTarget) requestCloseProfile();
      }}
      onContextMenu={(event) => {
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        requestCloseProfile();
      }}
    >
      <div
        ref={cardRef}
        className={`profile-modal-card profile-view-card profile-themed${expanded ? ' expanded' : ''}${translucent ? ' translucent' : ''}${anchored ? ' profile-anchored' : ''}`}
        style={{
          ['--profile-primary' as string]: user.profilePrimaryColor || '#2AABEE',
          ['--profile-accent' as string]: user.profileAccentColor || '#5865F2',
          ...popoverPos
        }}
        onClick={(event) => event.stopPropagation()}
        onContextMenu={isSelf ? undefined : (event) => {
          const target = event.target as HTMLElement | null;
          if (target?.closest('button, input, textarea, a, .profile-status-bubble.editable')) return;
          event.preventDefault();
          event.stopPropagation();
          setAvatarMenu({
            x: Math.min(event.clientX, window.innerWidth - 220),
            y: Math.min(event.clientY, window.innerHeight - 120)
          });
        }}
      >
        <div
          className="profile-banner"
          style={{ backgroundImage: wallpaperToBackground(fullWallpaper, user.theme) }}
        >
          {!isSelf ? (
            <div className="profile-banner-actions">
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

              <div className="profile-more-wrap" ref={moreMenuRef}>
                <button
                  ref={moreBtnRef}
                  className="profile-friend-btn profile-banner-friend-btn profile-more-btn"
                  type="button"
                  aria-label="More options"
                  onClick={() => {
                    const rect = moreBtnRef.current?.getBoundingClientRect();
                    if (rect) setMoreMenuPos({ x: rect.left, y: rect.bottom + 8 });
                    setMoreMenuOpen((v) => !v);
                    setInviteMenuOpen(false);
                  }}
                >
                  ···
                </button>
              </div>
            </div>
          ) : null}
        </div>
        <div className="profile-body">
          <div className="profile-main">
            <div className="profile-avatar-status-row">
              <div className="profile-badges-anchor">
                <UserBadges user={user} language={language} large />
              </div>
              <div
                className="profile-avatar-wrap"
                style={{ cursor: isSelf ? undefined : 'default' }}
                onContextMenu={isSelf ? undefined : (event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setAvatarMenu({ x: event.clientX, y: event.clientY });
                }}
              >
                <img src={user.avatarData} alt="" draggable={false} />
                <LevelRing xp={profileXp} language={language} />
                <span
                  ref={presenceAnchorRef}
                  className={profilePresenceClass}
                  role={isSelf ? 'button' : undefined}
                  tabIndex={isSelf ? 0 : undefined}
                  onClick={isSelf ? (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    const rect = event.currentTarget.getBoundingClientRect();
                    setPresencePanel((current) => current ? null : { left: rect.left, bottom: rect.top });
                  } : undefined}
                  onKeyDown={isSelf ? (event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    event.stopPropagation();
                    const rect = event.currentTarget.getBoundingClientRect();
                    setPresencePanel((current) => current ? null : { left: rect.left, bottom: rect.top });
                  } : undefined}
                />
              </div>
              {!editingStatus ? (
                <div
                  className={isSelf ? 'profile-status-bubble editable' : 'profile-status-bubble'}
                  onDoubleClick={isSelf ? () => setEditingStatus(true) : undefined}
                >
                  {user.status ? <MessagePreviewText text={user.status} size={18} /> : t(language, 'noStatus')}
                </div>
              ) : null}
            </div>
            <ProfileVoiceBio
              userId={user.id}
              isSelf={isSelf}
              language={language}
              initialBioUrl={user.voiceBio}
              token={token}
            />
            <div className="profile-info">
              <div className="profile-name-row">
                <h3>
                  <button
                    type="button"
                    className={`profile-name-copy ${nameStyleClass(user.nameStyle)}`}
                    style={nameStyleToCss(user.nameStyle)}
                    title={profileLinkCopied ? t(language, 'profileLinkCopied') : t(language, 'copyProfileLink')}
                    onClick={copyProfileLink}
                  >
                    {user.nickname}
                  </button>
                </h3>
              </div>
              {profileLinkCopied ? <span className="profile-copy-hint">{t(language, 'profileLinkCopied')}</span> : null}
              {group && userRoles.length > 0 ? (
                <div className="profile-group-roles">
                  {userRoles.map((role) => {
                    const removable = canManageProfileRoles && !role.isOwner;
                    return (
                      <span key={role.id} className={removable ? 'profile-group-role removable' : 'profile-group-role'} style={{ color: role.color }}>
                        <span className="profile-group-role-name">{role.name}</span>
                        {removable ? (
                          <button
                            type="button"
                            className="profile-group-role-remove"
                            aria-label={language === 'ru' ? 'Снять роль' : language === 'uk' ? 'Зняти роль' : language === 'zh' ? '移除角色' : language === 'zh-TW' ? '移除身分組' : 'Remove role'}
                            disabled={removingGroupRoleId === role.id}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              void removeProfileGroupRole(role);
                            }}
                          >
                            x
                          </button>
                        ) : null}
                      </span>
                    );
                  })}
                </div>
              ) : null}

              <div className="profile-dates">
                <small>
                  <span>{t(language, 'memberSince')}</span>
                  <strong>{formatDate(user.createdAt)}</strong>
                </small>
                {!isSelf && friendSince ? (
                  <small>
                    <span>{t(language, 'friendsSince')}</span>
                    <strong>{formatDate(friendSince)}</strong>
                  </small>
                ) : null}
              </div>

              {activities.length > 0 ? (
                <div className="profile-activities">
                  {activities.map((activity) => (
                    <div className={`profile-activity ${activity.provider}`} key={`${activity.provider}:${activity.title}`}>
                      {activity.provider === 'spotify' ? (
                        (() => {
                          const progressMs = currentActivityProgressMs(activity, activitiesLoadedAt, activityNow);
                          const progressPercent = activity.durationMs > 0 ? Math.min(100, Math.max(0, (progressMs / activity.durationMs) * 100)) : 0;
                          return <>
                          {activity.imageUrl ? <img src={activity.imageUrl} alt="" /> : <img src={CONNECTION_ICONS.spotify} alt="" />}
                          <div className="profile-activity-copy">
                            <div className="profile-activity-heading">
                              <small>Listening to Spotify</small>
                              <strong>{activity.title}</strong>
                              <span>{activity.subtitle}</span>
                            </div>
                            {activity.durationMs > 0 ? (
                              <div className="profile-activity-progress">
                                <div className="profile-activity-progress-track"><div style={{ width: `${progressPercent}%` }} /></div>
                                <em>{formatActivityTime(progressMs)} / {formatActivityTime(activity.durationMs)}</em>
                              </div>
                            ) : null}
                          </div>
                          </>;
                        })()
                      ) : (
                        <>
                          <img src={CONNECTION_ICONS.riot} alt="" />
                          <div className="profile-activity-copy">
                            <small>Playing</small>
                            <strong>{activity.title}</strong>
                            <span>{activity.subtitle} - {activity.riotId} - {activity.region.toUpperCase()}</span>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              ) : null}

              {!isSelf ? (
                <div className="profile-mutual-summary" aria-label={language === 'ru' ? 'Общее' : 'Mutuals'}>
                  <button
                    type="button"
                    className="profile-mutual-summary-card"
                    onClick={() => toggleMutualPanel('friends')}
                  >
                    <strong>{mutualFriends === null ? '...' : mutualFriends.length}</strong>
                    <span>{t(language, 'mutualFriends')}</span>
                  </button>
                  <button
                    type="button"
                    className="profile-mutual-summary-card"
                    onClick={() => toggleMutualPanel('groups')}
                  >
                    <strong>{mutualGroups === null ? '...' : mutualGroups.length}</strong>
                    <span>{t(language, 'mutualGroups')}</span>
                  </button>
                </div>
              ) : null}

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
                <div className="profile-primary-actions">
                  <button
                    type="button"
                    className="primary-action"
                    onClick={() => {
                      onOpenChat?.(user.id);
                      onClose();
                    }}
                  >
                    {t(language, 'message')}
                  </button>
                  <button
                    type="button"
                    className="secondary-action"
                    onClick={toggleFullProfile}
                  >
                    {language === 'ru' ? 'Посмотреть полный профиль' : language === 'uk' ? 'Переглянути повний профіль' : language === 'zh' ? '查看完整资料' : language === 'zh-TW' ? '檢視完整個人檔案' : 'View full profile'}
                  </button>
                </div>
              ) : null}

              <div className={connectionsExpanded ? 'profile-connections-block expanded' : 'profile-connections-block'}>
                <button
                  className="profile-connections-toggle"
                  type="button"
                  aria-expanded={connectionsExpanded}
                  onClick={() => setConnectionsExpanded((value) => !value)}
                >
                  <span>{t(language, 'connectionsSettings')}</span>
                  <strong>{profileConnections.length}</strong>
                </button>
                <div className="profile-connections-list" aria-hidden={!connectionsExpanded}>
                  {profileConnections.map((connection) => (
                    <div className={`profile-connection-row ${connection.provider}`} key={connection.provider}>
                      <img src={CONNECTION_ICONS[connection.provider]} alt="" />
                      <span>
                        <small>{connection.provider === 'spotify' ? 'Spotify' : 'Riot Games'}</small>
                        <strong>{connection.displayName}</strong>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
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
                  onClick={() => toggleMutualPanel('friends')}
                >
                  {t(language, 'mutualFriends')}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mutualTab === 'groups'}
                  className={mutualTab === 'groups' ? 'profile-mutual-tab active' : 'profile-mutual-tab'}
                  onClick={() => toggleMutualPanel('groups')}
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

        {isSelf && presencePanel ? (
          <UserStatusPanel
            language={language}
            user={currentUser}
            status={selfStatus.status}
            voice={selfStatus.voice}
            anchor={presencePanel}
            triggerElement={presenceAnchorRef.current}
            statusOnly
            onSelectStatus={selectPresenceStatus}
            onToggleMute={() => undefined}
            onToggleDeafen={() => undefined}
            onOpenVoiceSettings={() => undefined}
            onClose={() => setPresencePanel(null)}
          />
        ) : null}
      </div>

      {isSelf && editingStatus ? createPortal(
        <div
          className="profile-status-modal-backdrop"
          style={{ zIndex: (zIndex ?? 1000) + 20 }}
          onClick={() => {
            setEditingStatus(false);
            setStatusEmojiOpen(false);
            setStatusDraft(customEmojiToShortcodes(user.status ?? ''));
          }}
        >
          <section className="profile-status-modal" onClick={(event) => event.stopPropagation()}>
            <button
              className="profile-status-modal-close"
              type="button"
              aria-label={t(language, 'cancel')}
              onClick={() => {
                setEditingStatus(false);
                setStatusEmojiOpen(false);
                setStatusDraft(customEmojiToShortcodes(user.status ?? ''));
              }}
            >
              x
            </button>
            <div className="profile-status-modal-preview">
              <ProfilePreviewCard
                user={user}
                language={language}
                bannerBackground={wallpaperToBackground(fullWallpaper, user.theme)}
                status={expandCustomEmojiShortcodes(statusDraft.trim())}
              />
            </div>
            <label className="field-label compact">{t(language, 'profileStatus')}</label>
            <div className="profile-status-modal-input">
              <textarea
                ref={statusTextareaRef}
                autoFocus
                className="text-field status-emoji-textarea"
                value={statusDraft}
                maxLength={200}
                rows={1}
                onChange={(event) => setStatusDraft(event.target.value)}
              />
              <span className="char-count">{statusDraft.length}/200</span>
              <button
                type="button"
                ref={statusEmojiAnchorRef}
                className="status-emoji-button"
                aria-label={t(language, 'emoji')}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  setStatusEmojiOpen((open) => !open);
                }}
              >
                <EmojiToggleIcon size={20} />
              </button>
              {statusEmojiOpen ? (
                <EmojiPicker
                  language={language}
                  anchorRef={statusEmojiAnchorRef}
                  placement="top-end"
                  zIndex={(zIndex ?? 1000) + 40}
                  onSelect={(emoji) => setStatusDraft((value) => customEmojiToShortcodes(`${value}${emoji}`))}
                  onClose={() => setStatusEmojiOpen(false)}
                />
              ) : null}
            </div>
            <div className="profile-status-modal-actions">
              <button className="primary-action" type="button" disabled={!statusDirty || savingStatus} onClick={() => void saveStatus()}>
                {savingStatus ? '…' : t(language, 'save')}
              </button>
            </div>
          </section>
        </div>,
        document.body
      ) : null}

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

      {confirmBlock ? createPortal(
        <div
          className="modal-backdrop important"
          style={{ zIndex: (zIndex ?? 1000) + 5 }}
          onClick={() => setConfirmBlock(false)}
        >
          <section className="confirm-dialog" onClick={(event) => event.stopPropagation()}>
            <p>{t(language, 'confirmBlockUser')}</p>
            <div className="confirm-actions">
              <button className="secondary-action" type="button" onClick={() => setConfirmBlock(false)}>
                {t(language, 'cancel')}
              </button>
              <button
                className="primary-action danger-text"
                type="button"
                onClick={() => {
                  void api.blockUser(token, user.id).catch(() => undefined);
                  setConfirmBlock(false);
                  onClose();
                }}
              >
                {t(language, 'blockUser')}
              </button>
            </div>
          </section>
        </div>,
        document.body
      ) : null}

      {moreMenuOpen && moreMenuPos ? createPortal(
        <div
          className="profile-more-menu"
          style={{ position: 'fixed', left: moreMenuPos.x, top: moreMenuPos.y, zIndex: (zIndex ?? 1000) + 10 }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(buildProfileLink(user.id)).catch(() => {});
              setMoreMenuOpen(false);
            }}
          >
            {t(language, 'copyProfileLink')}
          </button>
          {onOpenDesktop ? (
            <button
              type="button"
              onClick={() => {
                setMoreMenuOpen(false);
                onClose();
                onOpenDesktop(user);
              }}
            >
              {t(language, 'viewDesktop')}
            </button>
          ) : null}
          <div
            className="profile-more-menu-item-wrap"
            onMouseEnter={() => setInviteMenuOpen(true)}
            onMouseLeave={() => setInviteMenuOpen(false)}
          >
            <button type="button" className="profile-more-submenu-trigger">
              {t(language, 'inviteToServer')} ▶
            </button>
            {inviteMenuOpen ? (
              <div className="profile-more-submenu">
                {myGroups === null ? (
                  <div className="profile-more-submenu-loading">{t(language, 'loading')}</div>
                ) : myGroups.length === 0 ? (
                  <div className="profile-more-submenu-loading">{t(language, 'noGroups')}</div>
                ) : (
                  myGroups.map((group) => (
                    <button
                      key={group.id}
                      type="button"
                      className={inviteSentGroupId === group.id ? 'profile-more-submenu-sent' : ''}
                      onClick={() => void sendGroupInvite(group)}
                    >
                      <img
                        src={group.avatarData || `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="%23444" rx="20"/><text x="50" y="58" text-anchor="middle" fill="%23fff" font-size="28" font-family="sans-serif">${(group.name[0] || '?').toUpperCase()}</text></svg>`}
                        alt=""
                      />
                      <span>{group.name}</span>
                      {inviteSentGroupId === group.id ? <span className="profile-more-sent-check">✓</span> : null}
                    </button>
                  ))
                )}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="profile-more-menu-danger"
            onClick={() => { setConfirmBlock(true); setMoreMenuOpen(false); }}
          >
            {t(language, 'blockUser')}
          </button>
        </div>,
        document.body
      ) : null}

      {avatarMenu ? createPortal(
        <div
          className="context-menu messenger-user-menu"
          style={{
            position: 'fixed',
            left: avatarMenu.x,
            top: avatarMenu.y,
            zIndex: Math.max(100050, (zIndex ?? 1000) + 50)
          }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <button type="button" onClick={() => { if (!isSelf) setExpanded(true); setAvatarMenu(null); }}>
            {t(language, 'viewProfile')}
          </button>
          {onOpenDesktop ? (
            <button type="button" onClick={() => { onOpenDesktop(user); setAvatarMenu(null); onClose(); }}>
              {t(language, 'viewDesktop')}
            </button>
          ) : null}
        </div>,
        document.body
      ) : null}
      {mutualFriendMenu ? createPortal(
        <div
          className="context-menu messenger-user-menu"
          style={{
            position: 'fixed',
            left: mutualFriendMenu.x,
            top: mutualFriendMenu.y,
            zIndex: Math.max(100050, (zIndex ?? 1000) + 50)
          }}
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
