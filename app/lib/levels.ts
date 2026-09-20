// ─── Levels ───
// A level is derived from the points total, never stored. There is no level
// column, no level-up job, and no state that can disagree with the total. Pure —
// no database access, no imports from services.
//
// Because points only ever accumulate, a level can never decrease: a milestone
// once reached stays reached.

/**
 * The points total at which each level begins, lowest first. The single place
 * the level curve is defined — index 0 is level 1, index 1 is level 2, and so
 * on. Must stay strictly increasing.
 *
 * Like the point values themselves, this curve is a product decision and is
 * expected to be retuned once real data arrives.
 */
export const LEVEL_THRESHOLDS = [
  0, // Level 1
  50, // Level 2
  150, // Level 3
  300, // Level 4
  500, // Level 5
  800, // Level 6
  1200, // Level 7
  1700, // Level 8
  2300, // Level 9
  3000, // Level 10
];

/** The highest level a student can reach on the current curve. */
export const MAX_LEVEL = LEVEL_THRESHOLDS.length;

export type LevelProgress = {
  /** The level the total falls in, starting at 1. */
  level: number;
  /** The points total at which this level began. */
  levelStartsAt: number;
  /** The points total at which the next level begins, or null at the top. */
  nextLevelAt: number | null;
  /** Points earned since this level began. */
  pointsIntoLevel: number;
  /** Points still needed to reach the next level, or null at the top. */
  pointsToNextLevel: number | null;
  /** How far through this level the student is, 0–100; 100 at the top level. */
  progressPercent: number;
};

/**
 * Maps a points total to the level it falls in, the progress into that level,
 * and the points remaining to the next one.
 *
 * A total of zero is the starting level, not an error. A total beyond the final
 * threshold stays at the highest level, with no next level to count towards.
 */
export function getLevelProgress(totalPoints: number): LevelProgress {
  const points = normalizeTotal(totalPoints);

  let index = 0;
  while (index + 1 < LEVEL_THRESHOLDS.length && points >= LEVEL_THRESHOLDS[index + 1]) {
    index++;
  }

  const levelStartsAt = LEVEL_THRESHOLDS[index];
  const nextLevelAt = index + 1 < LEVEL_THRESHOLDS.length ? LEVEL_THRESHOLDS[index + 1] : null;
  const pointsIntoLevel = points - levelStartsAt;

  if (nextLevelAt === null) {
    return {
      level: index + 1,
      levelStartsAt,
      nextLevelAt: null,
      pointsIntoLevel,
      pointsToNextLevel: null,
      progressPercent: 100,
    };
  }

  const span = nextLevelAt - levelStartsAt;

  return {
    level: index + 1,
    levelStartsAt,
    nextLevelAt,
    pointsIntoLevel,
    pointsToNextLevel: nextLevelAt - points,
    // Floored, so the bar never reads full until the level is actually crossed.
    progressPercent: Math.floor((pointsIntoLevel / span) * 100),
  };
}

/** Defends the curve against totals that should never reach it. */
function normalizeTotal(totalPoints: number): number {
  if (!Number.isFinite(totalPoints)) return 0;
  return Math.max(0, Math.floor(totalPoints));
}
