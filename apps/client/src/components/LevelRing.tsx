import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { Language } from '../api/types';
import { t } from '../i18n';
import { levelFromXp, tierKeyForLevel } from '../utils/level';

type LevelRingProps = {
  xp: number;
  language: Language;
};

// Geometry in SVG user units. Everything is drawn in a 100x100 viewBox and
// scaled by CSS, so one component works for every avatar size in the app.
const RADIUS = 47;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

// The badge circle is a thick donut rather than a thin ring, so it stays legible
// at ~14px. Radius + half the stroke must stay within the 100x100 viewBox
// (40 + 20/2 = 50), otherwise the stroke renders outside the box.
const BADGE_RADIUS = 40;
const BADGE_CIRCUMFERENCE = 2 * Math.PI * BADGE_RADIUS;

/**
 * League-client style level display for an avatar:
 *
 *  - a progress arc wrapping the avatar, filling clockwise from 12 o'clock
 *  - a badge above the avatar holding a small progress circle (no digit inside)
 *    and the level number, both in one panel
 *
 * Hovering the arc or the badge shows `currentXp / nextLevelXp` plus how much
 * XP is left for the next level.
 *
 * Renders absolutely-positioned children, so the parent must be
 * `position: relative` with `overflow: visible`.
 */
export function LevelRing({ xp, language }: LevelRingProps) {
  const info = levelFromXp(xp);
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);

  // Never render an empty stroke for a fresh level: a hairline arc reads as
  // "just started" while nothing at all reads as "broken".
  const dash = Math.max(info.progress * CIRCUMFERENCE, info.progress > 0 ? 1.5 : 0);
  const remaining = Math.max(0, info.nextLevelXp - info.currentXp);

  function showTip(event: React.MouseEvent) {
    const rect = event.currentTarget.getBoundingClientRect();
    setTip({ x: rect.left + rect.width / 2, y: rect.top });
  }

  const hoverProps = {
    onMouseEnter: showTip,
    onMouseLeave: () => setTip(null)
  };

  const badgeDash = Math.max(
    info.progress * BADGE_CIRCUMFERENCE,
    info.progress > 0 ? 1.5 : 0
  );

  const badgeCircles = (
    <>
      <circle className="level-ring-track" cx="50" cy="50" r={BADGE_RADIUS} />
      <circle
        className="level-ring-fill"
        cx="50"
        cy="50"
        r={BADGE_RADIUS}
        strokeDasharray={`${badgeDash} ${BADGE_CIRCUMFERENCE}`}
      />
    </>
  );

  return (
    <div className="level-ring">
      <svg className="level-ring-arc" viewBox="0 0 100 100" aria-hidden="true">
        {/* Track and fill both listen for hover so the whole ring band is a
            hover target, while the avatar underneath stays clickable. */}
        <circle className="level-ring-track" cx="50" cy="50" r={RADIUS} {...hoverProps} />
        <circle
          className="level-ring-fill"
          cx="50"
          cy="50"
          r={RADIUS}
          strokeDasharray={`${dash} ${CIRCUMFERENCE}`}
          {...hoverProps}
        />
      </svg>

      {/* Single panel above the avatar: progress circle on the left, level
          number on the right. */}
      <span className="level-ring-badge" {...hoverProps}>
        <svg className="level-ring-badge-arc" viewBox="0 0 100 100" aria-hidden="true">
          {badgeCircles}
        </svg>
        <b>{info.level}</b>
      </span>

      {tip
        ? createPortal(
            <div className="app-tooltip level-ring-tip" style={{ left: tip.x, top: tip.y }} role="tooltip">
              <strong>
                {t(language, 'levelLabel')} {info.level} · {t(language, tierKeyForLevel(info.level))}
              </strong>
              <span>
                {info.currentXp} / {info.nextLevelXp} XP
              </span>
              <small>{t(language, 'levelXpToNext').replace('{xp}', String(remaining))}</small>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
