import type { CSSProperties } from 'react';
import type { Language, NameStyle, PublicUser } from '../api/types';
import { t } from '../i18n';
import { nameStyleClass, nameStyleToCss } from '../utils/name-style';
import { MessagePreviewText } from './Twemoji';
import { UserBadges } from './UserBadges';

type ProfilePreviewCardProps = {
  user: PublicUser;
  language: Language;
  bannerBackground: string;
  avatar?: string;
  nickname?: string;
  status?: string;
  nameStyle?: NameStyle;
  primaryColor?: string;
  accentColor?: string;
};

export function ProfilePreviewCard({
  user,
  language,
  bannerBackground,
  avatar = user.avatarData,
  nickname = user.nickname,
  status = user.status,
  nameStyle = user.nameStyle,
  primaryColor = user.profilePrimaryColor,
  accentColor = user.profileAccentColor
}: ProfilePreviewCardProps) {
  return (
    <div
      className="profile-modal-card profile-themed profile-preview-card"
      style={{
        position: 'relative',
        boxShadow: 'none',
        width: '100%',
        ['--profile-primary' as string]: primaryColor,
        ['--profile-accent' as string]: accentColor
      } as CSSProperties}
    >
      <div className="profile-banner" style={{ backgroundImage: bannerBackground, height: 100 }} />
      <div className="profile-body">
        <div className="profile-main">
          <div className="profile-avatar-status-row">
            <div className="profile-badges-anchor">
              <UserBadges user={user} language={language} large />
            </div>
            <div className="profile-avatar-wrap">
              <img src={avatar} alt="" />
              <span className="profile-presence online" />
            </div>
            <div className="profile-status-bubble">
              {status ? <MessagePreviewText text={status} size={16} /> : t(language, 'noStatus')}
            </div>
          </div>
          <div className="profile-info">
            <div className="profile-name-row">
              <h3 className={nameStyleClass(nameStyle)} style={nameStyleToCss(nameStyle)}>{nickname || t(language, 'nickname')}</h3>
            </div>
            <div className="profile-dates">
              <small>
                <span>{t(language, 'memberSince')}</span>
                <strong>{new Date(user.createdAt).toLocaleDateString()}</strong>
              </small>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
