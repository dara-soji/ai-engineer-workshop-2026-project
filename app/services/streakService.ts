import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "~/db";
import { lessonProgress, LessonProgressStatus } from "~/db/schema";

// ─── Streak Service ───
// A streak is derived from the dates a student completed lessons on. There is
// no streak table, no counter and no nightly job: the absence of a completion
// row *is* the break in the streak, so nothing can drift from reality and
// nothing has to run to break one.
//
// A day is a UTC calendar day. No timezone is stored anywhere in the system, so
// students far from UTC see the day boundary fall at an odd local hour — a
// known, accepted imperfection. Every piece of day arithmetic in the product
// lives in this module, so the day the decision is revisited, this is the only
// file that changes.
//
// Only the gamification service talks to this module. Routes never do.

export type StreakSummary = {
  /** Consecutive UTC days of completions ending today or yesterday; 0 if broken. */
  currentStreak: number;
  /** The longest run of consecutive days the student has ever put together. */
  longestStreak: number;
  /** The most recent UTC date they completed a lesson (YYYY-MM-DD), or null. */
  lastActiveDate: string | null;
};

/**
 * The student's streak, derived from their lesson completion dates.
 *
 * Several lessons completed on one date count as a single day, so the streak
 * measures consistency rather than volume. A student with no completions has a
 * zero streak — that is an answer, not a failure.
 *
 * The current streak counts back from today, and stays alive while the most
 * recent day is today *or* yesterday: a day is only missed once it is over.
 * The longest streak is the longest run anywhere in their history, so a break
 * never erases the evidence of a long run.
 */
export function getStreak(userId: number): StreakSummary {
  const days = completedDayNumbers(userId);

  if (days.length === 0) {
    return { currentStreak: 0, longestStreak: 0, lastActiveDate: null };
  }

  return {
    currentStreak: countBackFromToday(days),
    longestStreak: longestRun(days),
    lastActiveDate: toIsoDate(days[days.length - 1]),
  };
}

/**
 * The distinct UTC days the student completed a lesson on, as whole days since
 * the epoch, ascending. Day numbers rather than dates because a streak is a
 * question about adjacency, and adjacent days are adjacent integers — no
 * month lengths, no leap years.
 */
function completedDayNumbers(userId: number): number[] {
  const completions = db
    .select({ completedAt: lessonProgress.completedAt })
    .from(lessonProgress)
    .where(
      and(
        eq(lessonProgress.userId, userId),
        eq(lessonProgress.status, LessonProgressStatus.Completed),
        isNotNull(lessonProgress.completedAt)
      )
    )
    .all();

  const days = new Set<number>();

  for (const { completedAt } of completions) {
    const day = toDayNumber(completedAt);
    if (day !== null) days.add(day);
  }

  return [...days].sort((a, b) => a - b);
}

/**
 * How many consecutive days end the student's history, counting back from
 * today. Zero when the most recent day is older than yesterday.
 */
function countBackFromToday(ascendingDays: number[]): number {
  const present = new Set(ascendingDays);
  const today = toDayNumber(new Date().toISOString())!;

  // Today has not been missed until it is over, so a streak that ran up to
  // yesterday is still standing.
  let day = present.has(today) ? today : today - 1;
  if (!present.has(day)) return 0;

  let streak = 0;
  while (present.has(day)) {
    streak++;
    day--;
  }

  return streak;
}

/** The longest run of consecutive days anywhere in the student's history. */
function longestRun(ascendingDays: number[]): number {
  let longest = 1;
  let run = 1;

  for (let i = 1; i < ascendingDays.length; i++) {
    run = ascendingDays[i] === ascendingDays[i - 1] + 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  }

  return longest;
}

/** Whole UTC days since the epoch, or null for a timestamp we cannot read. */
function toDayNumber(timestamp: string | null): number | null {
  if (!timestamp) return null;

  const at = new Date(timestamp);
  if (Number.isNaN(at.getTime())) return null;

  return Math.floor(at.getTime() / 86_400_000);
}

/** A day number back to the YYYY-MM-DD it names. */
function toIsoDate(dayNumber: number): string {
  return new Date(dayNumber * 86_400_000).toISOString().slice(0, 10);
}
