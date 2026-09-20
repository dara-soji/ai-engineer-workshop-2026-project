import { asc, eq, isNotNull } from "drizzle-orm";
import { db } from "~/db";
import {
  enrollments,
  lessonProgress,
  LessonProgressStatus,
  PointsReason,
  PointsSourceType,
  quizAttempts,
  quizzes,
} from "~/db/schema";
import {
  pointsForCourseCompletion,
  pointsForLessonCompletion,
  pointsForQuizPass,
} from "~/lib/pointsRules";
import { awardPoints } from "./pointsLedgerService";
import { isPassingScore } from "./quizScoringService";

// ─── Points Backfill ───
// Converts the history that existed before this feature shipped into ledger
// entries, so a student who finished forty lessons opens the dashboard on
// release day and sees those forty lessons counted rather than a zero.
//
// Run once at release, and safe to run again: every entry it writes is keyed
// exactly as the live system keys it, so the ledger's unique index absorbs both
// a second run and any overlap with points already earned live. Nothing here
// reads what has already been backfilled — it simply offers every entry it can
// justify and lets the ledger decide which are new.
//
// This is a one-off operation invoked by a script, not by a route, which is why
// it sits outside the gamification orchestrator: it awards points at historic
// timestamps, which nothing in the live path is allowed to do.

/** What a run of the backfill added. All zeros on a second run. */
export type BackfillSummary = {
  /** Lesson completions converted into points by this run. */
  lessonsAwarded: number;
  /** Quiz passes converted into points by this run. */
  quizzesAwarded: number;
  /** Course completions converted into bonuses by this run. */
  coursesAwarded: number;
  /** The points this run added across every student. */
  pointsAwarded: number;
};

/**
 * Converts every student's completed lessons, passed quizzes and finished
 * courses into ledger entries, dated by when the student did the work.
 *
 * Streak milestones are deliberately left out. Points for past work are owed to
 * the student; a bonus for a thirty-day run nobody ever told them they were on
 * is not. Streaks begin accruing at launch.
 */
export function backfillPointsLedger(): BackfillSummary {
  const summary: BackfillSummary = {
    lessonsAwarded: 0,
    quizzesAwarded: 0,
    coursesAwarded: 0,
    pointsAwarded: 0,
  };

  for (const completion of completedLessons()) {
    const award = awardPoints({
      userId: completion.userId,
      amount: pointsForLessonCompletion(),
      reason: PointsReason.LessonCompleted,
      sourceType: PointsSourceType.Lesson,
      sourceId: completion.lessonId,
      // A completion with no recorded date is still a completion, and the
      // points are owed; only the date is unknown, so it falls back to now.
      occurredAt: completion.completedAt ?? undefined,
    });

    if (award.awarded) {
      summary.lessonsAwarded++;
      summary.pointsAwarded += award.amount;
    }
  }

  for (const attempt of passingAttempts()) {
    const award = awardPoints({
      userId: attempt.userId,
      amount: pointsForQuizPass(),
      reason: PointsReason.QuizPassed,
      sourceType: PointsSourceType.Quiz,
      sourceId: attempt.quizId,
      occurredAt: attempt.attemptedAt,
    });

    if (award.awarded) {
      summary.quizzesAwarded++;
      summary.pointsAwarded += award.amount;
    }
  }

  for (const enrolment of completedEnrolments()) {
    const award = awardPoints({
      userId: enrolment.userId,
      amount: pointsForCourseCompletion(),
      reason: PointsReason.CourseCompleted,
      sourceType: PointsSourceType.Course,
      sourceId: enrolment.courseId,
      occurredAt: enrolment.completedAt,
    });

    if (award.awarded) {
      summary.coursesAwarded++;
      summary.pointsAwarded += award.amount;
    }
  }

  return summary;
}

/** Every lesson every student has finished. Starting one earns nothing. */
function completedLessons() {
  return db
    .select({
      userId: lessonProgress.userId,
      lessonId: lessonProgress.lessonId,
      completedAt: lessonProgress.completedAt,
    })
    .from(lessonProgress)
    .where(eq(lessonProgress.status, LessonProgressStatus.Completed))
    .all();
}

/**
 * Every historic attempt that passes under the *corrected* rule, oldest first.
 *
 * The verdict stored on the attempt is not consulted: it was written by the old
 * comparison, which recorded a score exactly at the passing mark as a failure
 * and ignored the quiz's configured threshold entirely. Re-judging the score
 * against the quiz's own passing score is what makes the backfilled points
 * right rather than merely consistent with what was wrong.
 *
 * Oldest first so that when a student passed a quiz more than once, the entry
 * the ledger keeps is dated by the attempt that first passed — the later ones
 * collide with it and change nothing.
 */
function passingAttempts() {
  return db
    .select({
      userId: quizAttempts.userId,
      quizId: quizAttempts.quizId,
      score: quizAttempts.score,
      passingScore: quizzes.passingScore,
      attemptedAt: quizAttempts.attemptedAt,
    })
    .from(quizAttempts)
    .innerJoin(quizzes, eq(quizAttempts.quizId, quizzes.id))
    .orderBy(asc(quizAttempts.attemptedAt), asc(quizAttempts.id))
    .all()
    .filter((attempt) => isPassingScore(attempt.score, attempt.passingScore));
}

/**
 * Every enrolment marked finished, with the date it was finished on.
 *
 * The enrolment's own record of completion is what counts here, rather than
 * re-deriving "every lesson is done" from the progress rows: the column is what
 * the product already treats as a finished course, and a course whose lessons
 * were all completed but which was never marked finished is paid by the live
 * path the next time one of its lessons is completed.
 */
function completedEnrolments() {
  return db
    .select({
      userId: enrollments.userId,
      courseId: enrollments.courseId,
      completedAt: enrollments.completedAt,
    })
    .from(enrollments)
    .where(isNotNull(enrollments.completedAt))
    .all()
    .map((enrolment) => ({
      ...enrolment,
      completedAt: enrolment.completedAt as string,
    }));
}
