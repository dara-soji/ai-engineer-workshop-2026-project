import { PointsReason, PointsSourceType } from "~/db/schema";
import {
  pointsForCourseCompletion,
  pointsForLessonCompletion,
  pointsForQuizPass,
  streakMilestoneFor,
  type StreakMilestone,
} from "~/lib/pointsRules";
import { getLevelProgress, type LevelProgress } from "~/lib/levels";
import {
  awardPoints,
  getPointsTotal as getLedgerPointsTotal,
} from "./pointsLedgerService";
import {
  getCompletedLessonCount,
  getCourseIdForLesson,
  getTotalLessonCount,
} from "./progressService";
import { getStreak as getStudentStreak, type StreakSummary } from "./streakService";

// ─── Gamification Service ───
// The orchestrator, and the only gamification module routes talk to. Routes
// never touch the ledger or the rules directly — everything the UI needs comes
// back from the call that recorded the achievement.
// Uses positional parameters (project convention).

/** The course a completion finished, and what finishing it paid. */
export type CourseCompletion = {
  /** The course the student just finished. */
  courseId: number;
  /** The bonus points finishing it earned. */
  points: number;
};

export type LessonCompletionSummary = {
  /**
   * Everything this completion earned: the lesson, plus any course completion
   * or streak milestone bonus it triggered. Zero when none of it was new.
   */
  pointsAwarded: number;
  /** The student's total after this completion. */
  totalPoints: number;
  /** The level that total puts them on, and how far the next one is. */
  level: LevelProgress;
  /** True only when this completion's points carried them over a threshold. */
  leveledUp: boolean;
  /**
   * The course this completion finished and was paid for, or null — null both
   * when the course is not finished and when the bonus had already been paid.
   */
  courseCompletion: CourseCompletion | null;
  /**
   * The streak milestone this completion reached and was paid for, or null —
   * null both when no milestone was reached and when it had already been paid.
   */
  streakMilestone: StreakMilestone | null;
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
 *
 * Must be called after the lesson's progress has been recorded: both the streak
 * and whether the course is now finished are derived from the progress rows, so
 * neither today nor this lesson counts until the row exists.
 */
export function recordLessonCompletion(
  userId: number,
  lessonId: number
): LessonCompletionSummary {
  const levelBefore = getLevelProgress(getLedgerPointsTotal(userId)).level;

  const lessonAward = awardPoints({
    userId,
    amount: pointsForLessonCompletion(),
    reason: PointsReason.LessonCompleted,
    sourceType: PointsSourceType.Lesson,
    sourceId: lessonId,
  });

  const courseCompletion = awardCourseCompletion(userId, lessonId);
  const streakMilestone = awardStreakMilestone(userId);

  // Read the total back rather than adding the awards to the earlier read:
  // three separate awards may have landed by now.
  const totalPoints = getLedgerPointsTotal(userId);
  const level = getLevelProgress(totalPoints);

  return {
    pointsAwarded:
      lessonAward.amount +
      (courseCompletion?.points ?? 0) +
      (streakMilestone?.points ?? 0),
    totalPoints,
    level,
    leveledUp: level.level > levelBefore,
    courseCompletion,
    streakMilestone,
  };
}

/**
 * Pays the bonus if this completion was the one that finished the lesson's
 * course, and reports which course — or null if there was nothing to pay.
 *
 * "Finished" means every lesson in the course is complete, which is why this
 * must run after the completion's progress row exists: the lesson that just
 * landed is one of the ones being counted. A course with no lessons is never
 * finished — there is nothing to have done.
 *
 * The course is the source id, so the ledger's key is what keeps the bonus to
 * once per course: revisiting any lesson of a course already finished, or
 * resetting one and completing it again, cannot pay a second time.
 */
function awardCourseCompletion(
  userId: number,
  lessonId: number
): CourseCompletion | null {
  const courseId = getCourseIdForLesson(lessonId);
  if (courseId === null) return null;

  const totalLessons = getTotalLessonCount(courseId);
  if (totalLessons === 0) return null;
  if (getCompletedLessonCount(userId, courseId) < totalLessons) return null;

  const award = awardPoints({
    userId,
    amount: pointsForCourseCompletion(),
    reason: PointsReason.CourseCompleted,
    sourceType: PointsSourceType.Course,
    sourceId: courseId,
  });

  // Already paid for — nothing new happened, so there is nothing to celebrate.
  return award.awarded ? { courseId, points: award.amount } : null;
}

/**
 * Pays the bonus if this completion carried the student onto a streak
 * milestone, and reports which one — or null if there was nothing to pay.
 *
 * The streak itself stays derived from completion dates; only the award is
 * written down, keyed by the milestone's day count. That key is what makes
 * reaching the same milestone twice — in one run, or in a later one after a
 * break — a silent no-op, so there is still no streak state to keep in sync.
 */
function awardStreakMilestone(userId: number): StreakMilestone | null {
  const milestone = streakMilestoneFor(getStudentStreak(userId).currentStreak);
  if (!milestone) return null;

  const award = awardPoints({
    userId,
    amount: milestone.points,
    reason: PointsReason.StreakMilestoneReached,
    sourceType: PointsSourceType.Streak,
    sourceId: milestone.days,
  });

  // Already paid for — nothing new happened, so there is nothing to celebrate.
  return award.awarded ? milestone : null;
}

export type QuizAttemptSummary = {
  /** What this attempt earned. Zero for a failure, and for a re-pass. */
  pointsAwarded: number;
  /** The student's total after this attempt. */
  totalPoints: number;
  /** The level that total puts them on, and how far the next one is. */
  level: LevelProgress;
  /** True only when this attempt's points carried them over a threshold. */
  leveledUp: boolean;
};

/**
 * Records a quiz attempt, awarding the quiz's points if it was a passing one,
 * and reports back what was earned so the UI can acknowledge it alongside the
 * result.
 *
 * Safe to call on every attempt, passing or not. A failure awards nothing; a
 * pass awards once per quiz, however many attempts it took and however much a
 * later attempt improves the score. That is the ledger's key doing the work —
 * the quiz is the source id, so there is no attempt count to consult and
 * re-taking a passed quiz to farm points is impossible by construction.
 *
 * `passed` is the verdict from the quiz scoring service, which is the only
 * module that decides what passes: the instructor's configured passing score
 * governs, and a score exactly at it is a pass. Callers hand that verdict
 * straight through rather than re-deriving it, so the award and the result the
 * student is shown can never disagree.
 */
export function recordQuizAttempt(
  userId: number,
  quizId: number,
  passed: boolean
): QuizAttemptSummary {
  const levelBefore = getLevelProgress(getLedgerPointsTotal(userId)).level;

  const award = passed
    ? awardPoints({
        userId,
        amount: pointsForQuizPass(),
        reason: PointsReason.QuizPassed,
        sourceType: PointsSourceType.Quiz,
        sourceId: quizId,
      })
    : { awarded: false, amount: 0 };

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
