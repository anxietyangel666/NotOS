import type { PublicUser, Language } from '../api/types';
import { t } from '../i18n';
import { Tooltip } from './Tooltip';

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
  /**
   * Larger badges used on the profile card. They render at roughly double size
   * and reveal an enlarged description popup that flies upward on hover.
   */
  large?: boolean;
};

// Small non-selectable badges shown under a nickname. Hovering shows a tooltip
// describing the badge. On the profile card (`large`) the badge and its hover
// popup are enlarged.
export function UserBadges({ user, language, large = false }: UserBadgesProps) {
  const badges = badgesForUser(user);
  if (badges.length === 0) return null;
  return (
    <span className={large ? 'user-badges user-badges-large' : 'user-badges'} aria-hidden="false">
      {badges.map((badge) => (
        <Tooltip key={badge.id} label={t(language, badge.labelKey)}>
          <span className={`user-badge ${badge.className}`} role="img" aria-label={t(language, badge.labelKey)}>
            <span className="user-badge-glyph">{badge.glyph}</span>
          </span>
        </Tooltip>
      ))}
    </span>
  );
}
