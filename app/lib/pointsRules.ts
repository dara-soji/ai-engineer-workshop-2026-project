// ─── Points Rules ───
// The single tuning surface for how many points a student earns. Pure — no
// database access, no imports from services. Nothing else in the codebase
// hardcodes a point value; to retune the system, change the numbers here.
//
// Point values are a product decision. The ledger records what was actually
// awarded, so retuning these numbers never rewrites a student's history.

/** Points earned the first time a student completes a lesson. */
export const POINTS_PER_LESSON_COMPLETION = 10;

/** The points a lesson completion is worth. */
export function pointsForLessonCompletion(): number {
  return POINTS_PER_LESSON_COMPLETION;
}

/** A run of consecutive days worth a bonus, and what that bonus is. */
export type StreakMilestone = {
  /** The length of run, in consecutive days, that reaches this milestone. */
  days: number;
  /** The bonus points reaching it earns, on top of the day's lesson. */
  points: number;
};

/**
 * The streak milestones, shortest first. A student passes through each of these
 * day counts at most once per run, and the ledger keys the award to the day
 * count, so a milestone pays at most once ever.
 *
 * The bonuses climb faster than the runs do: the thirtieth consecutive day is
 * worth far more than the third, because it is far harder won.
 */
export const STREAK_MILESTONES: StreakMilestone[] = [
  { days: 3, points: 25 },
  { days: 7, points: 50 },
  { days: 14, points: 100 },
  { days: 30, points: 250 },
  { days: 60, points: 500 },
  { days: 100, points: 1000 },
];

/**
 * The milestone a streak of exactly this many days reaches, or null if this
 * day is not a milestone.
 *
 * The match is exact, not "the highest milestone at or below". A bonus is paid
 * for *reaching* a milestone, and a live streak arrives at each day count on
 * the day it happens — so a student who was already ten days deep when this
 * shipped is never handed the three- and seven-day bonuses for a run nobody
 * told them they were on.
 */
export function streakMilestoneFor(
  currentStreak: number
): StreakMilestone | null {
  return STREAK_MILESTONES.find((m) => m.days === currentStreak) ?? null;
}
