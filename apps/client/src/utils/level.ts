// Global account levels derived from raw XP (level = floor(sqrt(xp / 100))).
// Level 1 -> 100 XP, level 5 -> 2500 XP, level 10 -> 10000 XP: an early sense
// of progress that keeps slowing down, classic RPG pacing.

export type LevelInfo = {
  level: number;
  // 0..1 progress towards the next level
  progress: number;
  currentXp: number;
  nextLevelXp: number;
};

export function levelFromXp(xp: number): LevelInfo {
  const safeXp = Math.max(0, Math.floor(xp || 0));
  const level = Math.floor(Math.sqrt(safeXp / 100));
  const currentFloor = level * level * 100;
  const nextLevelXp = (level + 1) * (level + 1) * 100;
  const span = nextLevelXp - currentFloor;
  return {
    level,
    progress: span > 0 ? Math.min(1, (safeXp - currentFloor) / span) : 0,
    currentXp: safeXp,
    nextLevelXp
  };
}

// A pinch of RPG flavour for the profile card. Index clamps at the top so
// every high level keeps the last title.
const TIER_KEYS = [
  'rpgTierNovice',      // 0-4
  'rpgTierAdventurer',  // 5-9
  'rpgTierKnight',      // 10-14
  'rpgTierMaster',      // 15-19
  'rpgTierLegend'       // 20+
] as const;

export function tierKeyForLevel(level: number): (typeof TIER_KEYS)[number] {
  return TIER_KEYS[Math.min(TIER_KEYS.length - 1, Math.floor(level / 5))];
}
