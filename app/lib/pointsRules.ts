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
