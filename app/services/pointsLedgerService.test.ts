import { describe, it, expect, beforeEach, vi } from "vitest";
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
import {
  awardPoints,
  getCoursePointsTotal,
  getPointsHistory,
  getPointsTotal,
} from "./pointsLedgerService";

function createSecondUser() {
  return testDb
    .insert(schema.users)
    .values({
      name: "Other Student",
      email: "other@example.com",
      role: schema.UserRole.Student,
    })
    .returning()
    .get();
}

/** A second course, so a student's effort can be split across two. */
function createCourse(slug: string) {
  return testDb
    .insert(schema.courses)
    .values({
      title: `Course ${slug}`,
      slug,
      description: "Another test course",
      instructorId: base.instructor.id,
      categoryId: base.category.id,
      status: schema.CourseStatus.Published,
    })
    .returning()
    .get();
}

/** A lesson in the given course, in a module of its own. */
function createLesson(courseId: number, position: number) {
  const mod = testDb
    .insert(schema.modules)
    .values({ courseId, title: `Module ${position}`, position })
    .returning()
    .get();

  return testDb
    .insert(schema.lessons)
    .values({ moduleId: mod.id, title: `Lesson ${position}`, position: 1 })
    .returning()
    .get();
}

/** A lesson in the given course, with a quiz on it. */
function createLessonWithQuiz(courseId: number, position: number) {
  const lesson = createLesson(courseId, position);

  const quiz = testDb
    .insert(schema.quizzes)
    .values({
      lessonId: lesson.id,
      title: `Quiz ${position}`,
      passingScore: 0.7,
    })
    .returning()
    .get();

  return { lesson, quiz };
}

describe("pointsLedgerService", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  describe("getPointsTotal", () => {
    it("returns 0 for a student who has earned nothing", () => {
      expect(getPointsTotal(base.user.id)).toBe(0);
    });

    it("sums distinct events", () => {
      awardPoints({
        userId: base.user.id,
        amount: 10,
        reason: schema.PointsReason.LessonCompleted,
        sourceType: schema.PointsSourceType.Lesson,
        sourceId: 1,
      });
      awardPoints({
        userId: base.user.id,
        amount: 25,
        reason: schema.PointsReason.LessonCompleted,
        sourceType: schema.PointsSourceType.Lesson,
        sourceId: 2,
      });

      expect(getPointsTotal(base.user.id)).toBe(35);
    });

    it("counts only the given student's events", () => {
      const other = createSecondUser();

      awardPoints({
        userId: base.user.id,
        amount: 10,
        reason: schema.PointsReason.LessonCompleted,
        sourceType: schema.PointsSourceType.Lesson,
        sourceId: 1,
      });
      awardPoints({
        userId: other.id,
        amount: 10,
        reason: schema.PointsReason.LessonCompleted,
        sourceType: schema.PointsSourceType.Lesson,
        sourceId: 1,
      });

      expect(getPointsTotal(base.user.id)).toBe(10);
      expect(getPointsTotal(other.id)).toBe(10);
    });
  });

  describe("awardPoints", () => {
    it("reports the points it awarded", () => {
      const result = awardPoints({
        userId: base.user.id,
        amount: 10,
        reason: schema.PointsReason.LessonCompleted,
        sourceType: schema.PointsSourceType.Lesson,
        sourceId: 1,
      });

      expect(result.awarded).toBe(true);
      expect(result.amount).toBe(10);
    });

    it("is a silent no-op when the same event is awarded twice", () => {
      const first = awardPoints({
        userId: base.user.id,
        amount: 10,
        reason: schema.PointsReason.LessonCompleted,
        sourceType: schema.PointsSourceType.Lesson,
        sourceId: 1,
      });
      const second = awardPoints({
        userId: base.user.id,
        amount: 10,
        reason: schema.PointsReason.LessonCompleted,
        sourceType: schema.PointsSourceType.Lesson,
        sourceId: 1,
      });

      expect(first.awarded).toBe(true);
      expect(second.awarded).toBe(false);
      expect(second.amount).toBe(0);
      expect(getPointsTotal(base.user.id)).toBe(10);
    });

    it("does not re-award even when the repeat carries a different amount", () => {
      awardPoints({
        userId: base.user.id,
        amount: 10,
        reason: schema.PointsReason.LessonCompleted,
        sourceType: schema.PointsSourceType.Lesson,
        sourceId: 1,
      });
      awardPoints({
        userId: base.user.id,
        amount: 999,
        reason: schema.PointsReason.LessonCompleted,
        sourceType: schema.PointsSourceType.Lesson,
        sourceId: 1,
      });

      expect(getPointsTotal(base.user.id)).toBe(10);
    });

    it("stays idempotent across many repeats", () => {
      for (let i = 0; i < 5; i++) {
        awardPoints({
          userId: base.user.id,
          amount: 10,
          reason: schema.PointsReason.LessonCompleted,
          sourceType: schema.PointsSourceType.Lesson,
          sourceId: 1,
        });
      }

      expect(getPointsTotal(base.user.id)).toBe(10);
    });

    it("treats a different source id as a different event", () => {
      awardPoints({
        userId: base.user.id,
        amount: 10,
        reason: schema.PointsReason.LessonCompleted,
        sourceType: schema.PointsSourceType.Lesson,
        sourceId: 1,
      });
      const second = awardPoints({
        userId: base.user.id,
        amount: 10,
        reason: schema.PointsReason.LessonCompleted,
        sourceType: schema.PointsSourceType.Lesson,
        sourceId: 2,
      });

      expect(second.awarded).toBe(true);
      expect(getPointsTotal(base.user.id)).toBe(20);
    });

    it("treats the same event for a different student as a different event", () => {
      const other = createSecondUser();

      awardPoints({
        userId: base.user.id,
        amount: 10,
        reason: schema.PointsReason.LessonCompleted,
        sourceType: schema.PointsSourceType.Lesson,
        sourceId: 1,
      });
      const second = awardPoints({
        userId: other.id,
        amount: 10,
        reason: schema.PointsReason.LessonCompleted,
        sourceType: schema.PointsSourceType.Lesson,
        sourceId: 1,
      });

      expect(second.awarded).toBe(true);
      expect(getPointsTotal(other.id)).toBe(10);
    });

    it("records the moment the caller gives it rather than now", () => {
      awardPoints({
        userId: base.user.id,
        amount: 10,
        reason: schema.PointsReason.LessonCompleted,
        sourceType: schema.PointsSourceType.Lesson,
        sourceId: 1,
        occurredAt: "2024-03-01T09:00:00.000Z",
      });

      expect(getPointsHistory(base.user.id)[0].occurredAt).toBe(
        "2024-03-01T09:00:00.000Z"
      );
    });

    it("records now when the caller gives no moment", () => {
      const before = new Date().toISOString();

      awardPoints({
        userId: base.user.id,
        amount: 10,
        reason: schema.PointsReason.LessonCompleted,
        sourceType: schema.PointsSourceType.Lesson,
        sourceId: 1,
      });

      const [entry] = getPointsHistory(base.user.id);
      expect(entry.occurredAt >= before).toBe(true);
      expect(entry.occurredAt <= new Date().toISOString()).toBe(true);
    });

    it("keeps the moment the event was first awarded with", () => {
      awardPoints({
        userId: base.user.id,
        amount: 10,
        reason: schema.PointsReason.LessonCompleted,
        sourceType: schema.PointsSourceType.Lesson,
        sourceId: 1,
        occurredAt: "2024-03-01T09:00:00.000Z",
      });
      awardPoints({
        userId: base.user.id,
        amount: 10,
        reason: schema.PointsReason.LessonCompleted,
        sourceType: schema.PointsSourceType.Lesson,
        sourceId: 1,
        occurredAt: "2025-11-01T09:00:00.000Z",
      });

      expect(getPointsHistory(base.user.id)).toHaveLength(1);
      expect(getPointsHistory(base.user.id)[0].occurredAt).toBe(
        "2024-03-01T09:00:00.000Z"
      );
    });
  });

  describe("getPointsHistory", () => {
    it("is empty for a student who has earned nothing", () => {
      expect(getPointsHistory(base.user.id)).toEqual([]);
    });

    it("reports what was earned and when", () => {
      awardPoints({
        userId: base.user.id,
        amount: 25,
        reason: schema.PointsReason.QuizPassed,
        sourceType: schema.PointsSourceType.Quiz,
        sourceId: 4,
        occurredAt: "2024-05-02T12:00:00.000Z",
      });

      expect(getPointsHistory(base.user.id)).toEqual([
        {
          amount: 25,
          reason: schema.PointsReason.QuizPassed,
          sourceType: schema.PointsSourceType.Quiz,
          sourceId: 4,
          occurredAt: "2024-05-02T12:00:00.000Z",
        },
      ]);
    });

    it("reports the most recent event first", () => {
      awardPoints({
        userId: base.user.id,
        amount: 10,
        reason: schema.PointsReason.LessonCompleted,
        sourceType: schema.PointsSourceType.Lesson,
        sourceId: 1,
        occurredAt: "2024-01-01T09:00:00.000Z",
      });
      awardPoints({
        userId: base.user.id,
        amount: 10,
        reason: schema.PointsReason.LessonCompleted,
        sourceType: schema.PointsSourceType.Lesson,
        sourceId: 2,
        occurredAt: "2024-06-01T09:00:00.000Z",
      });

      expect(getPointsHistory(base.user.id).map((e) => e.sourceId)).toEqual([
        2, 1,
      ]);
    });

    it("reports only the given student's events", () => {
      const other = createSecondUser();

      awardPoints({
        userId: base.user.id,
        amount: 10,
        reason: schema.PointsReason.LessonCompleted,
        sourceType: schema.PointsSourceType.Lesson,
        sourceId: 1,
      });
      awardPoints({
        userId: other.id,
        amount: 10,
        reason: schema.PointsReason.LessonCompleted,
        sourceType: schema.PointsSourceType.Lesson,
        sourceId: 2,
      });

      expect(getPointsHistory(base.user.id).map((e) => e.sourceId)).toEqual([1]);
    });
  });

  describe("getCoursePointsTotal", () => {
    it("is zero for a student who has earned nothing", () => {
      expect(getCoursePointsTotal(base.user.id, base.course.id)).toBe(0);
    });

    it("is zero for a course the student has earned nothing in", () => {
      const other = createCourse("second-course");
      const { lesson } = createLessonWithQuiz(base.course.id, 1);

      awardPoints({
        userId: base.user.id,
        amount: 10,
        reason: schema.PointsReason.LessonCompleted,
        sourceType: schema.PointsSourceType.Lesson,
        sourceId: lesson.id,
      });

      expect(getCoursePointsTotal(base.user.id, other.id)).toBe(0);
    });

    it("is zero for a course that does not exist", () => {
      expect(getCoursePointsTotal(base.user.id, 9999)).toBe(0);
    });

    it("counts points earned on the course's lessons", () => {
      const first = createLessonWithQuiz(base.course.id, 1);
      const second = createLessonWithQuiz(base.course.id, 2);

      awardPoints({
        userId: base.user.id,
        amount: 10,
        reason: schema.PointsReason.LessonCompleted,
        sourceType: schema.PointsSourceType.Lesson,
        sourceId: first.lesson.id,
      });
      awardPoints({
        userId: base.user.id,
        amount: 10,
        reason: schema.PointsReason.LessonCompleted,
        sourceType: schema.PointsSourceType.Lesson,
        sourceId: second.lesson.id,
      });

      expect(getCoursePointsTotal(base.user.id, base.course.id)).toBe(20);
    });

    it("counts points earned on the course's quizzes", () => {
      const { quiz } = createLessonWithQuiz(base.course.id, 1);

      awardPoints({
        userId: base.user.id,
        amount: 25,
        reason: schema.PointsReason.QuizPassed,
        sourceType: schema.PointsSourceType.Quiz,
        sourceId: quiz.id,
      });

      expect(getCoursePointsTotal(base.user.id, base.course.id)).toBe(25);
    });

    it("counts the bonus for finishing the course itself", () => {
      awardPoints({
        userId: base.user.id,
        amount: 200,
        reason: schema.PointsReason.CourseCompleted,
        sourceType: schema.PointsSourceType.Course,
        sourceId: base.course.id,
      });

      expect(getCoursePointsTotal(base.user.id, base.course.id)).toBe(200);
    });

    it("sums the lesson, quiz and course points the student earned there", () => {
      const { lesson, quiz } = createLessonWithQuiz(base.course.id, 1);

      awardPoints({
        userId: base.user.id,
        amount: 10,
        reason: schema.PointsReason.LessonCompleted,
        sourceType: schema.PointsSourceType.Lesson,
        sourceId: lesson.id,
      });
      awardPoints({
        userId: base.user.id,
        amount: 25,
        reason: schema.PointsReason.QuizPassed,
        sourceType: schema.PointsSourceType.Quiz,
        sourceId: quiz.id,
      });
      awardPoints({
        userId: base.user.id,
        amount: 200,
        reason: schema.PointsReason.CourseCompleted,
        sourceType: schema.PointsSourceType.Course,
        sourceId: base.course.id,
      });

      expect(getCoursePointsTotal(base.user.id, base.course.id)).toBe(235);
    });

    it("does not leak points earned in another course", () => {
      const other = createCourse("second-course");
      const mine = createLessonWithQuiz(base.course.id, 1);
      const theirs = createLessonWithQuiz(other.id, 2);

      awardPoints({
        userId: base.user.id,
        amount: 10,
        reason: schema.PointsReason.LessonCompleted,
        sourceType: schema.PointsSourceType.Lesson,
        sourceId: mine.lesson.id,
      });
      awardPoints({
        userId: base.user.id,
        amount: 10,
        reason: schema.PointsReason.LessonCompleted,
        sourceType: schema.PointsSourceType.Lesson,
        sourceId: theirs.lesson.id,
      });
      awardPoints({
        userId: base.user.id,
        amount: 25,
        reason: schema.PointsReason.QuizPassed,
        sourceType: schema.PointsSourceType.Quiz,
        sourceId: theirs.quiz.id,
      });
      awardPoints({
        userId: base.user.id,
        amount: 200,
        reason: schema.PointsReason.CourseCompleted,
        sourceType: schema.PointsSourceType.Course,
        sourceId: other.id,
      });

      expect(getCoursePointsTotal(base.user.id, base.course.id)).toBe(10);
      expect(getCoursePointsTotal(base.user.id, other.id)).toBe(235);
    });

    it("does not mistake another course's quiz for a lesson of its own", () => {
      // Lesson ids and quiz ids are counted separately, so the same number can
      // be both. Here this course's lesson shares an id with the other
      // course's quiz: a total that matched on the id alone would claim it.
      const other = createCourse("second-course");
      const myLesson = createLesson(base.course.id, 1);
      const theirs = createLessonWithQuiz(other.id, 2);

      awardPoints({
        userId: base.user.id,
        amount: 25,
        reason: schema.PointsReason.QuizPassed,
        sourceType: schema.PointsSourceType.Quiz,
        sourceId: theirs.quiz.id,
      });

      expect(theirs.quiz.id).toBe(myLesson.id);
      expect(getCoursePointsTotal(base.user.id, base.course.id)).toBe(0);
      expect(getCoursePointsTotal(base.user.id, other.id)).toBe(25);
    });

    it("leaves streak milestones out — a streak belongs to no one course", () => {
      const { lesson } = createLessonWithQuiz(base.course.id, 1);

      awardPoints({
        userId: base.user.id,
        amount: 10,
        reason: schema.PointsReason.LessonCompleted,
        sourceType: schema.PointsSourceType.Lesson,
        sourceId: lesson.id,
      });
      awardPoints({
        userId: base.user.id,
        amount: 50,
        reason: schema.PointsReason.StreakMilestoneReached,
        sourceType: schema.PointsSourceType.Streak,
        sourceId: 7,
      });

      expect(getCoursePointsTotal(base.user.id, base.course.id)).toBe(10);
      expect(getPointsTotal(base.user.id)).toBe(60);
    });

    it("counts only the given student's events", () => {
      const other = createSecondUser();
      const { lesson } = createLessonWithQuiz(base.course.id, 1);

      awardPoints({
        userId: base.user.id,
        amount: 10,
        reason: schema.PointsReason.LessonCompleted,
        sourceType: schema.PointsSourceType.Lesson,
        sourceId: lesson.id,
      });
      awardPoints({
        userId: other.id,
        amount: 10,
        reason: schema.PointsReason.LessonCompleted,
        sourceType: schema.PointsSourceType.Lesson,
        sourceId: lesson.id,
      });

      expect(getCoursePointsTotal(base.user.id, base.course.id)).toBe(10);
      expect(getCoursePointsTotal(other.id, base.course.id)).toBe(10);
    });
  });
});
