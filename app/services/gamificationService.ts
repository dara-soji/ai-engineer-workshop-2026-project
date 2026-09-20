import { PointsReason, PointsSourceType } from "~/db/schema";
import { pointsForLessonCompletion } from "~/lib/pointsRules";
import { getLevelProgress, type LevelProgress } from "~/lib/levels";
import {
  awardPoints,
  getPointsTotal as getLedgerPointsTotal,
} from "./pointsLedgerService";
import { getStreak as getStudentStreak, type StreakSummary } from "./streakService";

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
  /** The level that total puts them on, and how far the next one is. */
  level: LevelProgress;
  /** True only when this completion's points carried them over a threshold. */
  leveledUp: boolean;
};

/**
 * Records that a student completed a lesson, awarding the lesson's points, and
 * reports back what was just earned so the UI can acknowledge it at the moment
 * it happened.
 *
 * Safe to call on every completion: the ledger keys the award to the lesson, so
 * re-completing a lesson the student has already been paid for awards nothing
 * further. Resetting progress does not remove the points already earned — the
 * ledger is append-only — and completing the lesson again does not pay twice.
 *
 * A level crossing is a computed difference, not stored state: the level before
 * the award against the level after it. A completion that awards nothing cannot
 * cross a threshold, so a repeat never re-celebrates.
 */
export function recordLessonCompletion(
  userId: number,
  lessonId: number
): LessonCompletionSummary {
  const levelBefore = getLevelProgress(getLedgerPointsTotal(userId)).level;

  const award = awardPoints({
    userId,
    amount: pointsForLessonCompletion(),
    reason: PointsReason.LessonCompleted,
    sourceType: PointsSourceType.Lesson,
    sourceId: lessonId,
  });

  // Read the total back rather than adding the award to the earlier read: more
  // than one award will land here as the course bonus and streak milestones
  // arrive, and the total after all of them is what the student is on.
  const totalPoints = getLedgerPointsTotal(userId);
  const level = getLevelProgress(totalPoints);

  return {
    pointsAwarded: award.amount,
    totalPoints,
    level,
    leveledUp: level.level > levelBefore,
  };
}

/** Every point the student has earned, for display. */
export function getPointsTotal(userId: number): number {
  return getLedgerPointsTotal(userId);
}

export type PointsSummary = {
  /** Every point the student has earned. */
  totalPoints: number;
  /** The level that total puts them on, and how far the next one is. */
  level: LevelProgress;
};

/**
 * The student's standing, for the dashboard: their total and the level derived
 * from it. The level is computed from the same total that is displayed, so the
 * two can never disagree.
 */
export function getPointsSummary(userId: number): PointsSummary {
  const totalPoints = getLedgerPointsTotal(userId);

  return { totalPoints, level: getLevelProgress(totalPoints) };
}

export type { StreakSummary };

/**
 * The student's current and longest streak, for the dashboard and the sidebar.
 *
 * Derived on every read from their completion dates, so it is correct without
 * anything having run overnight to break it.
 */
export function getStreak(userId: number): StreakSummary {
  return getStudentStreak(userId);
}
