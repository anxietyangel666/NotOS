// Fullscreen channel settings modal (overview, permissions, invites, delete
// tabs). Extracted verbatim from GroupChatView.tsx — all state and handlers
// still live in the parent and arrive via props.
import { type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { ChannelExtraSettings, Group, GroupChannel, GroupFolder, GroupInvite, GroupRole, Language } from '../../api/types';
import { t } from '../../i18n';
import { buildGroupInviteLink } from '../../utils/group-invite-link';
import { SaveBar } from '../SaveBar';
import { UserName } from '../UserName';
import { CHANNEL_PERMISSION_GROUPS, EVERYONE_ROLE_ID } from './constants';
import { channelPermissionLabel, sanitizeChannelName, type ChannelPermissionValue, type ChannelSettingsTab } from './permissions';

type ChannelSettingsModalProps = {
  language: Language;
  group: Group;
  channelId: string;
  channels: GroupChannel[];
  folders: GroupFolder[];
  roles: GroupRole[];
  everyonePermissions: string[];
  groupInvites: GroupInvite[];
  copied: boolean;
  settingsError: string;
  channelSettingsTab: ChannelSettingsTab;
  switchChannelSettingsTab: (tab: ChannelSettingsTab) => void;
  canManageRoles: boolean;
  canManageInvites: boolean;
  editNameDraft: string;
  setEditNameDraft: (value: string) => void;
  editTopicDraft: string;
  setEditTopicDraft: (value: string) => void;
  editTopicTextareaRef: MutableRefObject<HTMLTextAreaElement | null>;
  editSlowmodeDraft: string;
  setEditSlowmodeDraft: (value: string) => void;
  editNsfwDraft: boolean;
  setEditNsfwDraft: (value: boolean) => void;
  editBitrateDraft: string;
  setEditBitrateDraft: (value: string) => void;
  editLimitDraft: string;
  setEditLimitDraft: (value: string) => void;
  extrasDraft: ChannelExtraSettings;
  setExtrasDraft: Dispatch<SetStateAction<ChannelExtraSettings>>;
  extrasFolderId: string;
  setExtrasFolderId: (value: string) => void;
  signPostsDraft: boolean;
  setSignPostsDraft: (value: boolean) => void;
  canManageChannels: boolean;
  onCloneChannel: () => Promise<void>;
  onResetPermissions: () => Promise<void>;
  onCopyChannelId: () => void;
  editBarShake: number;
  selectedChannelPermissionRoleId: string | null;
  setSelectedChannelPermissionRoleId: (roleId: string | null) => void;
  channelPermissionDraft: Record<string, Record<string, ChannelPermissionValue>>;
  setChannelPermissionDraft: Dispatch<SetStateAction<Record<string, Record<string, ChannelPermissionValue>>>>;
  isFeedManagedChannel: (channel: GroupChannel | undefined | null) => boolean;
  isEditTargetDirty: () => boolean;
  isChannelPermissionsDirty: () => boolean;
  requestCloseEditTarget: () => void;
  resetEditTarget: () => void;
  saveEditTarget: () => Promise<void>;
  saveChannelPermissions: () => Promise<void>;
  applyTopicFormat: (marker: string) => void;
  handleCreateChannelInvite: (channelId: string) => Promise<void>;
  handleCopyInviteCode: (code: string, channelId?: string | null) => Promise<void>;
  handleDeleteInvite: (inviteId: string) => Promise<void>;
  handleDeleteChannel: (channelId: string) => Promise<void>;
  closeEditTarget: () => void;
  formatShortDate: (value: string) => string;
};

export function ChannelSettingsModal({
  language,
  group,
  channelId,
  channels,
  folders,
  roles,
  everyonePermissions,
  groupInvites,
  copied,
  settingsError,
  channelSettingsTab,
  switchChannelSettingsTab,
  canManageRoles,
  canManageInvites,
  editNameDraft,
  setEditNameDraft,
  editTopicDraft,
  setEditTopicDraft,
  editTopicTextareaRef,
  editSlowmodeDraft,
  setEditSlowmodeDraft,
  editNsfwDraft,
  setEditNsfwDraft,
  editBitrateDraft,
  setEditBitrateDraft,
  editLimitDraft,
  setEditLimitDraft,
  extrasDraft,
  setExtrasDraft,
  extrasFolderId,
  setExtrasFolderId,
  signPostsDraft,
  setSignPostsDraft,
  canManageChannels,
  onCloneChannel,
  onResetPermissions,
  onCopyChannelId,
  editBarShake,
  selectedChannelPermissionRoleId,
  setSelectedChannelPermissionRoleId,
  channelPermissionDraft,
  setChannelPermissionDraft,
  isFeedManagedChannel,
  isEditTargetDirty,
  isChannelPermissionsDirty,
  requestCloseEditTarget,
  resetEditTarget,
  saveEditTarget,
  saveChannelPermissions,
  applyTopicFormat,
  handleCreateChannelInvite,
  handleCopyInviteCode,
  handleDeleteInvite,
  handleDeleteChannel,
  closeEditTarget,
  formatShortDate
}: ChannelSettingsModalProps) {
  const channel = channels.find((c) => c.id === channelId);
  if (!channel) return null;
  const isVoice = channel.type === 'voice';
  const channelIcon = '#';
  const topicLimit = 1024;
  const roleChoices = [
    { id: EVERYONE_ROLE_ID, groupId: group.id, name: '@everyone', color: '#8a8a8a', position: -1, isOwner: false, permissions: everyonePermissions, hoist: false },
    ...roles.filter((role) => !role.isOwner)
  ];
  const selectedPermissionRole = roleChoices.find((role) => role.id === selectedChannelPermissionRoleId) ?? roleChoices[0] ?? null;
  const channelInviteLink = (code: string) => buildGroupInviteLink(code, channel.id);
  return (
    <div className="messenger-inline-modal settings-fullscreen" onClick={requestCloseEditTarget}>
      <div className="group-settings-modal channel-settings-modal" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="group-settings-close" aria-label={t(language, 'close')} onClick={requestCloseEditTarget}>✕</button>
        <div className="group-settings-sidebar">
          <button type="button" className="group-settings-back" onClick={requestCloseEditTarget}>
            <span aria-hidden="true">←</span>
            {t(language, 'back')}
          </button>
          <div className="group-settings-sidebar-header channel-settings-sidebar-header">
            <span className="channel-settings-sidebar-icon">{channelIcon}</span>
            <strong>{channel.name}</strong>
          </div>
          <div className="group-settings-tabs-list">
            <button type="button" className={'group-settings-tab' + (channelSettingsTab === 'overview' ? ' active' : '')} onClick={() => switchChannelSettingsTab('overview')}>
              {t(language, 'overview')}
            </button>
            <button type="button" className={'group-settings-tab' + (channelSettingsTab === 'permissions' ? ' active' : '')} onClick={() => switchChannelSettingsTab('permissions')}>
              {language === 'ru' ? 'Права' : 'Permissions'}
            </button>
            <button type="button" className={'group-settings-tab' + (channelSettingsTab === 'invites' ? ' active' : '')} onClick={() => switchChannelSettingsTab('invites')}>
              {language === 'ru' ? 'Инвайты' : 'Invites'}
            </button>
          </div>
          {!isFeedManagedChannel(channel) ? (
            <button type="button" className={'group-settings-delete-tab' + (channelSettingsTab === 'delete' ? ' active' : '')} onClick={() => switchChannelSettingsTab('delete')}>
              {t(language, 'deleteChannel')}
            </button>
          ) : null}
        </div>
        <div className="group-settings-content channel-settings-content">
          {settingsError ? <div className="inline-error">{settingsError}</div> : null}
          {channelSettingsTab === 'overview' ? (
            <div className="group-settings-section channel-settings-overview">
              <h3>{t(language, 'overview')}</h3>
              <label>{t(language, 'channelName')}</label>
              <input
                type="text"
                className="messenger-input"
                value={editNameDraft}
                onChange={(event) => setEditNameDraft(sanitizeChannelName(event.target.value))}
                onKeyDown={(event) => { if (event.key === 'Enter') void saveEditTarget(); }}
                autoFocus
              />
              <label>{t(language, 'channelFolder')}</label>
              <select className="messenger-input" value={extrasFolderId} onChange={(event) => setExtrasFolderId(event.target.value)}>
                <option value="">{t(language, 'channelNoFolder')}</option>
                {folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>{folder.name}</option>
                ))}
              </select>
              <label>{language === 'ru' ? 'Тема канала' : 'Channel topic'}</label>
              <div className="channel-topic-toolbar" aria-label={language === 'ru' ? 'Форматирование' : 'Formatting'}>
                {[
                  ['**', 'B'],
                  ['*', 'I'],
                  ['__', 'U'],
                  ['~~', 'S'],
                  ['`', '</>']
                ].map(([marker, label]) => (
                  <button
                    key={marker}
                    type="button"
                    onClick={() => applyTopicFormat(marker)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <textarea
                ref={editTopicTextareaRef}
                className="messenger-input"
                value={editTopicDraft}
                maxLength={topicLimit}
                placeholder={language === 'ru' ? 'Опишите, для чего этот канал' : 'Describe what this channel is for'}
                onChange={(event) => setEditTopicDraft(event.target.value.slice(0, topicLimit))}
                rows={5}
              />
              <small className="muted-line channel-settings-counter">{editTopicDraft.length}/{topicLimit}</small>
              {!isVoice ? (
                <>
                  <label>{t(language, 'slowmode')}</label>
                  <select className="messenger-input" value={editSlowmodeDraft} onChange={(event) => setEditSlowmodeDraft(event.target.value)}>
                    <option value="0">{t(language, 'timerOff')}</option>
                    <option value="5">5s</option>
                    <option value="10">10s</option>
                    <option value="15">15s</option>
                    <option value="30">30s</option>
                    <option value="60">1m</option>
                    <option value="120">2m</option>
                    <option value="300">5m</option>
                    <option value="600">10m</option>
                    <option value="900">15m</option>
                    <option value="1800">30m</option>
                    <option value="3600">1h</option>
                    <option value="7200">2h</option>
                    <option value="21600">6h</option>
                  </select>
                  <label>{t(language, 'newMemberSlowmode')}</label>
                  <select className="messenger-input" value={String(extrasDraft.newMemberSlowmodeSeconds)} onChange={(event) => setExtrasDraft((current) => ({ ...current, newMemberSlowmodeSeconds: Number(event.target.value) }))}>
                    <option value="0">{t(language, 'timerOff')}</option>
                    <option value="300">5m</option>
                    <option value="600">10m</option>
                    <option value="3600">1h</option>
                    <option value="86400">24h</option>
                    <option value="259200">3d</option>
                    <option value="604800">7d</option>
                  </select>
                  <label>{t(language, 'defaultThreadSlowmode')}</label>
                  <select className="messenger-input" value={String(extrasDraft.defaultThreadSlowmodeSeconds)} onChange={(event) => setExtrasDraft((current) => ({ ...current, defaultThreadSlowmodeSeconds: Number(event.target.value) }))}>
                    <option value="0">{t(language, 'timerOff')}</option>
                    <option value="5">5s</option>
                    <option value="10">10s</option>
                    <option value="30">30s</option>
                    <option value="60">1m</option>
                    <option value="300">5m</option>
                  </select>
                  <label>{t(language, 'defaultAutoArchive')}</label>
                  <select className="messenger-input" value={String(extrasDraft.defaultAutoArchiveMinutes)} onChange={(event) => setExtrasDraft((current) => ({ ...current, defaultAutoArchiveMinutes: Number(event.target.value) }))}>
                    <option value="60">1h</option>
                    <option value="1440">24h</option>
                    <option value="4320">3d</option>
                    <option value="10080">7d</option>
                  </select>
                  <label>{t(language, 'channelNotifications')}</label>
                  <select className="messenger-input" value={extrasDraft.defaultNotifications} onChange={(event) => setExtrasDraft((current) => ({ ...current, defaultNotifications: event.target.value as ChannelExtraSettings['defaultNotifications'] }))}>
                    <option value="all">{t(language, 'notifyAllMessages')}</option>
                    <option value="mentions">{t(language, 'notifyMentions')}</option>
                    <option value="nothing">{t(language, 'notifyNothing')}</option>
                  </select>
                  <label className="settings-toggle-row">
                    <input type="checkbox" checked={editNsfwDraft} onChange={(event) => setEditNsfwDraft(event.target.checked)} />
                    <span>{t(language, 'nsfwChannel')}</span>
                  </label>
                  <label className="settings-toggle-row">
                    <input type="checkbox" checked={extrasDraft.privateChannel} onChange={(event) => setExtrasDraft((current) => ({ ...current, privateChannel: event.target.checked }))} />
                    <span>{t(language, 'privateChannel')}</span>
                  </label>
                  <label className="settings-toggle-row">
                    <input type="checkbox" checked={extrasDraft.locked} onChange={(event) => setExtrasDraft((current) => ({ ...current, locked: event.target.checked }))} />
                    <span>{t(language, 'lockedChannel')}</span>
                  </label>
                  <label className="settings-toggle-row">
                    <input type="checkbox" checked={extrasDraft.announcement} onChange={(event) => setExtrasDraft((current) => ({ ...current, announcement: event.target.checked }))} />
                    <span>{t(language, 'announcementChannel')}</span>
                  </label>
                  <label className="settings-toggle-row">
                    <input type="checkbox" checked={extrasDraft.disableReactions} onChange={(event) => setExtrasDraft((current) => ({ ...current, disableReactions: event.target.checked }))} />
                    <span>{t(language, 'disableReactions')}</span>
                  </label>
                  {channel.type === 'feed' ? (
                    <label className="settings-toggle-row">
                      <input type="checkbox" checked={signPostsDraft} onChange={(event) => setSignPostsDraft(event.target.checked)} />
                      <span>{t(language, 'signPosts')}</span>
                    </label>
                  ) : null}
                </>
              ) : (
                <>
                  <label>{t(language, 'bitrate')}</label>
                  <input type="range" min={8000} max={384000} step={1000} value={editBitrateDraft} onChange={(event) => setEditBitrateDraft(event.target.value)} />
                  <small className="muted-line">{Math.round((Number(editBitrateDraft) || 64000) / 1000)} kbps</small>
                  <label>{t(language, 'memberLimit')}</label>
                  <input type="number" min={1} max={99} className="messenger-input" value={editLimitDraft} placeholder={t(language, 'noLimit')} onChange={(event) => setEditLimitDraft(event.target.value)} />
                  <label>{t(language, 'voiceMode')}</label>
                  <select className="messenger-input" value={extrasDraft.voiceMode} onChange={(event) => setExtrasDraft((current) => ({ ...current, voiceMode: event.target.value as ChannelExtraSettings['voiceMode'] }))}>
                    <option value="voice_activity">{t(language, 'voiceActivity')}</option>
                    <option value="ptt">{t(language, 'pushToTalk')}</option>
                  </select>
                  <label>{t(language, 'videoQuality')}</label>
                  <select className="messenger-input" value={extrasDraft.videoQuality} onChange={(event) => setExtrasDraft((current) => ({ ...current, videoQuality: event.target.value as ChannelExtraSettings['videoQuality'] }))}>
                    <option value="auto">{t(language, 'videoQualityAuto')}</option>
                    <option value="720">720p</option>
                    <option value="1080">1080p</option>
                  </select>
                  <label>{t(language, 'rtcRegion')}</label>
                  <select className="messenger-input" value={extrasDraft.rtcRegion} onChange={(event) => setExtrasDraft((current) => ({ ...current, rtcRegion: event.target.value }))}>
                    <option value="automatic">{t(language, 'rtcAutomatic')}</option>
                    <option value="eu-west">EU West</option>
                    <option value="eu-east">EU East</option>
                    <option value="us-east">US East</option>
                    <option value="us-west">US West</option>
                    <option value="asia">Asia</option>
                  </select>
                  <label className="settings-toggle-row">
                    <input type="checkbox" checked={extrasDraft.privateChannel} onChange={(event) => setExtrasDraft((current) => ({ ...current, privateChannel: event.target.checked }))} />
                    <span>{t(language, 'privateChannel')}</span>
                  </label>
                  <label className="settings-toggle-row">
                    <input type="checkbox" checked={extrasDraft.videoEnabled} onChange={(event) => setExtrasDraft((current) => ({ ...current, videoEnabled: event.target.checked }))} />
                    <span>{t(language, 'videoEnabled')}</span>
                  </label>
                  <label className="settings-toggle-row">
                    <input type="checkbox" checked={extrasDraft.streamEnabled} onChange={(event) => setExtrasDraft((current) => ({ ...current, streamEnabled: event.target.checked }))} />
                    <span>{t(language, 'streamEnabled')}</span>
                  </label>
                  <label className="settings-toggle-row">
                    <input type="checkbox" checked={extrasDraft.hideInactive} onChange={(event) => setExtrasDraft((current) => ({ ...current, hideInactive: event.target.checked }))} />
                    <span>{t(language, 'hideInactiveVoice')}</span>
                  </label>
                </>
              )}
              <div className="channel-settings-actions">
                <button type="button" className="secondary-action" onClick={() => void onCopyChannelId()}>{t(language, 'copyChannelId')}</button>
                {canManageChannels && !isFeedManagedChannel(channel) ? (
                  <button type="button" className="secondary-action" onClick={() => void onCloneChannel()}>{t(language, 'cloneChannel')}</button>
                ) : null}
                {canManageRoles ? (
                  <button type="button" className="secondary-action" onClick={() => void onResetPermissions()}>{t(language, 'resetChannelPermissions')}</button>
                ) : null}
              </div>
              <SaveBar language={language} dirty={isEditTargetDirty()} shakeKey={editBarShake} onReset={resetEditTarget} onSave={() => void saveEditTarget()} />
            </div>
          ) : null}
          {channelSettingsTab === 'permissions' ? (
            <div className="group-settings-section channel-settings-permissions channel-permissions-layout">
              <aside className="channel-permissions-role-list">
                <h3>{language === 'ru' ? 'Роли' : 'Roles'}</h3>
                {roleChoices.map((role) => (
                  <button
                    key={role.id}
                    type="button"
                    className={'channel-permissions-role' + (selectedPermissionRole?.id === role.id ? ' active' : '')}
                    onClick={() => setSelectedChannelPermissionRoleId(role.id)}
                  >
                    <span className="group-settings-role-dot" style={{ backgroundColor: role.color }} />
                    <span>{role.name}</span>
                  </button>
                ))}
              </aside>
              <div className="channel-permissions-editor">
                <h3>{selectedPermissionRole ? selectedPermissionRole.name : (language === 'ru' ? 'Права канала' : 'Channel permissions')}</h3>
                {selectedPermissionRole ? CHANNEL_PERMISSION_GROUPS
                  .filter((group) => {
                    if ('textOnly' in group && group.textOnly) return channel.type === 'text' || channel.type === 'feed';
                    if ('voiceOnly' in group && group.voiceOnly) return channel.type === 'voice';
                    return true;
                  })
                  .map((group) => (
                    <div key={group.title} className="channel-permission-group">
                      <strong>{group.title}</strong>
                      {group.permissions.map((permission) => {
                        const value = channelPermissionDraft[selectedPermissionRole.id]?.[permission] ?? 'inherit';
                        return (
                          <div key={permission} className="channel-permission-row">
                            <span>{channelPermissionLabel(permission, language)}</span>
                            <div className="channel-permission-state">
                              {(['inherit', 'allow', 'deny'] as const).map((state) => (
                                <button
                                  key={state}
                                  type="button"
                                  className={value === state ? `active ${state}` : state}
                                  disabled={!canManageRoles}
                                  onClick={() => {
                                    setChannelPermissionDraft((current) => {
                                      const roleDraft = { ...(current[selectedPermissionRole.id] ?? {}) };
                                      if (state === 'inherit') delete roleDraft[permission];
                                      else roleDraft[permission] = state;
                                      const next = { ...current };
                                      if (Object.keys(roleDraft).length === 0) delete next[selectedPermissionRole.id];
                                      else next[selectedPermissionRole.id] = roleDraft;
                                      return next;
                                    });
                                  }}
                                >
                                  {state === 'inherit' ? '—' : state === 'allow' ? '✓' : '×'}
                                </button>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )) : (
                  <p className="settings-hint">{language === 'ru' ? 'Создайте роль, чтобы настроить права канала.' : 'Create a role to configure channel permissions.'}</p>
                )}
              </div>
              <SaveBar language={language} dirty={isChannelPermissionsDirty()} shakeKey={editBarShake} onReset={resetEditTarget} onSave={() => void saveChannelPermissions()} />
            </div>
          ) : null}
          {channelSettingsTab === 'invites' ? (
            <div className="group-settings-section group-invites-section channel-settings-invites">
              <div className="group-invites-topbar">
                <h3>{language === 'ru' ? 'Инвайты в канал' : 'Channel invites'}</h3>
                {canManageInvites ? (
                  <button type="button" className="primary-action group-invite-create-btn" onClick={() => void handleCreateChannelInvite(channel.id)}>
                    {language === 'ru' ? 'Создать ссылку' : 'Create link'}
                  </button>
                ) : null}
              </div>
              <p className="settings-hint">
                {language === 'ru'
                  ? 'Ссылка вступает в группу и сразу открывает этот канал.'
                  : 'The link joins the group and opens this channel immediately.'}
              </p>
              <div className="group-invites-header">
                <span>{language === 'ru' ? 'Создана' : 'Created'}</span>
                <span>{language === 'ru' ? 'Автор' : 'Created by'}</span>
                <span>{language === 'ru' ? 'Входы' : 'Uses'}</span>
                <span>{language === 'ru' ? 'Ссылка' : 'Link'}</span>
                <span />
              </div>
              <div className="group-invites-list">
                {groupInvites.filter((invite) => invite?.id && invite.code).length > 0 ? groupInvites.filter((invite) => invite?.id && invite.code).map((invite) => (
                  <div key={invite.id} className="group-invite-row">
                    <span className="group-invite-date">{formatShortDate(invite.createdAt)}</span>
                    <span className="group-invite-creator">{invite.creator ? <UserName user={invite.creator} /> : 'Unknown'}</span>
                    <span className="group-invite-uses">{invite.usesCount}</span>
                    <code className="group-invite-link">{channelInviteLink(invite.code)}</code>
                    <span className="group-invite-actions">
                      <button type="button" onClick={() => void handleCopyInviteCode(invite.code, channel.id)}>{copied ? 'OK' : 'Copy'}</button>
                      <button type="button" className="danger" onClick={() => void handleDeleteInvite(invite.id)}>{language === 'ru' ? 'Удалить' : 'Delete'}</button>
                    </span>
                  </div>
                )) : (
                  <div className="group-invite-empty">{language === 'ru' ? 'Инвайты пока не созданы' : 'No invite links yet'}</div>
                )}
              </div>
            </div>
          ) : null}
          {channelSettingsTab === 'delete' ? (
            <div className="group-settings-section channel-settings-delete-section">
              <h3>{t(language, 'deleteChannel')}</h3>
              <p className="confirm-text">{t(language, 'deleteChannelConfirm', { name: channel.name })}</p>
              <button
                type="button"
                className="danger-action"
                disabled={channel.name === 'general' || isFeedManagedChannel(channel)}
                onClick={() => {
                  void handleDeleteChannel(channel.id);
                  closeEditTarget();
                }}
              >
                {t(language, 'delete')}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
