import { eq, sql } from "drizzle-orm";
import { db } from "~/db";
import { pointsEvents, PointsReason, PointsSourceType } from "~/db/schema";

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
