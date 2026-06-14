import type { PublicUser, Language } from '../api/types';
import { t } from '../i18n';

type BadgeDef = {
  id: string;
  glyph: string;
  className: string;
  labelKey: Parameters<typeof t>[1];
};

// Returns the list of badges a user has earned. Currently only the developer
// badge, but new badges can be appended here and they render automatically.
function badgesForUser(user: Pick<PublicUser, 'role'>): BadgeDef[] {
  const badges: BadgeDef[] = [];
  if (user.role === 'dev') {
    badges.push({ id: 'dev', glyph: '</>', className: 'user-badge-dev', labelKey: 'badgeDevTooltip' });
  }
  return badges;
}

type UserBadgesProps = {
  user: Pick<PublicUser, 'role'>;
  language: Language;
};

// Small non-selectable badges shown under a nickname. Hovering shows a tooltip
// describing the badge.
export function UserBadges({ user, language }: UserBadgesProps) {
  const badges = badgesForUser(user);
  if (badges.length === 0) return null;
  return (
    <span className="user-badges" aria-hidden="false">
      {badges.map((badge) => (
        <span key={badge.id} className={`user-badge ${badge.className}`} role="img" aria-label={t(language, badge.labelKey)}>
          <span className="user-badge-glyph">{badge.glyph}</span>
          <span className="user-badge-tooltip" role="tooltip">{t(language, badge.labelKey)}</span>
        </span>
      ))}
    </span>
  );
}
