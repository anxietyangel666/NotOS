import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { Group, GroupChannel, GroupMember, GroupRole, Language, PublicUser } from '../api/types';
import { t } from '../i18n';
import { UserName } from './UserName';

type GroupInfoViewProps = {
  token: string;
  language: Language;
  currentUser: PublicUser;
  group: Group;
  onClose: () => void;
  onEnterChat: (group: Group) => void;
};

export function GroupInfoView({ token, language, currentUser, group, onClose, onEnterChat }: GroupInfoViewProps) {
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [roles, setRoles] = useState<GroupRole[]>([]);
  const [channels, setChannels] = useState<GroupChannel[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void Promise.all([
      api.getGroupChannels(token, group.id),
      api.getGroupRoles(token, group.id),
      api.getGroupMembers(token, group.id)
    ]).then(([chanPayload, rolePayload, memPayload]) => {
      setChannels(chanPayload.channels);
      setRoles(rolePayload.roles);
      setMembers(memPayload.members);
    });
  }, [token, group.id]);

  const isOwner = group.ownerId === currentUser.id;
  const ownerMember = members.find((m) => m.user.id === group.ownerId);

  const roleName = (roleId: string | null) => {
    const role = roles.find((r) => r.id === roleId);
    return role?.name ?? null;
  };

  const roleColor = (roleId: string | null) => {
    const role = roles.find((r) => r.id === roleId);
    return role?.color ?? undefined;
  };

  async function handleCopyInvite() {
    try {
      await navigator.clipboard.writeText(group.inviteCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  }

  const memberGroups = roles.reduce<{ role: GroupRole; members: GroupMember[] }[]>((acc, role) => {
    const roleMembers = members.filter((m) => m.roleId === role.id);
    if (roleMembers.length > 0) acc.push({ role, members: roleMembers });
    return acc;
  }, []);
  const ungroupedMembers = members.filter((m) => !m.roleId);

  return (
    <div className="group-info-view">
      <header className="group-info-header">
        <div className="group-info-avatar-wrap">
          <img src={group.avatarData || `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="%23444" rx="20"/><text x="50" y="58" text-anchor="middle" fill="%23fff" font-size="32" font-family="sans-serif">${(group.name[0]||'?').toUpperCase()}</text></svg>`} alt="" />
        </div>
        <div className="group-info-title-row">
          <h2>{group.name}</h2>
          {isOwner ? <span className="group-info-owner-badge">{t(language, 'owner')}</span> : null}
        </div>
        <div className="group-info-meta">
          <span>{members.length} {t(language, 'members')}</span>
          <span className="group-info-dot">·</span>
          <span>{channels.length} {t(language, 'channels')}</span>
        </div>
        {ownerMember ? (
          <div className="group-info-owner">
            <small>{t(language, 'createdBy')}</small>
            <UserName user={ownerMember.user} />
          </div>
        ) : null}
      </header>

      <div className="group-info-body">
        <div className="group-info-section">
          <div className="group-info-section-title">
            <strong>{t(language, 'members')}</strong>
            <span>{members.length}</span>
          </div>
          {memberGroups.map(({ role, members: roleMembers }) => (
            <div key={role.id} className="group-info-role-group">
              <span className="group-info-role-label" style={role.color ? { color: role.color } : undefined}>{role.name}</span>
              {roleMembers.map((m) => (
                <div className="group-info-member" key={m.user.id}>
                  <img src={m.user.avatarData} alt="" />
                  <UserName user={m.user} />
                </div>
              ))}
            </div>
          ))}
          {ungroupedMembers.length > 0 ? (
            <div className="group-info-role-group">
              {ungroupedMembers.map((m) => (
                <div className="group-info-member" key={m.user.id}>
                  <img src={m.user.avatarData} alt="" />
                  <UserName user={m.user} />
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="group-info-section">
          <div className="group-info-section-title">
            <strong>{t(language, 'channels')}</strong>
            <span>{channels.length}</span>
          </div>
          {channels.map((ch) => (
            <div className="group-info-channel" key={ch.id}>
              <span># {ch.name}</span>
            </div>
          ))}
        </div>

        <div className="group-info-section">
          <div className="group-info-section-title">
            <strong>{t(language, 'inviteLink')}</strong>
          </div>
          <div className="group-info-invite">
            <code>{group.inviteCode}</code>
            <button type="button" onClick={() => void handleCopyInvite()}>{copied ? 'OK' : t(language, 'copyInviteLink')}</button>
          </div>
        </div>
      </div>

      <div className="group-info-actions">
        <button type="button" className="primary-action" onClick={() => onEnterChat(group)}>{t(language, 'openChat')}</button>
        <button type="button" onClick={onClose}>{t(language, 'close')}</button>
      </div>
    </div>
  );
}
