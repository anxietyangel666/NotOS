// Fullscreen group settings modal (overview, invites, roles, members,
// customization tabs). Extracted verbatim from GroupChatView.tsx — all state
// and handlers still live in the parent and arrive via props; this component
// is purely presentational.
import { type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { createPortal } from 'react-dom';
import type { CustomCategory, Group, GroupChannel, GroupInvite, GroupMember, GroupRole, Language, NamePlate, PublicUser } from '../../api/types';
import { nameplateToCss } from '../../api/types';
import { t } from '../../i18n';
import { assetUrl } from '../../utils/assets';
import { buildGroupInviteLink } from '../../utils/group-invite-link';
import { CustomizationConstructor } from '../CustomizationConstructor';
import { SaveBar } from '../SaveBar';
import { Tooltip } from '../Tooltip';
import { UserName } from '../UserName';
import { EVERYONE_ROLE_ID, MENTIONABLE_PERMISSION, MENTION_EVERYONE_PERMISSION } from './constants';
import { rolePermissionLabel } from './permissions';

export type GroupSettingsTab = 'overview' | 'invite' | 'roles' | 'members' | 'customization';

type GroupSettingsModalProps = {
  token: string;
  language: Language;
  currentUser: PublicUser;
  group: Group;
  channels: GroupChannel[];
  roles: GroupRole[];
  members: GroupMember[];
  customCategories: CustomCategory[];
  setCustomCategories: Dispatch<SetStateAction<CustomCategory[]>>;
  groupInvites: GroupInvite[];
  settingsTab: GroupSettingsTab;
  setSettingsTab: (tab: GroupSettingsTab) => void;
  isOwner: boolean;
  canManageRoles: boolean;
  canManageInvites: boolean;
  canKickMembers: boolean;
  otherMembersCount: number;
  copied: boolean;
  newAvatar: string | null;
  newName: string;
  setNewName: (value: string) => void;
  newDescription: string;
  setNewDescription: (value: string) => void;
  nameplateDraft: NonNullable<NamePlate>;
  setNameplateDraft: Dispatch<SetStateAction<NonNullable<NamePlate>>>;
  defaultRoleId: string | null;
  defaultRoleMenuOpen: boolean;
  setDefaultRoleMenuOpen: Dispatch<SetStateAction<boolean>>;
  roleEditorId: string | null;
  roleEditorTab: 'display' | 'permissions' | 'members';
  setRoleEditorTab: (tab: 'display' | 'permissions' | 'members') => void;
  roleSearch: string;
  setRoleSearch: (value: string) => void;
  roleSort: 'position' | 'name' | 'members';
  setRoleSort: (value: 'position' | 'name' | 'members') => void;
  roleMenuOpen: string | null;
  setRoleMenuOpen: Dispatch<SetStateAction<string | null>>;
  roleIdCopied: string | null;
  collapsedCategories: Set<string>;
  toggleCategory: (id: string) => void;
  everyonePermissions: string[];
  editingRoleMeta: { id: string; name: string; color: string } | null;
  setEditingRoleMeta: Dispatch<SetStateAction<{ id: string; name: string; color: string } | null>>;
  draftHoist: boolean;
  setDraftHoist: (value: boolean) => void;
  draftPermissions: string[];
  setDraftPermissions: Dispatch<SetStateAction<string[]>>;
  rolePermissionSearch: string;
  setRolePermissionSearch: (value: string) => void;
  roleMemberSearch: string;
  setRoleMemberSearch: (value: string) => void;
  memberSearch: string;
  setMemberSearch: (value: string) => void;
  memberSort: 'joined' | 'accountCreated' | 'alphabetical';
  setMemberSort: (value: 'joined' | 'accountCreated' | 'alphabetical') => void;
  memberRoleFilter: string;
  setMemberRoleFilter: (value: string) => void;
  settingsMembers: GroupMember[];
  selectedMemberIds: Set<string>;
  setSelectedMemberIds: Dispatch<SetStateAction<Set<string>>>;
  selectedVisibleMemberIds: string[];
  bulkRoleMenu: 'add' | 'remove' | null;
  setBulkRoleMenu: Dispatch<SetStateAction<'add' | 'remove' | null>>;
  memberRoleMenu: string | null;
  setMemberRoleMenu: Dispatch<SetStateAction<string | null>>;
  memberRoleDetailsMenu: string | null;
  setMemberRoleDetailsMenu: Dispatch<SetStateAction<string | null>>;
  settingsError: string;
  overviewDirty: boolean;
  roleEditorDirty: boolean;
  saveBarShake: number;
  confirmDeleteGroup: boolean;
  setConfirmDeleteGroup: (value: boolean) => void;
  requestCloseSettings: () => void;
  requestDeleteGroup: () => void;
  handleAvatarUpload: (file: File | undefined) => Promise<void>;
  handleNameplateUpload: (file: File | undefined) => Promise<void>;
  handleRegenerateInvite: () => Promise<void>;
  handleCopyInviteCode: (code: string, channelId?: string | null) => Promise<void>;
  handleDeleteInvite: (inviteId: string) => Promise<void>;
  handleSetDefaultRole: (roleId: string | null) => Promise<void>;
  handleCreateRole: () => Promise<void>;
  handleDeleteRole: (roleId: string) => Promise<void>;
  handleCopyRoleId: (roleId: string) => Promise<void>;
  openRoleEditor: (role: GroupRole) => void;
  openEveryoneRoleEditor: () => void;
  closeRoleEditor: () => void;
  resetRoleDrafts: () => void;
  handleSaveRolePermissions: (roleId: string) => Promise<void>;
  memberHasRole: (member: GroupMember, roleId: string) => boolean;
  getHeldRoleIds: (member: GroupMember) => string[];
  handleAddMemberRole: (userId: string, roleId: string) => Promise<void>;
  handleRemoveMemberRole: (userId: string, roleId: string) => Promise<void>;
  handleBulkMemberRole: (action: 'add' | 'remove', roleId: string) => Promise<void>;
  toggleSelectedMember: (userId: string) => void;
  toggleAllVisibleMembers: () => void;
  handleRemoveMember: (userId: string) => Promise<void>;
  handleLeaveGroup: () => Promise<void>;
  handleDeleteGroup: () => Promise<void>;
  handleSaveSettings: () => Promise<void>;
  resetOverviewDrafts: () => void;
  formatShortDate: (value: string) => string;
};

export function GroupSettingsModal({
  token,
  language,
  currentUser,
  group,
  channels,
  roles,
  members,
  customCategories,
  setCustomCategories,
  groupInvites,
  settingsTab,
  setSettingsTab,
  isOwner,
  canManageRoles,
  canManageInvites,
  canKickMembers,
  otherMembersCount,
  copied,
  newAvatar,
  newName,
  setNewName,
  newDescription,
  setNewDescription,
  nameplateDraft,
  setNameplateDraft,
  defaultRoleId,
  defaultRoleMenuOpen,
  setDefaultRoleMenuOpen,
  roleEditorId,
  roleEditorTab,
  setRoleEditorTab,
  roleSearch,
  setRoleSearch,
  roleSort,
  setRoleSort,
  roleMenuOpen,
  setRoleMenuOpen,
  roleIdCopied,
  collapsedCategories,
  toggleCategory,
  everyonePermissions,
  editingRoleMeta,
  setEditingRoleMeta,
  draftHoist,
  setDraftHoist,
  draftPermissions,
  setDraftPermissions,
  rolePermissionSearch,
  setRolePermissionSearch,
  roleMemberSearch,
  setRoleMemberSearch,
  memberSearch,
  setMemberSearch,
  memberSort,
  setMemberSort,
  memberRoleFilter,
  setMemberRoleFilter,
  settingsMembers,
  selectedMemberIds,
  setSelectedMemberIds,
  selectedVisibleMemberIds,
  bulkRoleMenu,
  setBulkRoleMenu,
  memberRoleMenu,
  setMemberRoleMenu,
  memberRoleDetailsMenu,
  setMemberRoleDetailsMenu,
  settingsError,
  overviewDirty,
  roleEditorDirty,
  saveBarShake,
  confirmDeleteGroup,
  setConfirmDeleteGroup,
  requestCloseSettings,
  requestDeleteGroup,
  handleAvatarUpload,
  handleNameplateUpload,
  handleRegenerateInvite,
  handleCopyInviteCode,
  handleDeleteInvite,
  handleSetDefaultRole,
  handleCreateRole,
  handleDeleteRole,
  handleCopyRoleId,
  openRoleEditor,
  openEveryoneRoleEditor,
  closeRoleEditor,
  resetRoleDrafts,
  handleSaveRolePermissions,
  memberHasRole,
  getHeldRoleIds,
  handleAddMemberRole,
  handleRemoveMemberRole,
  handleBulkMemberRole,
  toggleSelectedMember,
  toggleAllVisibleMembers,
  handleRemoveMember,
  handleLeaveGroup,
  handleDeleteGroup,
  handleSaveSettings,
  resetOverviewDrafts,
  formatShortDate
}: GroupSettingsModalProps) {
  return (
    <div className="messenger-inline-modal settings-fullscreen" onClick={requestCloseSettings}>
      <div className="group-settings-modal" onClick={(event) => event.stopPropagation()}>
        <button
          type="button"
          className="group-settings-close"
          aria-label={t(language, 'close')}
          onClick={requestCloseSettings}
        >
          ✕
        </button>
        <div className="group-settings-sidebar">
          <button type="button" className="group-settings-back" onClick={requestCloseSettings}>
            <span aria-hidden="true">←</span>
            {t(language, 'back')}
          </button>
          <div className="group-settings-sidebar-header">
            <img className="group-settings-sidebar-avatar" src={group.avatarData || `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="%23444" rx="20"/><text x="50" y="58" text-anchor="middle" fill="%23fff" font-size="32" font-family="sans-serif">${(group.name[0]||'?').toUpperCase()}</text></svg>`} alt="" />
            <strong>{group.name}</strong>
          </div>
          <div className="group-settings-tabs-list">
            <button type="button" className={'group-settings-tab' + (settingsTab === 'overview' ? ' active' : '')} onClick={() => setSettingsTab('overview')}>
              {t(language, 'overview')}
            </button>
            <button type="button" className={'group-settings-tab' + (settingsTab === 'invite' ? ' active' : '')} onClick={() => setSettingsTab('invite')}>
              {t(language, 'inviteLink')}
            </button>
            {canManageRoles ? (
              <button type="button" className={'group-settings-tab' + (settingsTab === 'roles' ? ' active' : '')} onClick={() => setSettingsTab('roles')}>
                {t(language, 'roles')}
              </button>
            ) : null}
            {canManageRoles ? (
              <button type="button" className={'group-settings-tab' + (settingsTab === 'members' ? ' active' : '')} onClick={() => setSettingsTab('members')}>
                {t(language, 'members')}
              </button>
            ) : null}
            {canManageRoles ? (
              <button type="button" className={'group-settings-tab' + (settingsTab === 'customization' ? ' active' : '')} onClick={() => setSettingsTab('customization')}>
                {t(language, 'customization')}
              </button>
            ) : null}
          </div>
          {isOwner ? (
            <button
              type="button"
              className="group-settings-delete-tab"
              disabled={otherMembersCount > 0}
              title={otherMembersCount > 0 ? t(language, 'deleteGroupHasMembers') : t(language, 'deleteGroup')}
              onClick={requestDeleteGroup}
            >
              {t(language, 'deleteGroup')}
            </button>
          ) : null}
        </div>
        <div className="group-settings-content">
          {settingsTab === 'overview' ? (
            <div className="group-settings-overview-grid">
             <div className="group-settings-overview-main">
              <div className="group-settings-section">
                <h3>{t(language, 'overview')}</h3>
                <div className="group-settings-avatar-row">
                  {(newAvatar ?? group.avatarData) ? (
                    <img className="group-settings-avatar-preview" src={newAvatar ?? group.avatarData} alt="" />
                  ) : (
                    <span className="group-settings-avatar-fallback">{(group.name[0] ?? '?').toUpperCase()}</span>
                  )}
                  <input id="group-avatar-file" className="hidden-file" type="file" accept="image/*" onChange={(e) => void handleAvatarUpload(e.currentTarget.files?.[0])} />
                  {isOwner ? (
                    <button type="button" className="secondary-action" onClick={() => document.getElementById('group-avatar-file')?.click()}>{t(language, 'uploadAvatar')}</button>
                  ) : null}
                </div>
                <label>{t(language, 'groupName')}</label>
                <input type="text" className="messenger-input" value={newName} onChange={(e) => setNewName(e.target.value)} />
                <label style={{ marginTop: 12 }}>{t(language, 'groupDescription')}</label>
                <textarea
                  className="messenger-input"
                  rows={3}
                  maxLength={200}
                  value={newDescription}
                  style={{ resize: 'vertical' }}
                  readOnly={!isOwner}
                  placeholder={t(language, 'groupDescriptionHint')}
                  onChange={(e) => setNewDescription(e.target.value.slice(0, 200))}
                />
                <small className="muted-line" style={{ alignSelf: 'flex-end' }}>{newDescription.length}/200</small>
              </div>
              <div className="group-settings-section">
                <h3>{t(language, 'nameplate')}</h3>
                <div className="nameplate-editor group-nameplate-editor">
                  <small className="muted-line">{t(language, 'groupNameplateHint')}</small>
                  <div
                    className="nameplate-preview group-nameplate-preview"
                    style={{ background: nameplateToCss(nameplateDraft) ?? undefined, backgroundSize: 'cover', backgroundPosition: 'center' }}
                  >
                    <img src={newAvatar ?? group.avatarData} alt="" />
                    <strong>{newName || group.name}</strong>
                  </div>
                  {isOwner ? (
                    <>
                      <div className="nameplate-types">
                        {(['none', 'color', 'gradient', 'image'] as const).map((type) => (
                          <button
                            key={type}
                            type="button"
                            className={nameplateDraft.type === type ? 'nameplate-type active' : 'nameplate-type'}
                            onClick={() => setNameplateDraft((current) => ({ ...current, type }))}
                          >
                            {t(language, type === 'none' ? 'nameplateNone' : type === 'color' ? 'nameplateColor' : type === 'gradient' ? 'nameplateGradient' : 'nameplateImage')}
                          </button>
                        ))}
                      </div>
                      {nameplateDraft.type === 'color' ? (
                        <label className="nameplate-field">
                          <span>{t(language, 'nameplateColor')}</span>
                          <input type="color" value={nameplateDraft.color} onChange={(e) => setNameplateDraft((c) => ({ ...c, color: e.target.value }))} />
                        </label>
                      ) : null}
                      {nameplateDraft.type === 'gradient' ? (
                        <div className="nameplate-gradient-row">
                          <label className="nameplate-field">
                            <span>{t(language, 'nameplateFrom')}</span>
                            <input type="color" value={nameplateDraft.gradientFrom} onChange={(e) => setNameplateDraft((c) => ({ ...c, gradientFrom: e.target.value }))} />
                          </label>
                          <label className="nameplate-field">
                            <span>{t(language, 'nameplateTo')}</span>
                            <input type="color" value={nameplateDraft.gradientTo} onChange={(e) => setNameplateDraft((c) => ({ ...c, gradientTo: e.target.value }))} />
                          </label>
                        </div>
                      ) : null}
                      {nameplateDraft.type === 'image' ? (
                        <label className="secondary-action" style={{ textAlign: 'center', cursor: 'pointer' }}>
                          {t(language, 'nameplateUpload')}
                          <input
                            type="file"
                            accept="image/*"
                            style={{ display: 'none' }}
                            onChange={(e) => { void handleNameplateUpload(e.currentTarget.files?.[0]); e.currentTarget.value = ''; }}
                          />
                        </label>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </div>
             </div>
             <div className="group-settings-overview-preview">
               <div className="group-embed group-embed-preview">
                 <div
                   className="group-embed-banner"
                   style={{ background: nameplateToCss(nameplateDraft) ?? 'linear-gradient(135deg, var(--blue) 0%, color-mix(in srgb, var(--blue) 55%, #000) 100%)', backgroundSize: 'cover', backgroundPosition: 'center' }}
                 />
                 <div className="group-embed-head">
                   <div className="group-embed-avatar-wrap">
                     <img
                       className="group-embed-avatar"
                       src={(newAvatar ?? group.avatarData) || `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="%23444" rx="20"/><text x="50" y="58" text-anchor="middle" fill="%23fff" font-size="28" font-family="sans-serif">${((newName || group.name)[0] || '?').toUpperCase()}</text></svg>`}
                       alt=""
                     />
                   </div>
                   <div className="group-embed-info">
                     <span className="group-embed-eyebrow">{t(language, 'groupInvite')}</span>
                     <strong className="group-embed-name">{newName || group.name}</strong>
                     <span className="group-embed-meta">{members.length} {t(language, 'members')}</span>
                   </div>
                 </div>
                 {newDescription.trim() ? (
                   <p className="group-embed-description">{newDescription}</p>
                 ) : (
                   <p className="group-embed-description muted-line">{t(language, 'groupDescriptionEmpty')}</p>
                 )}
                 <div className="group-embed-actions">
                   <button className="primary-action" type="button" disabled>{t(language, 'openChat')}</button>
                 </div>
               </div>
             </div>
            </div>
          ) : null}

          {settingsTab === 'invite' ? (
            <div className="group-settings-section group-invites-section">
              <div className="group-invites-topbar">
                <h3>{t(language, 'inviteLink')}</h3>
                {canManageInvites ? (
                  <button type="button" className="primary-action group-invite-create-btn" onClick={() => void handleRegenerateInvite()}>
                    {language === 'ru' ? 'Создать ссылку' : 'Create link'}
                  </button>
                ) : null}
              </div>
              <div className="group-invites-header">
                <span>{language === 'ru' ? 'Дата создания' : 'Created'}</span>
                <span>{language === 'ru' ? 'Кем создана' : 'Created by'}</span>
                <span>{language === 'ru' ? 'Зашли' : 'Uses'}</span>
                <span>{language === 'ru' ? 'Ссылка' : 'Link'}</span>
                <span />
              </div>
              <div className="group-invites-list">
                {groupInvites.filter((invite) => invite?.id && invite.code).length > 0 ? groupInvites.filter((invite) => invite?.id && invite.code).map((invite) => (
                  <div key={invite.id} className="group-invite-row">
                    <span className="group-invite-date">{formatShortDate(invite.createdAt)}</span>
                    <span className="group-invite-creator">{invite.creator ? <UserName user={invite.creator} /> : 'Unknown'}</span>
                    <span className="group-invite-uses">{invite.usesCount}</span>
                    <code className="group-invite-link">{buildGroupInviteLink(invite.code)}</code>
                    <span className="group-invite-actions">
                      <button type="button" onClick={() => void handleCopyInviteCode(invite.code)}>{copied ? 'OK' : 'Copy'}</button>
                      <button type="button" className="danger" onClick={() => void handleDeleteInvite(invite.id)}>{language === 'ru' ? 'Удалить' : 'Delete'}</button>
                    </span>
                  </div>
                )) : (
                  <div className="group-invite-empty">{language === 'ru' ? 'Invite links пока не созданы' : 'No invite links yet'}</div>
                )}
              </div>
            </div>
          ) : null}

          {settingsTab === 'roles' && canManageRoles ? (
            roleEditorId === null ? (
              /* ── Roles: list view ── */
              <div className="group-settings-section group-roles-list-view">
                {/* Role automatically granted when a member joins the server. */}
                {(() => {
                  const assignable = roles.filter((r) => !r.isOwner);
                  const selected = assignable.find((r) => r.id === defaultRoleId) ?? null;
                  return (
                    <div className="group-default-role-row">
                      <span className="group-default-role-label">{t(language, 'defaultRoleOnJoin')}</span>
                      <div className="group-default-role-wrap">
                        <button
                          type="button"
                          className="group-default-role-trigger"
                          onClick={() => setDefaultRoleMenuOpen((v) => !v)}
                        >
                          {selected ? (
                            <>
                              <span className="group-settings-role-dot" style={{ backgroundColor: selected.color }} />
                              <span className="group-default-role-current">{selected.name}</span>
                            </>
                          ) : (
                            <span className="group-default-role-current muted-line">{t(language, 'defaultRoleNone')}</span>
                          )}
                          <span className="group-default-role-caret">▾</span>
                        </button>
                        {defaultRoleMenuOpen ? (
                          <div className="group-default-role-menu">
                            <button
                              type="button"
                              className={'group-default-role-option' + (defaultRoleId === null ? ' active' : '')}
                              onClick={() => void handleSetDefaultRole(null)}
                            >
                              <span className="group-default-role-current muted-line">{t(language, 'defaultRoleNone')}</span>
                            </button>
                            {assignable.map((role) => (
                              <button
                                key={role.id}
                                type="button"
                                className={'group-default-role-option' + (defaultRoleId === role.id ? ' active' : '')}
                                onClick={() => void handleSetDefaultRole(role.id)}
                              >
                                <span className="group-settings-role-dot" style={{ backgroundColor: role.color }} />
                                <span>{role.name}</span>
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })()}
                <div className="group-roles-toolbar">
                  <input
                    type="search"
                    className="messenger-input group-roles-search"
                    value={roleSearch}
                    placeholder={t(language, 'searchRoles')}
                    onChange={(e) => setRoleSearch(e.target.value)}
                  />
                  <select
                    className="messenger-input group-roles-sort"
                    value={roleSort}
                    onChange={(e) => setRoleSort(e.target.value as typeof roleSort)}
                  >
                    <option value="position">{language === 'ru' ? 'По порядку' : 'Position'}</option>
                    <option value="name">{language === 'ru' ? 'По имени' : 'Name'}</option>
                    <option value="members">{language === 'ru' ? 'По участникам' : 'Members'}</option>
                  </select>
                  <button type="button" className="primary-action group-roles-create-btn" onClick={() => void handleCreateRole()}>
                    {t(language, 'createRole')}
                  </button>
                </div>
                {(() => {
                  const countRoleMembers = (roleId: string) => members.filter((m) => memberHasRole(m, roleId)).length;
                  const filtered = roles
                    .filter((r) => r.name.toLowerCase().includes(roleSearch.trim().toLowerCase()))
                    .sort((a, b) => {
                      if (roleSort === 'name') return a.name.localeCompare(b.name, language === 'ru' ? 'ru' : undefined, { sensitivity: 'base' });
                      if (roleSort === 'members') return countRoleMembers(b.id) - countRoleMembers(a.id) || a.position - b.position;
                      return a.position - b.position;
                    });
                  const roleRow = (role: typeof filtered[number]) => {
                    const memberCount = countRoleMembers(role.id);
                    return (
                      <div className="group-roles-row" key={role.id}>
                        <span className="group-settings-role-dot" style={{ backgroundColor: role.color }} />
                        <span className="group-roles-row-name">{role.name}</span>
                        <span className="group-roles-row-count">{memberCount} {t(language, 'members')}</span>
                        {!role.isOwner ? (
                          <>
                            <Tooltip label={t(language, 'editRole')}>
                              <button type="button" className="group-roles-icon-btn group-roles-edit-btn" onClick={() => openRoleEditor(role)}>
                                <img src={assetUrl('Emoji/pencil.png')} alt="" />
                              </button>
                            </Tooltip>
                            <div className="group-roles-menu-wrap">
                              <Tooltip label={t(language, 'roleOptions')}>
                                <button type="button" className="group-roles-icon-btn" onClick={() => setRoleMenuOpen((cur) => (cur === role.id ? null : role.id))}>⋯</button>
                              </Tooltip>
                              {roleMenuOpen === role.id ? (
                                <div className="group-roles-menu">
                                  <button type="button" className="group-roles-menu-item danger" onClick={() => void handleDeleteRole(role.id)}>{t(language, 'deleteRole')}</button>
                                  <button type="button" className="group-roles-menu-item" onClick={() => void handleCopyRoleId(role.id)}>
                                    {roleIdCopied === role.id ? t(language, 'copied') : t(language, 'copyRoleId')}
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          </>
                        ) : null}
                      </div>
                    );
                  };

                  // Build a map: roleId -> { categoryId, categoryName }
                  const categoryMap = new Map<string, { categoryId: string; categoryName: string }>();
                  for (const cat of customCategories) {
                    for (const opt of cat.options) {
                      if (opt.roleId) {
                        categoryMap.set(opt.roleId, { categoryId: cat.id, categoryName: cat.name });
                      }
                    }
                  }

                  // Group filtered roles by category
                  const grouped: { categoryId: string; categoryName: string; roles: typeof filtered }[] = [];
                  const unassigned: typeof filtered = [];

                  for (const role of filtered) {
                    const entry = categoryMap.get(role.id);
                    if (entry) {
                      let group = grouped.find((g) => g.categoryId === entry.categoryId);
                      if (!group) {
                        group = { categoryId: entry.categoryId, categoryName: entry.categoryName, roles: [] };
                        grouped.push(group);
                      }
                      group.roles.push(role);
                    } else {
                      unassigned.push(role);
                    }
                  }

                  const totalCount = filtered.length + 1;
                  return (
                    <>
                      <div className="group-roles-list-header">
                        {t(language, 'roles')} — {totalCount}
                      </div>
                      <div className="group-roles-list">
                        <div className="group-roles-row" key={EVERYONE_ROLE_ID}>
                          <span className="group-settings-role-dot" style={{ backgroundColor: '#8a8a8a' }} />
                          <span className="group-roles-row-name">@everyone</span>
                          <span className="group-roles-row-count">{members.length} {t(language, 'members')}</span>
                          <Tooltip label={t(language, 'editRole')}>
                            <button type="button" className="group-roles-icon-btn group-roles-edit-btn" onClick={openEveryoneRoleEditor}>
                              <img src={assetUrl('Emoji/pencil.png')} alt="" />
                            </button>
                          </Tooltip>
                        </div>
                        {grouped.map((group) => {
                          const collapsed = collapsedCategories.has(group.categoryId);
                          return (
                            <div key={group.categoryId}>
                              <div className="group-roles-category-header" onClick={() => toggleCategory(group.categoryId)}>
                                <span className={'group-roles-chevron' + (collapsed ? '' : ' open')}>▾</span>
                                {group.categoryName}
                              </div>
                              {!collapsed ? group.roles.map(roleRow) : null}
                            </div>
                          );
                        })}
                        {unassigned.length > 0 ? (
                          <div>
                            <div className="group-roles-category-header" onClick={() => toggleCategory('__unassigned__')}>
                              <span className={'group-roles-chevron' + (collapsedCategories.has('__unassigned__') ? '' : ' open')}>▾</span>
                              {t(language, 'otherRoles')}
                            </div>
                            {!collapsedCategories.has('__unassigned__') ? unassigned.map(roleRow) : null}
                          </div>
                        ) : null}
                      </div>
                    </>
                  );
                })()}
              </div>
            ) : (
              /* ── Roles: editor sub-view (sidebar list + settings) ── */
              <div className="group-settings-section group-roles-editor-view">
                  <div className="group-roles-editor-sidebar">
                    <button type="button" className="group-roles-back-btn" onClick={closeRoleEditor}>← {t(language, 'back')}</button>
                    <div className="group-roles-editor-list">
                      <button type="button" className={'group-roles-editor-list-item' + (roleEditorId === EVERYONE_ROLE_ID ? ' active' : '')} onClick={openEveryoneRoleEditor}>
                        <span className="group-settings-role-dot" style={{ backgroundColor: '#8a8a8a' }} />
                        <span className="group-roles-row-name">@everyone</span>
                      </button>
                      {(() => {
                        const map = new Map<string, { categoryId: string; categoryName: string }>();
                        for (const cat of customCategories) {
                          for (const opt of cat.options) {
                            if (opt.roleId) map.set(opt.roleId, { categoryId: cat.id, categoryName: cat.name });
                          }
                        }
                        const groups: { categoryId: string; categoryName: string; roles: typeof roles }[] = [];
                        const unassigned: typeof roles = [];
                        for (const role of roles) {
                          const entry = map.get(role.id);
                          if (entry) {
                            let g = groups.find((x) => x.categoryId === entry.categoryId);
                            if (!g) { g = { categoryId: entry.categoryId, categoryName: entry.categoryName, roles: [] }; groups.push(g); }
                            g.roles.push(role);
                          } else {
                            unassigned.push(role);
                          }
                        }
                        const items: ReactNode[] = [];
                        for (const g of groups) {
                          const collapsed = collapsedCategories.has(g.categoryId);
                          items.push(
                            <div key={`h-${g.categoryId}`} className="group-roles-editor-list-header" onClick={() => toggleCategory(g.categoryId)}>
                              <span className={'group-roles-chevron' + (collapsed ? '' : ' open')}>▾</span>
                              {g.categoryName}
                            </div>
                          );
                          if (!collapsed) {
                            for (const role of g.roles) {
                              items.push(
                                <button key={role.id} type="button" className={'group-roles-editor-list-item' + (roleEditorId === role.id ? ' active' : '')} onClick={() => openRoleEditor(role)}>
                                  <span className="group-settings-role-dot" style={{ backgroundColor: role.color }} />
                                  <span className="group-roles-row-name">{role.name}</span>
                                </button>
                              );
                            }
                          }
                        }
                        if (unassigned.length > 0) {
                          const collapsed = collapsedCategories.has('__unassigned__');
                          items.push(
                            <div key="h-other" className="group-roles-editor-list-header" onClick={() => toggleCategory('__unassigned__')}>
                              <span className={'group-roles-chevron' + (collapsed ? '' : ' open')}>▾</span>
                              {t(language, 'otherRoles')}
                            </div>
                          );
                          if (!collapsed) {
                            for (const role of unassigned) {
                              items.push(
                                <button key={role.id} type="button" className={'group-roles-editor-list-item' + (roleEditorId === role.id ? ' active' : '')} onClick={() => openRoleEditor(role)}>
                                  <span className="group-settings-role-dot" style={{ backgroundColor: role.color }} />
                                  <span className="group-roles-row-name">{role.name}</span>
                                </button>
                              );
                            }
                          }
                        }
                        return items;
                      })()}
                    </div>
                  </div>
                <div className="group-roles-editor-panel">
                  {(() => {
                    const role = roleEditorId === EVERYONE_ROLE_ID
                      ? { id: EVERYONE_ROLE_ID, groupId: group.id, name: '@everyone', color: '#8a8a8a', position: -1, isOwner: false, permissions: everyonePermissions, hoist: false }
                      : roles.find((r) => r.id === roleEditorId);
                    if (!role) return null;
                    const isEveryoneRole = role.id === EVERYONE_ROLE_ID;
                    const permissionKeys = [
                      'ManageRoles',
                      'DeleteAnyMessage',
                      'ManageChannels',
                      'ManageInvites',
                      'KickMembers',
                      'ViewChannel',
                      'SendMessages',
                      'AttachFiles',
                      'AddReactions',
                      'UseExternalEmojis',
                      MENTION_EVERYONE_PERMISSION,
                      'ManageMessages',
                      'PinMessages',
                      'BypassSlowmode',
                      'ReadMessageHistory',
                      'SendVoiceMessages',
                      'SendVideoCircles',
                      'CreatePolls',
                      MENTIONABLE_PERMISSION
                    ];
                    const visiblePermissions = permissionKeys.filter((perm) => {
                      const query = rolePermissionSearch.trim().toLowerCase();
                      if (!query) return true;
                      return perm.toLowerCase().includes(query) || rolePermissionLabel(perm, language).toLowerCase().includes(query);
                    });
                    const roleMembers = members
                      .filter((member) => memberHasRole(member, role.id))
                      .sort((a, b) => a.user.nickname.localeCompare(b.user.nickname, language === 'ru' ? 'ru' : undefined, { sensitivity: 'base' }));
                    const roleMemberQuery = roleMemberSearch.trim().toLowerCase();
                    const visibleRoleMembers = roleMembers.filter((member) => !roleMemberQuery || member.user.nickname.toLowerCase().includes(roleMemberQuery));
                    const assignableRoleMembers = members
                      .filter((member) => !memberHasRole(member, role.id))
                      .filter((member) => !roleMemberQuery || member.user.nickname.toLowerCase().includes(roleMemberQuery))
                      .sort((a, b) => a.user.nickname.localeCompare(b.user.nickname, language === 'ru' ? 'ru' : undefined, { sensitivity: 'base' }));
                    return (
                      <>
                        <div className="group-role-editor-tabs">
                          {!isEveryoneRole ? <button type="button" className={roleEditorTab === 'display' ? 'active' : ''} onClick={() => setRoleEditorTab('display')}>Display</button> : null}
                          <button type="button" className={roleEditorTab === 'permissions' ? 'active' : ''} onClick={() => setRoleEditorTab('permissions')}>Permissions</button>
                          {!isEveryoneRole ? <button type="button" className={roleEditorTab === 'members' ? 'active' : ''} onClick={() => setRoleEditorTab('members')}>Members ({roleMembers.length})</button> : null}
                        </div>
                        {roleEditorTab === 'display' && !isEveryoneRole ? (
                          <div className="group-role-editor-pane">
                            <div className="group-roles-editor-meta">
                              <input type="text" className="messenger-input" value={editingRoleMeta?.name ?? role.name} onChange={(e) => setEditingRoleMeta((prev) => ({ id: role.id, name: e.target.value, color: prev?.color ?? role.color }))} />
                              <input type="color" value={editingRoleMeta?.color ?? role.color} onChange={(e) => setEditingRoleMeta((prev) => ({ id: role.id, name: prev?.name ?? role.name, color: e.target.value }))} />
                            </div>
                            <Tooltip as="div" label={t(language, 'roleDisplayHint')}>
                              <label className="group-role-permission-item group-role-hoist">
                                <input type="checkbox" checked={draftHoist} onChange={(e) => setDraftHoist(e.target.checked)} />
                                {t(language, 'roleDisplaySeparately')}
                              </label>
                            </Tooltip>
                          </div>
                        ) : null}
                        {roleEditorTab === 'permissions' ? (
                          <div className="group-role-editor-pane">
                            <input
                              type="search"
                              className="messenger-input group-role-permission-search"
                              value={rolePermissionSearch}
                              placeholder={language === 'ru' ? 'Поиск прав' : 'Search permissions'}
                              onChange={(e) => setRolePermissionSearch(e.target.value)}
                            />
                            {visiblePermissions.map((perm) => (
                              <label key={perm} className="group-role-permission-item">
                                <input type="checkbox" checked={draftPermissions.includes(perm)}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setDraftPermissions((prev) => [...prev, perm]);
                                    } else {
                                      setDraftPermissions((prev) => prev.filter((p) => p !== perm));
                                    }
                                  }} />
                                {rolePermissionLabel(perm, language)}
                              </label>
                            ))}
                            {visiblePermissions.length === 0 ? <div className="group-role-empty-state">No permissions found</div> : null}
                          </div>
                        ) : null}
                        {roleEditorTab === 'members' && !isEveryoneRole ? (
                          <div className="group-role-editor-pane">
                            <input
                              type="search"
                              className="messenger-input group-role-permission-search"
                              value={roleMemberSearch}
                              placeholder={language === 'ru' ? 'Поиск участников роли' : 'Search role members'}
                              onChange={(e) => setRoleMemberSearch(e.target.value)}
                            />
                            <div className="group-role-members-block">
                              <div className="group-role-members-title">Has role ({visibleRoleMembers.length})</div>
                              {visibleRoleMembers.length > 0 ? visibleRoleMembers.map((member) => (
                                <div key={member.user.id} className="group-role-member-row">
                                  <img src={member.user.avatarData} alt="" />
                                  <span><UserName user={member.user} /></span>
                                  {!role.isOwner ? <button type="button" onClick={() => void handleRemoveMemberRole(member.user.id, role.id)}>Remove</button> : null}
                                </div>
                              )) : <div className="group-role-empty-state">No members found</div>}
                            </div>
                            {!role.isOwner ? (
                              <div className="group-role-members-block">
                                <div className="group-role-members-title">Can add ({assignableRoleMembers.length})</div>
                                {assignableRoleMembers.slice(0, 12).map((member) => (
                                  <div key={member.user.id} className="group-role-member-row">
                                    <img src={member.user.avatarData} alt="" />
                                    <span><UserName user={member.user} /></span>
                                    <button type="button" onClick={() => void handleAddMemberRole(member.user.id, role.id)}>Add</button>
                                  </div>
                                ))}
                                {assignableRoleMembers.length === 0 ? <div className="group-role-empty-state">No members available</div> : null}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </>
                    );
                  })()}
                </div>

                {/* Slide-up save/reset bar: appears with animation when the
                    role editor has unsaved changes. */}
                <SaveBar
                  language={language}
                  dirty={roleEditorDirty}
                  shakeKey={saveBarShake}
                  onReset={resetRoleDrafts}
                  onSave={() => roleEditorId && void handleSaveRolePermissions(roleEditorId)}
                />
              </div>
            )
          ) : null}

          {settingsTab === 'members' && canManageRoles ? (
            <div className="group-settings-section group-settings-members-section">
              <div className="group-settings-members-topbar">
                <h3>{t(language, 'members')}</h3>
                <div className="group-settings-members-controls">
                  <input
                    type="search"
                    className="messenger-input group-settings-members-search"
                    value={memberSearch}
                    placeholder={language === 'ru' ? 'Поиск участников' : 'Search members'}
                    onChange={(e) => setMemberSearch(e.target.value)}
                  />
                  <select
                    className="messenger-input group-settings-members-sort"
                    value={memberSort}
                    onChange={(e) => setMemberSort(e.target.value as typeof memberSort)}
                  >
                    <option value="joined">{language === 'ru' ? 'Дата присоединения' : 'Member since'}</option>
                    <option value="accountCreated">{language === 'ru' ? 'Дата создания аккаунта' : 'Joined Discord'}</option>
                    <option value="alphabetical">{language === 'ru' ? 'Алфавит' : 'Alphabetical'}</option>
                  </select>
                  <select
                    className="messenger-input group-settings-members-sort"
                    value={memberRoleFilter}
                    onChange={(e) => setMemberRoleFilter(e.target.value)}
                  >
                    <option value="all">{language === 'ru' ? 'Все роли' : 'All roles'}</option>
                    {roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
                  </select>
                </div>
              </div>
              {selectedMemberIds.size > 0 ? (
                <div className="group-members-bulk-bar">
                  <span>{language === 'ru' ? 'Выбрано' : 'Selected'}: {selectedMemberIds.size}</span>
                  <div className="group-members-bulk-actions">
                    <div className="group-members-bulk-menu-wrap">
                      <button type="button" onClick={() => setBulkRoleMenu((current) => current === 'add' ? null : 'add')}>{language === 'ru' ? 'Добавить роль' : 'Add role'}</button>
                      {bulkRoleMenu === 'add' ? (
                        <div className="group-settings-member-role-menu group-members-bulk-menu">
                          {roles.filter((role) => !role.isOwner).map((role) => (
                            <button key={role.id} type="button" className="group-settings-member-role-option" onClick={() => void handleBulkMemberRole('add', role.id)}>
                              <span className="group-settings-role-dot" style={{ backgroundColor: role.color }} />
                              <span>{role.name}</span>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <div className="group-members-bulk-menu-wrap">
                      <button type="button" onClick={() => setBulkRoleMenu((current) => current === 'remove' ? null : 'remove')}>{language === 'ru' ? 'Снять роль' : 'Remove role'}</button>
                      {bulkRoleMenu === 'remove' ? (
                        <div className="group-settings-member-role-menu group-members-bulk-menu">
                          {roles.filter((role) => !role.isOwner).map((role) => (
                            <button key={role.id} type="button" className="group-settings-member-role-option" onClick={() => void handleBulkMemberRole('remove', role.id)}>
                              <span className="group-settings-role-dot" style={{ backgroundColor: role.color }} />
                              <span>{role.name}</span>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <button type="button" onClick={() => setSelectedMemberIds(new Set())}>{language === 'ru' ? 'Очистить' : 'Clear'}</button>
                  </div>
                </div>
              ) : null}
              <div className="group-settings-members-header">
                <label className="group-settings-members-select-all">
                  <input
                    type="checkbox"
                    checked={settingsMembers.length > 0 && settingsMembers.every((member) => selectedMemberIds.has(member.user.id))}
                    ref={(input) => {
                      if (input) input.indeterminate = selectedVisibleMemberIds.length > 0 && selectedVisibleMemberIds.length < settingsMembers.length;
                    }}
                    onChange={toggleAllVisibleMembers}
                  />
                  <span>Name</span>
                </label>
                <span>Member Since</span>
                <span>Joined Discord</span>
                <span>Roles</span>
                <span />
              </div>
              <div className="group-settings-members-list">
                {settingsMembers.map((member) => {
                  const memberRoleIds = new Set<string>(getHeldRoleIds(member));
                  const memberRoles = roles
                    .filter((role) => memberRoleIds.has(role.id))
                    .sort((a, b) => a.position - b.position);
                  const primaryRole = memberRoles[0] ?? null;
                  const hiddenRoleCount = Math.max(0, memberRoles.length - 1);
                  const assignableRoles = roles
                    .filter((role) => !role.isOwner && !memberRoleIds.has(role.id))
                    .sort((a, b) => a.position - b.position);
                  const roleEditingDisabled = member.user.id === currentUser.id && isOwner;
                  return (
                    <div key={member.user.id} className="group-settings-member">
                      <div className="group-settings-member-profile">
                        <input
                          type="checkbox"
                          checked={selectedMemberIds.has(member.user.id)}
                          onChange={() => toggleSelectedMember(member.user.id)}
                        />
                        <img src={member.user.avatarData} alt="" className="group-settings-member-avatar" />
                        <span className="group-settings-member-name"><UserName user={member.user} /></span>
                      </div>
                      <span className="group-settings-member-date">{formatShortDate(member.joinedAt)}</span>
                      <span className="group-settings-member-date">{formatShortDate(member.user.createdAt)}</span>
                      <div className="group-settings-member-roles">
                        {primaryRole ? (
                          <>
                            <span className="group-settings-member-role-badge">
                              <span className="group-settings-role-dot" style={{ backgroundColor: primaryRole.color }} />
                              <span className="group-settings-member-role-name">{primaryRole.name}</span>
                              {!primaryRole.isOwner && !roleEditingDisabled ? (
                                <button
                                  type="button"
                                  className="group-settings-member-role-remove"
                                  onClick={() => void handleRemoveMemberRole(member.user.id, primaryRole.id)}
                                  aria-label="Remove role"
                                >
                                  x
                                </button>
                              ) : null}
                            </span>
                            {hiddenRoleCount > 0 ? (
                              <div className="group-settings-member-role-more-wrap">
                                <button
                                  type="button"
                                  className="group-settings-member-role-more"
                                  onClick={() => {
                                    setMemberRoleMenu(null);
                                    setMemberRoleDetailsMenu((current) => (current === member.user.id ? null : member.user.id));
                                  }}
                                >
                                  +{hiddenRoleCount}
                                </button>
                                {memberRoleDetailsMenu === member.user.id ? (
                                  <div className="group-settings-member-role-menu group-settings-member-role-details-menu">
                                    {memberRoles.map((role) => (
                                      <span key={role.id} className="group-settings-member-role-option static">
                                        <span className="group-settings-role-dot" style={{ backgroundColor: role.color }} />
                                        <span>{role.name}</span>
                                        {!role.isOwner && !roleEditingDisabled ? (
                                          <button
                                            type="button"
                                            className="group-settings-member-role-remove"
                                            onClick={() => void handleRemoveMemberRole(member.user.id, role.id)}
                                            aria-label="Remove role"
                                          >
                                            x
                                          </button>
                                        ) : null}
                                      </span>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            ) : null}
                          </>
                        ) : (
                          <span className="group-settings-member-no-role">member</span>
                        )}
                        {!roleEditingDisabled && assignableRoles.length > 0 ? (
                          <div className="group-settings-member-role-add-wrap">
                            <button
                              type="button"
                              className="group-settings-member-role-add"
                              onClick={() => {
                                setMemberRoleDetailsMenu(null);
                                setMemberRoleMenu((current) => (current === member.user.id ? null : member.user.id));
                              }}
                              aria-label="Add role"
                            >
                              +
                            </button>
                            {memberRoleMenu === member.user.id ? (
                              <div className="group-settings-member-role-menu">
                                {assignableRoles.map((role) => (
                                  <button
                                    key={role.id}
                                    type="button"
                                    className="group-settings-member-role-option"
                                    onClick={() => void handleAddMemberRole(member.user.id, role.id)}
                                  >
                                    <span className="group-settings-role-dot" style={{ backgroundColor: role.color }} />
                                    <span>{role.name}</span>
                                  </button>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                      {canKickMembers && member.user.id !== currentUser.id ? (
                        <Tooltip label={t(language, 'kickMember')}>
                          <button type="button" className="group-settings-member-kick" onClick={() => void handleRemoveMember(member.user.id)}>✕</button>
                        </Tooltip>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {settingsTab === 'customization' && canManageRoles ? (
            <CustomizationConstructor
              token={token}
              language={language}
              groupId={group.id}
              categories={customCategories}
              channels={channels}
              onCategoriesChange={setCustomCategories}
            />
          ) : null}

          {settingsError ? <div className="inline-error">{settingsError}</div> : null}
          {!isOwner ? (
            <div className="group-settings-actions">
              <button type="button" className="secondary-action" onClick={() => void handleLeaveGroup()}>{t(language, 'leaveGroup')}</button>
            </div>
          ) : null}
        </div>

        {/* Overview save bar (owner-only). The roles editor renders its own
            save bar inside the roles tab. */}
        {isOwner && settingsTab === 'overview' ? (
          <SaveBar
            language={language}
            dirty={overviewDirty}
            shakeKey={saveBarShake}
            onReset={resetOverviewDrafts}
            onSave={() => void handleSaveSettings()}
          />
        ) : null}
      </div>

      {confirmDeleteGroup ? createPortal(
        <div className="modal-backdrop important" onClick={() => setConfirmDeleteGroup(false)}>
          <section className="confirm-dialog" onClick={(event) => event.stopPropagation()}>
            <p>{t(language, 'deleteGroupConfirm')}</p>
            <div className="confirm-actions">
              <button className="secondary-action" type="button" onClick={() => setConfirmDeleteGroup(false)}>
                {t(language, 'cancel')}
              </button>
              <button className="primary-action danger-text" type="button" onClick={() => void handleDeleteGroup()}>
                {t(language, 'deleteGroup')}
              </button>
            </div>
          </section>
        </div>,
        document.body
      ) : null}
    </div>
  );
}
