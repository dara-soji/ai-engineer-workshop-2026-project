import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "~/db";
import {
  lessons,
  modules,
  pointsEvents,
  PointsReason,
  PointsSourceType,
  quizzes,
} from "~/db/schema";

// ─── Points Ledger Service ───
// Owns the points_events table: the append-only record of every point a
// student has earned. Rows are never updated or deleted, so a student's total
// can only ever go up.
//
// Only the gamification service talks to this module. Routes never do.

export type PointsAward = {
  userId: number;
  amount: number;
  reason: PointsReason;
  sourceType: PointsSourceType;
  sourceId: number;
  /**
   * When the thing that earned the points happened. Defaults to now, which is
   * what a live award wants. The backfill passes the original completion
   * timestamp instead, so history converted at launch reads as the day the
   * student did the work rather than the day the backfill ran.
   */
  occurredAt?: string;
};

export type PointsAwardResult = {
  /** False when this exact event had already been awarded. */
  awarded: boolean;
  /** Points actually added to the student's total — 0 for a repeat. */
  amount: number;
};

/**
 * Records a points award for a student.
 *
 * Idempotent: an event with the same user, reason, source type and source id
 * has already been earned, so awarding it again is a silent no-op that leaves
 * one row and one total. Callers never have to handle "already awarded" as an
 * exceptional case — they read `awarded` if they care, and ignore it if not.
 *
 * A repeat keeps everything the first award recorded, including its moment: the
 * points were earned when they were earned, whatever a later caller believes.
 */
export function awardPoints(award: PointsAward): PointsAwardResult {
  const inserted = db
    .insert(pointsEvents)
    .values({
      userId: award.userId,
      amount: award.amount,
      reason: award.reason,
      sourceType: award.sourceType,
      sourceId: award.sourceId,
      // Left out entirely when the caller gave none, so the column's default —
      // now — applies rather than a null.
      ...(award.occurredAt ? { createdAt: award.occurredAt } : {}),
    })
    .onConflictDoNothing()
    .returning()
    .get();

  if (!inserted) {
    return { awarded: false, amount: 0 };
  }

  return { awarded: true, amount: inserted.amount };
}

/** Every point the student has ever earned, summed. Zero if they have none. */
export function getPointsTotal(userId: number): number {
  const result = db
    .select({ total: sql<number>`coalesce(sum(${pointsEvents.amount}), 0)` })
    .from(pointsEvents)
    .where(eq(pointsEvents.userId, userId))
    .get();

  return result?.total ?? 0;
}

/** One thing the student earned, and when. */
export type PointsHistoryEntry = {
  /** The points it was worth when it was awarded. */
  amount: number;
  /** What the student did to earn it. */
  reason: PointsReason;
  /** The kind of thing it is attributed to. */
  sourceType: PointsSourceType;
  /** Which one — the lesson, quiz, course, or streak day count. */
  sourceId: number;
  /** When the thing that earned the points happened. */
  occurredAt: string;
};

/**
 * Everything the student has earned, most recent first. Empty for a student who
 * has earned nothing.
 *
 * This is what makes a total explicable: every point in it names what caused it
 * and when. Backfilled entries are dated by the original completion, so a
 * history converted at launch reads in the order the student lived it.
 */
export function getPointsHistory(userId: number): PointsHistoryEntry[] {
  return db
    .select({
      amount: pointsEvents.amount,
      reason: pointsEvents.reason,
      sourceType: pointsEvents.sourceType,
      sourceId: pointsEvents.sourceId,
      occurredAt: pointsEvents.createdAt,
    })
    .from(pointsEvents)
    .where(eq(pointsEvents.userId, userId))
    .orderBy(desc(pointsEvents.createdAt), desc(pointsEvents.id))
    .all();
}

/**
 * The points the student earned *within* a course: its lessons, the quizzes on
 * those lessons, and the bonus for finishing the course itself. Zero for a
 * course they have earned nothing in, and for a course that does not exist.
 *
 * Attribution is a read over the events already recorded — every award names
 * what caused it, so nothing has to be stored per course. Each source type is
 * matched against its own table, because lesson ids and quiz ids are counted
 * separately and the same number can be both.
 *
 * Streak milestones are deliberately left out. A streak is built from days of
 * effort across whatever the student was studying, so it belongs to no one
 * course; the per-course totals therefore need not add up to the global one.
 */
export function getCoursePointsTotal(
  userId: number,
  courseId: number
): number {
  const courseLessonIds = db
    .select({ id: lessons.id })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(eq(modules.courseId, courseId));

  const courseQuizIds = db
    .select({ id: quizzes.id })
    .from(quizzes)
    .innerJoin(lessons, eq(quizzes.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(eq(modules.courseId, courseId));

  const result = db
    .select({ total: sql<number>`coalesce(sum(${pointsEvents.amount}), 0)` })
    .from(pointsEvents)
    .where(
      and(
        eq(pointsEvents.userId, userId),
        or(
          and(
            eq(pointsEvents.sourceType, PointsSourceType.Lesson),
            inArray(pointsEvents.sourceId, courseLessonIds)
          ),
          and(
            eq(pointsEvents.sourceType, PointsSourceType.Quiz),
            inArray(pointsEvents.sourceId, courseQuizIds)
          ),
          and(
            eq(pointsEvents.sourceType, PointsSourceType.Course),
            eq(pointsEvents.sourceId, courseId)
          )
        )
      )
    )
    .get();

  return result?.total ?? 0;
}
