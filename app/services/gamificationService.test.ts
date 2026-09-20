import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import {
  POINTS_PER_LESSON_COMPLETION,
  STREAK_MILESTONES,
} from "~/lib/pointsRules";
import { LEVEL_THRESHOLDS, getLevelProgress } from "~/lib/levels";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

// Import after mock so the modules pick up our test db
import {
  recordLessonCompletion,
  getPointsTotal,
  getPointsSummary,
  getStreak,
} from "./gamificationService";
import { markLessonComplete, resetLessonProgress } from "./progressService";

// Helper to create a module with lessons in the test db
function createLessons(count: number) {
  const mod = testDb
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Module 1", position: 1 })
    .returning()
    .get();

  return Array.from({ length: count }, (_, i) =>
    testDb
      .insert(schema.lessons)
      .values({ moduleId: mod.id, title: `Lesson ${i + 1}`, position: i + 1 })
      .returning()
      .get()
  );
}

describe("gamificationService", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  describe("getPointsTotal", () => {
    it("is zero for a student who has completed nothing", () => {
      expect(getPointsTotal(base.user.id)).toBe(0);
    });
  });

  describe("getPointsSummary", () => {
    it("puts a student who has earned nothing on the starting level", () => {
      const summary = getPointsSummary(base.user.id);

      expect(summary.totalPoints).toBe(0);
      expect(summary.level.level).toBe(1);
    });

    it("tells a new student how far the next level is", () => {
      const summary = getPointsSummary(base.user.id);

      expect(summary.level.pointsToNextLevel).toBe(LEVEL_THRESHOLDS[1]);
    });

    it("derives the level from the points the student has earned", () => {
      const lessons = createLessons(1);
      recordLessonCompletion(base.user.id, lessons[0].id);

      const summary = getPointsSummary(base.user.id);

      expect(summary.totalPoints).toBe(POINTS_PER_LESSON_COMPLETION);
      expect(summary.level).toEqual(
        getLevelProgress(POINTS_PER_LESSON_COMPLETION)
      );
    });

    it("moves the student up a level once they cross the threshold", () => {
      const lessonsToLevelTwo = Math.ceil(
        LEVEL_THRESHOLDS[1] / POINTS_PER_LESSON_COMPLETION
      );
      const lessons = createLessons(lessonsToLevelTwo);

      lessons
        .slice(0, lessonsToLevelTwo - 1)
        .forEach((lesson) => recordLessonCompletion(base.user.id, lesson.id));
      expect(getPointsSummary(base.user.id).level.level).toBe(1);

      recordLessonCompletion(base.user.id, lessons[lessonsToLevelTwo - 1].id);

      expect(getPointsSummary(base.user.id).level.level).toBe(2);
      expect(getPointsSummary(base.user.id).level.pointsIntoLevel).toBeLessThan(
        POINTS_PER_LESSON_COMPLETION
      );
    });

    it("reports each student's own level", () => {
      const lessons = createLessons(1);
      const other = testDb
        .insert(schema.users)
        .values({
          name: "Other Student",
          email: "other@example.com",
          role: schema.UserRole.Student,
        })
        .returning()
        .get();

      recordLessonCompletion(base.user.id, lessons[0].id);

      expect(getPointsSummary(other.id).totalPoints).toBe(0);
      expect(getPointsSummary(other.id).level.pointsIntoLevel).toBe(0);
    });
  });

  describe("recordLessonCompletion", () => {
    it("awards the lesson's points and reports them back", () => {
      const [lesson] = createLessons(1);

      const summary = recordLessonCompletion(base.user.id, lesson.id);

      expect(summary.pointsAwarded).toBe(POINTS_PER_LESSON_COMPLETION);
      expect(summary.totalPoints).toBe(POINTS_PER_LESSON_COMPLETION);
    });

    it("raises the student's total points", () => {
      const [lesson] = createLessons(1);

      recordLessonCompletion(base.user.id, lesson.id);

      expect(getPointsTotal(base.user.id)).toBe(POINTS_PER_LESSON_COMPLETION);
    });

    it("accumulates across different lessons", () => {
      const [first, second] = createLessons(2);

      recordLessonCompletion(base.user.id, first.id);
      const summary = recordLessonCompletion(base.user.id, second.id);

      expect(summary.pointsAwarded).toBe(POINTS_PER_LESSON_COMPLETION);
      expect(summary.totalPoints).toBe(POINTS_PER_LESSON_COMPLETION * 2);
    });

    it("awards nothing the second time the same lesson is completed", () => {
      const [lesson] = createLessons(1);

      recordLessonCompletion(base.user.id, lesson.id);
      const summary = recordLessonCompletion(base.user.id, lesson.id);

      expect(summary.pointsAwarded).toBe(0);
      expect(summary.totalPoints).toBe(POINTS_PER_LESSON_COMPLETION);
    });

    it("still reports the running total when nothing new was earned", () => {
      const [first, second] = createLessons(2);

      recordLessonCompletion(base.user.id, first.id);
      recordLessonCompletion(base.user.id, second.id);
      const summary = recordLessonCompletion(base.user.id, first.id);

      expect(summary.pointsAwarded).toBe(0);
      expect(summary.totalPoints).toBe(POINTS_PER_LESSON_COMPLETION * 2);
    });

    it("keeps each student's points to themselves", () => {
      const [lesson] = createLessons(1);
      const other = testDb
        .insert(schema.users)
        .values({
          name: "Other Student",
          email: "other@example.com",
          role: schema.UserRole.Student,
        })
        .returning()
        .get();

      recordLessonCompletion(base.user.id, lesson.id);

      expect(getPointsTotal(other.id)).toBe(0);
    });

    it("does not lose points when progress on the lesson is reset", () => {
      const [lesson] = createLessons(1);

      markLessonComplete(base.user.id, lesson.id);
      recordLessonCompletion(base.user.id, lesson.id);
      resetLessonProgress(base.user.id, lesson.id);

      expect(getPointsTotal(base.user.id)).toBe(POINTS_PER_LESSON_COMPLETION);
    });

    it("does not re-award after progress is reset and the lesson completed again", () => {
      const [lesson] = createLessons(1);

      markLessonComplete(base.user.id, lesson.id);
      recordLessonCompletion(base.user.id, lesson.id);
      resetLessonProgress(base.user.id, lesson.id);
      markLessonComplete(base.user.id, lesson.id);
      const summary = recordLessonCompletion(base.user.id, lesson.id);

      expect(summary.pointsAwarded).toBe(0);
      expect(getPointsTotal(base.user.id)).toBe(POINTS_PER_LESSON_COMPLETION);
    });
  });

  describe("recordLessonCompletion — level crossings", () => {
    // Lessons needed to land on (or just past) the level two threshold.
    const lessonsToLevelTwo = Math.ceil(
      LEVEL_THRESHOLDS[1] / POINTS_PER_LESSON_COMPLETION
    );

    it("reports the level the completion leaves the student on", () => {
      const [lesson] = createLessons(1);

      const summary = recordLessonCompletion(base.user.id, lesson.id);

      expect(summary.level).toEqual(
        getLevelProgress(POINTS_PER_LESSON_COMPLETION)
      );
    });

    it("reports no level-up for a completion that stays inside the level", () => {
      const [lesson] = createLessons(1);

      const summary = recordLessonCompletion(base.user.id, lesson.id);

      expect(summary.leveledUp).toBe(false);
      expect(summary.level.level).toBe(1);
    });

    it("reports a level-up on the completion that crosses the threshold", () => {
      const lessons = createLessons(lessonsToLevelTwo);

      const summaries = lessons.map((lesson) =>
        recordLessonCompletion(base.user.id, lesson.id)
      );

      const crossing = summaries[lessonsToLevelTwo - 1];
      expect(crossing.leveledUp).toBe(true);
      expect(crossing.level.level).toBe(2);
      expect(summaries.slice(0, -1).map((s) => s.leveledUp)).not.toContain(true);
    });

    it("reports no level-up on the completion after the crossing", () => {
      const lessons = createLessons(lessonsToLevelTwo + 1);

      lessons
        .slice(0, lessonsToLevelTwo)
        .forEach((lesson) => recordLessonCompletion(base.user.id, lesson.id));
      const summary = recordLessonCompletion(
        base.user.id,
        lessons[lessonsToLevelTwo].id
      );

      expect(summary.leveledUp).toBe(false);
      expect(summary.level.level).toBe(2);
    });

    it("reports no level-up when the crossing completion is repeated", () => {
      const lessons = createLessons(lessonsToLevelTwo);

      lessons.forEach((lesson) =>
        recordLessonCompletion(base.user.id, lesson.id)
      );
      const summary = recordLessonCompletion(
        base.user.id,
        lessons[lessonsToLevelTwo - 1].id
      );

      expect(summary.pointsAwarded).toBe(0);
      expect(summary.leveledUp).toBe(false);
      expect(summary.level.level).toBe(2);
    });

    it("reports the student's current level when nothing was earned", () => {
      const [lesson] = createLessons(1);

      recordLessonCompletion(base.user.id, lesson.id);
      const summary = recordLessonCompletion(base.user.id, lesson.id);

      expect(summary.level).toEqual(
        getLevelProgress(POINTS_PER_LESSON_COMPLETION)
      );
    });

    it("reports the level and total that the dashboard would show", () => {
      const lessons = createLessons(lessonsToLevelTwo);

      const summary = lessons
        .map((lesson) => recordLessonCompletion(base.user.id, lesson.id))
        .at(-1)!;

      const dashboard = getPointsSummary(base.user.id);
      expect(summary.totalPoints).toBe(dashboard.totalPoints);
      expect(summary.level).toEqual(dashboard.level);
    });

    it("keeps one student's level crossing out of another's summary", () => {
      const lessons = createLessons(lessonsToLevelTwo);
      const other = testDb
        .insert(schema.users)
        .values({
          name: "Other Student",
          email: "other@example.com",
          role: schema.UserRole.Student,
        })
        .returning()
        .get();

      lessons
        .slice(0, lessonsToLevelTwo - 1)
        .forEach((lesson) => recordLessonCompletion(base.user.id, lesson.id));
      const summary = recordLessonCompletion(other.id, lessons[0].id);

      expect(summary.leveledUp).toBe(false);
      expect(summary.level.level).toBe(1);
      expect(summary.totalPoints).toBe(POINTS_PER_LESSON_COMPLETION);
    });
  });

  describe("getStreak", () => {
    it("is zero for a student who has completed nothing", () => {
      const streak = getStreak(base.user.id);

      expect(streak.currentStreak).toBe(0);
      expect(streak.longestStreak).toBe(0);
      expect(streak.lastActiveDate).toBeNull();
    });

    it("counts a lesson completed today", () => {
      const lessons = createLessons(1);
      markLessonComplete(base.user.id, lessons[0].id);

      expect(getStreak(base.user.id).currentStreak).toBe(1);
    });

    it("counts several lessons completed today as one day", () => {
      const lessons = createLessons(3);
      lessons.forEach((lesson) => markLessonComplete(base.user.id, lesson.id));

      const streak = getStreak(base.user.id);

      expect(streak.currentStreak).toBe(1);
      expect(streak.longestStreak).toBe(1);
    });
  });

  describe("recordLessonCompletion — streak milestones", () => {
    // The day a streak first earns a bonus, and what it pays.
    const FIRST = STREAK_MILESTONES[0];
    const SECOND = STREAK_MILESTONES[1];

    // A fixed calendar so "one day later" means something. Only Date is faked,
    // so the SQLite driver still runs on real timers.
    const DAY_ZERO = Date.UTC(2026, 2, 15);

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(DAY_ZERO));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    /**
     * Completes a lesson on the given day, the way the lesson route does it:
     * progress first, then the gamification call.
     */
    function completeOnDay(dayOffset: number, lessonId: number) {
      vi.setSystemTime(new Date(DAY_ZERO + dayOffset * 86_400_000));
      markLessonComplete(base.user.id, lessonId);
      return recordLessonCompletion(base.user.id, lessonId);
    }

    /** One lesson completed on each of the given days, in order. */
    function completeOnDays(...dayOffsets: number[]) {
      const lessons = createLessons(dayOffsets.length);

      return dayOffsets.map((day, i) => completeOnDay(day, lessons[i].id));
    }

    it("awards the bonus on the day the streak reaches a milestone", () => {
      const summaries = completeOnDays(
        ...Array.from({ length: FIRST.days }, (_, i) => i)
      );

      expect(summaries.at(-1)!.streakMilestone).toEqual(FIRST);
    });

    it("counts the bonus in the points that completion earned", () => {
      const summaries = completeOnDays(
        ...Array.from({ length: FIRST.days }, (_, i) => i)
      );

      expect(summaries.at(-1)!.pointsAwarded).toBe(
        POINTS_PER_LESSON_COMPLETION + FIRST.points
      );
    });

    it("adds the bonus to the student's total", () => {
      completeOnDays(...Array.from({ length: FIRST.days }, (_, i) => i));

      expect(getPointsTotal(base.user.id)).toBe(
        POINTS_PER_LESSON_COMPLETION * FIRST.days + FIRST.points
      );
    });

    it("awards nothing extra on the days before the milestone", () => {
      const summaries = completeOnDays(
        ...Array.from({ length: FIRST.days - 1 }, (_, i) => i)
      );

      expect(summaries.map((s) => s.streakMilestone)).toEqual(
        summaries.map(() => null)
      );
      expect(getPointsTotal(base.user.id)).toBe(
        POINTS_PER_LESSON_COMPLETION * (FIRST.days - 1)
      );
    });

    it("does not award the same milestone again the next day", () => {
      const summaries = completeOnDays(
        ...Array.from({ length: FIRST.days + 1 }, (_, i) => i)
      );

      expect(summaries.at(-1)!.streakMilestone).toBeNull();
      expect(summaries.at(-1)!.pointsAwarded).toBe(
        POINTS_PER_LESSON_COMPLETION
      );
    });

    it("does not award it again on any later day of the same run", () => {
      const summaries = completeOnDays(
        ...Array.from({ length: SECOND.days - 1 }, (_, i) => i)
      );

      const paid = summaries.filter((s) => s.streakMilestone !== null);
      expect(paid).toHaveLength(1);
      expect(getPointsTotal(base.user.id)).toBe(
        POINTS_PER_LESSON_COMPLETION * (SECOND.days - 1) + FIRST.points
      );
    });

    it("does not award it again after the streak breaks and is rebuilt", () => {
      const rebuilt = completeOnDays(
        // A run to the first milestone, a missed day, then the same run again.
        ...Array.from({ length: FIRST.days }, (_, i) => i),
        ...Array.from({ length: FIRST.days }, (_, i) => FIRST.days + 1 + i)
      ).at(-1)!;

      expect(getStreak(base.user.id).currentStreak).toBe(FIRST.days);
      expect(rebuilt.streakMilestone).toBeNull();
      expect(rebuilt.pointsAwarded).toBe(POINTS_PER_LESSON_COMPLETION);
    });

    it("awards each milestone as the run reaches it", () => {
      const summaries = completeOnDays(
        ...Array.from({ length: SECOND.days }, (_, i) => i)
      );

      expect(summaries[FIRST.days - 1].streakMilestone).toEqual(FIRST);
      expect(summaries[SECOND.days - 1].streakMilestone).toEqual(SECOND);
      expect(getPointsTotal(base.user.id)).toBe(
        POINTS_PER_LESSON_COMPLETION * SECOND.days +
          FIRST.points +
          SECOND.points
      );
    });

    it("pays the bonus even when the day's lesson was already counted", () => {
      const [first, spare, second] = createLessons(3);

      completeOnDay(0, first.id);
      // A second lesson on day zero, so the day survives `first` being
      // re-completed later and having its completion date moved forward.
      completeOnDay(0, spare.id);
      completeOnDay(1, second.id);
      // The milestone day is spent re-reading a lesson already paid for: the
      // student still showed up, so the run still counts.
      const summary = completeOnDay(2, first.id);

      expect(getStreak(base.user.id).currentStreak).toBe(FIRST.days);
      expect(summary.streakMilestone).toEqual(FIRST);
      expect(summary.pointsAwarded).toBe(FIRST.points);
    });

    it("does not award a milestone for a run that predates the feature", () => {
      // Five consecutive days of history ending yesterday, none of which the
      // ledger ever saw — the state an existing student is in at launch.
      const historic = createLessons(5);
      historic.forEach((lesson, i) => {
        testDb
          .insert(schema.lessonProgress)
          .values({
            userId: base.user.id,
            lessonId: lesson.id,
            status: schema.LessonProgressStatus.Completed,
            completedAt: new Date(DAY_ZERO - (i + 1) * 86_400_000).toISOString(),
          })
          .run();
      });

      const [today] = completeOnDays(0);

      expect(getStreak(base.user.id).currentStreak).toBe(6);
      expect(today.streakMilestone).toBeNull();
      expect(getPointsTotal(base.user.id)).toBe(POINTS_PER_LESSON_COMPLETION);
    });

    it("pays a milestone the student reaches today, not one already passed", () => {
      // The other side of the same rule: the run is live and ends today, so
      // arriving at the milestone today is paid — only runs already past the
      // milestone go unrewarded.
      const historic = createLessons(FIRST.days - 1);
      historic.forEach((lesson, i) => {
        testDb
          .insert(schema.lessonProgress)
          .values({
            userId: base.user.id,
            lessonId: lesson.id,
            status: schema.LessonProgressStatus.Completed,
            completedAt: new Date(DAY_ZERO - (i + 1) * 86_400_000).toISOString(),
          })
          .run();
      });

      const [today] = completeOnDays(0);

      expect(today.streakMilestone).toEqual(FIRST);
    });

    it("keeps one student's milestone out of another's", () => {
      const other = testDb
        .insert(schema.users)
        .values({
          name: "Other Student",
          email: "other@example.com",
          role: schema.UserRole.Student,
        })
        .returning()
        .get();
      const lessons = createLessons(FIRST.days);

      lessons.forEach((lesson, i) => completeOnDay(i, lesson.id));
      markLessonComplete(other.id, lessons[0].id);
      const summary = recordLessonCompletion(other.id, lessons[0].id);

      expect(summary.streakMilestone).toBeNull();
      expect(getPointsTotal(other.id)).toBe(POINTS_PER_LESSON_COMPLETION);
    });

    it("counts the bonus towards the level it reports", () => {
      const summary = completeOnDays(
        ...Array.from({ length: FIRST.days }, (_, i) => i)
      ).at(-1)!;

      const dashboard = getPointsSummary(base.user.id);
      expect(summary.totalPoints).toBe(dashboard.totalPoints);
      expect(summary.level).toEqual(dashboard.level);
    });

    it("reports no milestone for a completion that keeps no streak", () => {
      const [lesson] = createLessons(1);

      const summary = recordLessonCompletion(base.user.id, lesson.id);

      expect(summary.streakMilestone).toBeNull();
    });
  });
});
