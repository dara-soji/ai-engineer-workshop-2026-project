import { PointsReason, PointsSourceType } from "~/db/schema";
import { pointsForLessonCompletion } from "~/lib/pointsRules";
import {
  awardPoints,
  getPointsTotal as getLedgerPointsTotal,
} from "./pointsLedgerService";

// ─── Gamification Service ───
// The orchestrator, and the only gamification module routes talk to. Routes
// never touch the ledger or the rules directly — everything the UI needs comes
// back from the call that recorded the achievement.
// Uses positional parameters (project convention).

export type LessonCompletionSummary = {
  /** Points earned by this completion — 0 when the lesson was already counted. */
  pointsAwarded: number;
  /** The student's total after this completion. */
  totalPoints: number;
};

/**
 * Records that a student completed a lesson, awarding the lesson's points.
 *
 * Safe to call on every completion: the ledger keys the award to the lesson, so
 * re-completing a lesson the student has already been paid for awards nothing
 * further. Resetting progress does not remove the points already earned — the
 * ledger is append-only — and completing the lesson again does not pay twice.
 */
export function recordLessonCompletion(
  userId: number,
  lessonId: number
): LessonCompletionSummary {
  const award = awardPoints({
    userId,
    amount: pointsForLessonCompletion(),
    reason: PointsReason.LessonCompleted,
    sourceType: PointsSourceType.Lesson,
    sourceId: lessonId,
  });

  return {
    pointsAwarded: award.amount,
    totalPoints: getLedgerPointsTotal(userId),
  };
}

/** Every point the student has earned, for display. */
export function getPointsTotal(userId: number): number {
  return getLedgerPointsTotal(userId);
}
