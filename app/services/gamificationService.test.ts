import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { POINTS_PER_LESSON_COMPLETION } from "~/lib/pointsRules";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

// Import after mock so the modules pick up our test db
import { recordLessonCompletion, getPointsTotal } from "./gamificationService";
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
});
