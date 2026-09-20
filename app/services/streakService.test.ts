import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

// Import after mock so the module picks up our test db
import { getStreak } from "./streakService";

// A fixed "today" so the streak, which is always measured against the current
// UTC day, is deterministic. Only Date is faked — the SQLite driver still runs
// on real timers.
const TODAY = "2026-03-15";

/** An ISO timestamp `n` UTC days before the pinned today, at the given hour. */
function daysAgo(n: number, hour = 12): string {
  const day = Date.UTC(2026, 2, 15) - n * 86_400_000;
  return new Date(day + hour * 3_600_000).toISOString();
}

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

/**
 * Records completions on the given days before today — one lesson per
 * completion, so the only thing varying between tests is the dates.
 */
function completeLessonsOn(userId: number, ...daysAgoList: number[]) {
  const lessons = createLessons(daysAgoList.length);

  daysAgoList.forEach((n, i) => {
    testDb
      .insert(schema.lessonProgress)
      .values({
        userId,
        lessonId: lessons[i].id,
        status: schema.LessonProgressStatus.Completed,
        completedAt: daysAgo(n),
      })
      .run();
  });

  return lessons;
}

describe("streakService", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${TODAY}T12:00:00.000Z`));
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("a student with no completions", () => {
    it("reports a zero streak rather than failing", () => {
      const streak = getStreak(base.user.id);

      expect(streak.currentStreak).toBe(0);
      expect(streak.longestStreak).toBe(0);
      expect(streak.lastActiveDate).toBeNull();
    });

    it("reports zero when the student has only started a lesson", () => {
      const lessons = createLessons(1);
      testDb
        .insert(schema.lessonProgress)
        .values({
          userId: base.user.id,
          lessonId: lessons[0].id,
          status: schema.LessonProgressStatus.InProgress,
        })
        .run();

      const streak = getStreak(base.user.id);

      expect(streak.currentStreak).toBe(0);
      expect(streak.lastActiveDate).toBeNull();
    });
  });

  describe("consecutive days", () => {
    it("counts a single completion today as a one-day streak", () => {
      completeLessonsOn(base.user.id, 0);

      expect(getStreak(base.user.id).currentStreak).toBe(1);
    });

    it("counts consecutive days up to today", () => {
      completeLessonsOn(base.user.id, 0, 1, 2, 3);

      expect(getStreak(base.user.id).currentStreak).toBe(4);
    });

    it("counts the run regardless of the order rows were written in", () => {
      completeLessonsOn(base.user.id, 2, 0, 3, 1);

      expect(getStreak(base.user.id).currentStreak).toBe(4);
    });

    it("keeps the streak alive when the most recent day is yesterday", () => {
      completeLessonsOn(base.user.id, 1, 2, 3);

      expect(getStreak(base.user.id).currentStreak).toBe(3);
    });

    it("counts a run that crosses a month boundary", () => {
      // 2026-03-01 back through 2026-02-26.
      completeLessonsOn(base.user.id, 14, 15, 16, 17, 18);

      expect(getStreak(base.user.id).currentStreak).toBe(0);
      expect(getStreak(base.user.id).longestStreak).toBe(5);
    });
  });

  describe("same-day completions", () => {
    it("counts several lessons completed on one date as a single day", () => {
      completeLessonsOn(base.user.id, 0, 0, 0);

      expect(getStreak(base.user.id).currentStreak).toBe(1);
      expect(getStreak(base.user.id).longestStreak).toBe(1);
    });

    it("counts completions at either end of the same UTC day once", () => {
      const lessons = createLessons(2);
      testDb
        .insert(schema.lessonProgress)
        .values({
          userId: base.user.id,
          lessonId: lessons[0].id,
          status: schema.LessonProgressStatus.Completed,
          completedAt: `${TODAY}T00:00:00.000Z`,
        })
        .run();
      testDb
        .insert(schema.lessonProgress)
        .values({
          userId: base.user.id,
          lessonId: lessons[1].id,
          status: schema.LessonProgressStatus.Completed,
          completedAt: `${TODAY}T23:59:59.999Z`,
        })
        .run();

      expect(getStreak(base.user.id).currentStreak).toBe(1);
    });

    it("does not inflate a run when a day inside it has several completions", () => {
      completeLessonsOn(base.user.id, 0, 1, 1, 1, 2);

      expect(getStreak(base.user.id).currentStreak).toBe(3);
    });
  });

  describe("a missed day", () => {
    it("breaks the chain before the gap", () => {
      // Today and yesterday, then a missing day, then three more.
      completeLessonsOn(base.user.id, 0, 1, 3, 4, 5);

      expect(getStreak(base.user.id).currentStreak).toBe(2);
    });

    it("resets the current streak when the last completion is two days ago", () => {
      completeLessonsOn(base.user.id, 2, 3, 4);

      expect(getStreak(base.user.id).currentStreak).toBe(0);
    });

    it("leaves the last active date intact when the streak has reset", () => {
      completeLessonsOn(base.user.id, 2);

      expect(getStreak(base.user.id).lastActiveDate).toBe("2026-03-13");
    });
  });

  describe("longest streak", () => {
    it("survives a later break", () => {
      // A five-day run, a gap, then two days up to today.
      completeLessonsOn(base.user.id, 0, 1, 5, 6, 7, 8, 9);

      const streak = getStreak(base.user.id);

      expect(streak.currentStreak).toBe(2);
      expect(streak.longestStreak).toBe(5);
    });

    it("is the current streak when the current run is the longest", () => {
      completeLessonsOn(base.user.id, 0, 1, 2, 5, 6);

      const streak = getStreak(base.user.id);

      expect(streak.currentStreak).toBe(3);
      expect(streak.longestStreak).toBe(3);
    });

    it("is one for a student who has been active on exactly one day", () => {
      completeLessonsOn(base.user.id, 40);

      expect(getStreak(base.user.id).longestStreak).toBe(1);
    });

    it("takes the longest of several past runs", () => {
      completeLessonsOn(base.user.id, 1, 2, 10, 11, 12, 13, 20, 21);

      expect(getStreak(base.user.id).longestStreak).toBe(4);
    });
  });

  describe("lastActiveDate", () => {
    it("is the most recent UTC date the student completed a lesson", () => {
      completeLessonsOn(base.user.id, 0, 1, 2);

      expect(getStreak(base.user.id).lastActiveDate).toBe(TODAY);
    });

    it("is the date in UTC, not the local date", () => {
      const lessons = createLessons(1);
      // Late on 2026-03-14 UTC — the day before the pinned today.
      testDb
        .insert(schema.lessonProgress)
        .values({
          userId: base.user.id,
          lessonId: lessons[0].id,
          status: schema.LessonProgressStatus.Completed,
          completedAt: "2026-03-14T23:30:00.000Z",
        })
        .run();

      expect(getStreak(base.user.id).lastActiveDate).toBe("2026-03-14");
    });
  });

  describe("other students", () => {
    it("counts only the given student's completions", () => {
      const other = testDb
        .insert(schema.users)
        .values({
          name: "Other Student",
          email: "other@example.com",
          role: schema.UserRole.Student,
        })
        .returning()
        .get();

      completeLessonsOn(base.user.id, 0);
      completeLessonsOn(other.id, 0, 1, 2);

      expect(getStreak(base.user.id).currentStreak).toBe(1);
      expect(getStreak(other.id).currentStreak).toBe(3);
    });
  });
});
