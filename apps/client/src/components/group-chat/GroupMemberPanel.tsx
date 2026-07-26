// Right members sidebar grouped by hoisted role categories. Extracted verbatim
// from GroupChatView.tsx.
import type { CSSProperties } from 'react';
import type { Group, GroupMember, GroupRole, Language, PublicUser } from '../../api/types';
import { nameplateToCss } from '../../api/types';
import { t } from '../../i18n';
import type { PresenceStatus } from '../../utils/user-status';
import { SpotifyActivityLine } from '../UserActivityStatus';
import { UserName } from '../UserName';

type MemberCategory = { key: string; label: string; color?: string; position: number; members: GroupMember[] };

type GroupMemberPanelProps = {
  token: string;
  language: Language;
  group: Group;
  members: GroupMember[];
  memberCategories: MemberCategory[];
  ownerRoleId: string | undefined;
  typingMemberIds: Set<string>;
  canKickMembers: boolean;
  isMemberOnline: (userId: string) => boolean;
  memberPresenceStatus: (userId: string) => PresenceStatus | null;
  buildProfilePreload: (userId: string) => { groupRoles: GroupRole[]; userRoles: GroupRole[] };
  onViewProfile?: (user: PublicUser, group?: Group, preload?: { groupRoles: GroupRole[]; userRoles: GroupRole[] }, anchorRect?: { left: number; top: number; right: number; bottom: number } | null) => void;
  setMemberMenu: (value: { x: number; y: number; user: PublicUser } | null) => void;
  handleRemoveMember: (userId: string) => Promise<void>;
};

export function GroupMemberPanel({
  token,
  language,
  group,
  members,
  memberCategories,
  ownerRoleId,
  typingMemberIds,
  canKickMembers,
  isMemberOnline,
  memberPresenceStatus,
  buildProfilePreload,
  onViewProfile,
  setMemberMenu,
  handleRemoveMember
}: GroupMemberPanelProps) {
  return (
    <aside className="group-member-panel">
      <div className="group-member-panel-header">
        <strong>{t(language, 'members')} ({members.length})</strong>
      </div>
      <div className="group-member-list">
        {memberCategories.map((category) => (
          <div key={category.key}>
            <div className="group-role-header" style={category.color ? { color: category.color } : undefined}>
              {category.label} — {category.members.length}
            </div>
            {category.members.map((member) => {
              const memberOnline = isMemberOnline(member.user.id);
              const memberStatus = memberPresenceStatus(member.user.id);
              const plateCss = nameplateToCss(member.user.nameplate);
              const memberTyping = typingMemberIds.has(member.user.id);
              return (
              <div className={`${memberOnline ? 'group-member-card' : 'group-member-card offline'}${plateCss ? ' has-nameplate' : ''}`} style={plateCss ? { '--nameplate-bg': plateCss } as CSSProperties : undefined} key={member.user.id}
                onClick={(event) => {
                  if ((event.target as HTMLElement).closest('button')) return;
                  const rect = event.currentTarget.getBoundingClientRect();
                  onViewProfile?.(member.user, group, buildProfilePreload(member.user.id), rect);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setMemberMenu({ x: event.clientX, y: event.clientY, user: member.user });
                }}>
                <span className="messenger-avatar-wrap">
                  <img src={member.user.avatarData} alt="" />
                  <i className={`${memberStatus ? `presence-dot status-${memberStatus}` : 'presence-dot'}${memberTyping ? ' typing' : ''}`}>
                    {memberTyping ? <span className="typing-presence-dots" aria-hidden="true"><b /><b /><b /></span> : null}
                  </i>
                </span>
                <span className="group-member-name"><UserName user={member.user} />{member.roleId === ownerRoleId ? ' 👑' : ''}</span>
                <SpotifyActivityLine token={token} userId={member.user.id} className="group-member-spotify" />
                {canKickMembers && !member.role.includes('Owner') ? (
                  <button type="button" className="group-member-remove" onClick={() => void handleRemoveMember(member.user.id)} title="Remove">✕</button>
                ) : null}
              </div>
              );
            })}
          </div>
        ))}
      </div>
    </aside>
  );
}
