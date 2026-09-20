import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import {
  POINTS_PER_COURSE_COMPLETION,
  POINTS_PER_LESSON_COMPLETION,
  POINTS_PER_QUIZ_PASS,
} from "~/lib/pointsRules";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

// Import after mock so the modules pick up our test db
import { backfillPointsLedger } from "./pointsBackfillService";
import { getPointsHistory, getPointsTotal } from "./pointsLedgerService";
import { recordLessonCompletion } from "./gamificationService";

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

function createQuiz(lessonId: number, passingScore: number) {
  return testDb
    .insert(schema.quizzes)
    .values({ lessonId, title: "Quiz", passingScore })
    .returning()
    .get();
}

/** History as it exists before the feature ships: a completed lesson. */
function completeLesson(userId: number, lessonId: number, completedAt: string) {
  return testDb
    .insert(schema.lessonProgress)
    .values({
      userId,
      lessonId,
      status: schema.LessonProgressStatus.Completed,
      completedAt,
    })
    .returning()
    .get();
}

/**
 * A historic quiz attempt. `passed` is what the *old* system recorded, which
 * the corrected rule may disagree with — so it is set independently of the
 * score on purpose.
 */
function recordAttempt(
  userId: number,
  quizId: number,
  score: number,
  passed: boolean,
  attemptedAt: string
) {
  return testDb
    .insert(schema.quizAttempts)
    .values({ userId, quizId, score, passed, attemptedAt })
    .returning()
    .get();
}

function enrol(
  userId: number,
  courseId: number,
  completedAt: string | null = null
) {
  return testDb
    .insert(schema.enrollments)
    .values({ userId, courseId, completedAt })
    .returning()
    .get();
}

function occurredAtFor(
  userId: number,
  sourceType: schema.PointsSourceType,
  sourceId: number
): string | undefined {
  return getPointsHistory(userId).find(
    (e) => e.sourceType === sourceType && e.sourceId === sourceId
  )?.occurredAt;
}

describe("pointsBackfillService", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  describe("completed lessons", () => {
    it("converts a student's completed lessons into points", () => {
      const first = createLesson(base.course.id, 1);
      const second = createLesson(base.course.id, 2);
      completeLesson(base.user.id, first.id, "2024-01-01T09:00:00.000Z");
      completeLesson(base.user.id, second.id, "2024-01-02T09:00:00.000Z");

      backfillPointsLedger();

      expect(getPointsTotal(base.user.id)).toBe(
        POINTS_PER_LESSON_COMPLETION * 2
      );
    });

    it("pays nothing for a lesson that was only started", () => {
      const lesson = createLesson(base.course.id, 1);
      testDb
        .insert(schema.lessonProgress)
        .values({
          userId: base.user.id,
          lessonId: lesson.id,
          status: schema.LessonProgressStatus.InProgress,
        })
        .run();

      backfillPointsLedger();

      expect(getPointsTotal(base.user.id)).toBe(0);
    });

    it("carries the original completion timestamp, not the backfill time", () => {
      const lesson = createLesson(base.course.id, 1);
      completeLesson(base.user.id, lesson.id, "2024-01-01T09:00:00.000Z");

      backfillPointsLedger();

      expect(
        occurredAtFor(base.user.id, schema.PointsSourceType.Lesson, lesson.id)
      ).toBe("2024-01-01T09:00:00.000Z");
    });

    it("pays a completion that has no recorded timestamp", () => {
      const lesson = createLesson(base.course.id, 1);
      testDb
        .insert(schema.lessonProgress)
        .values({
          userId: base.user.id,
          lessonId: lesson.id,
          status: schema.LessonProgressStatus.Completed,
          completedAt: null,
        })
        .run();

      backfillPointsLedger();

      expect(getPointsTotal(base.user.id)).toBe(POINTS_PER_LESSON_COMPLETION);
    });

    it("pays every student, not just one", () => {
      const other = createSecondUser();
      const lesson = createLesson(base.course.id, 1);
      completeLesson(base.user.id, lesson.id, "2024-01-01T09:00:00.000Z");
      completeLesson(other.id, lesson.id, "2024-01-03T09:00:00.000Z");

      backfillPointsLedger();

      expect(getPointsTotal(base.user.id)).toBe(POINTS_PER_LESSON_COMPLETION);
      expect(getPointsTotal(other.id)).toBe(POINTS_PER_LESSON_COMPLETION);
    });
  });

  describe("passed quiz attempts", () => {
    it("converts a passing attempt into points", () => {
      const lesson = createLesson(base.course.id, 1);
      const quiz = createQuiz(lesson.id, 0.7);
      recordAttempt(
        base.user.id,
        quiz.id,
        0.9,
        true,
        "2024-02-01T09:00:00.000Z"
      );

      backfillPointsLedger();

      expect(getPointsTotal(base.user.id)).toBe(POINTS_PER_QUIZ_PASS);
    });

    it("pays nothing for an attempt below the quiz's passing score", () => {
      const lesson = createLesson(base.course.id, 1);
      const quiz = createQuiz(lesson.id, 0.7);
      recordAttempt(
        base.user.id,
        quiz.id,
        0.6,
        false,
        "2024-02-01T09:00:00.000Z"
      );

      backfillPointsLedger();

      expect(getPointsTotal(base.user.id)).toBe(0);
    });

    it("pays an attempt exactly at the passing mark that the old system recorded as a failure", () => {
      const lesson = createLesson(base.course.id, 1);
      const quiz = createQuiz(lesson.id, 0.7);
      recordAttempt(
        base.user.id,
        quiz.id,
        0.7,
        false,
        "2024-02-01T09:00:00.000Z"
      );

      backfillPointsLedger();

      expect(getPointsTotal(base.user.id)).toBe(POINTS_PER_QUIZ_PASS);
    });

    it("applies each quiz's own passing score", () => {
      const lenientLesson = createLesson(base.course.id, 1);
      const strictLesson = createLesson(base.course.id, 2);
      const lenient = createQuiz(lenientLesson.id, 0.5);
      const strict = createQuiz(strictLesson.id, 0.9);
      recordAttempt(
        base.user.id,
        lenient.id,
        0.6,
        true,
        "2024-02-01T09:00:00.000Z"
      );
      recordAttempt(
        base.user.id,
        strict.id,
        0.6,
        true,
        "2024-02-01T09:00:00.000Z"
      );

      backfillPointsLedger();

      expect(getPointsTotal(base.user.id)).toBe(POINTS_PER_QUIZ_PASS);
    });

    it("pays once however many times the quiz was passed", () => {
      const lesson = createLesson(base.course.id, 1);
      const quiz = createQuiz(lesson.id, 0.7);
      recordAttempt(
        base.user.id,
        quiz.id,
        0.8,
        true,
        "2024-02-01T09:00:00.000Z"
      );
      recordAttempt(base.user.id, quiz.id, 1, true, "2024-02-05T09:00:00.000Z");

      backfillPointsLedger();

      expect(getPointsTotal(base.user.id)).toBe(POINTS_PER_QUIZ_PASS);
    });

    it("carries the timestamp of the attempt that first passed", () => {
      const lesson = createLesson(base.course.id, 1);
      const quiz = createQuiz(lesson.id, 0.7);
      recordAttempt(
        base.user.id,
        quiz.id,
        0.2,
        false,
        "2024-02-01T09:00:00.000Z"
      );
      recordAttempt(
        base.user.id,
        quiz.id,
        0.8,
        true,
        "2024-02-05T09:00:00.000Z"
      );
      recordAttempt(base.user.id, quiz.id, 1, true, "2024-02-09T09:00:00.000Z");

      backfillPointsLedger();

      expect(
        occurredAtFor(base.user.id, schema.PointsSourceType.Quiz, quiz.id)
      ).toBe("2024-02-05T09:00:00.000Z");
    });
  });

  describe("completed enrolments", () => {
    it("converts a completed enrolment into the course bonus", () => {
      enrol(base.user.id, base.course.id, "2024-03-01T09:00:00.000Z");

      backfillPointsLedger();

      expect(getPointsTotal(base.user.id)).toBe(POINTS_PER_COURSE_COMPLETION);
    });

    it("pays nothing for an enrolment that was never finished", () => {
      enrol(base.user.id, base.course.id);

      backfillPointsLedger();

      expect(getPointsTotal(base.user.id)).toBe(0);
    });

    it("carries the enrolment's completion timestamp", () => {
      enrol(base.user.id, base.course.id, "2024-03-01T09:00:00.000Z");

      backfillPointsLedger();

      expect(
        occurredAtFor(
          base.user.id,
          schema.PointsSourceType.Course,
          base.course.id
        )
      ).toBe("2024-03-01T09:00:00.000Z");
    });

    it("pays each finished course separately", () => {
      const second = createCourse("second-course");
      enrol(base.user.id, base.course.id, "2024-03-01T09:00:00.000Z");
      enrol(base.user.id, second.id, "2024-04-01T09:00:00.000Z");

      backfillPointsLedger();

      expect(getPointsTotal(base.user.id)).toBe(
        POINTS_PER_COURSE_COMPLETION * 2
      );
    });
  });

  describe("streak milestones", () => {
    it("does not backfill them, however long the historic run", () => {
      const days = [
        "2024-01-01",
        "2024-01-02",
        "2024-01-03",
        "2024-01-04",
        "2024-01-05",
        "2024-01-06",
        "2024-01-07",
      ];
      days.forEach((day, index) => {
        const lesson = createLesson(base.course.id, index + 1);
        completeLesson(base.user.id, lesson.id, `${day}T09:00:00.000Z`);
      });

      backfillPointsLedger();

      expect(getPointsTotal(base.user.id)).toBe(
        POINTS_PER_LESSON_COMPLETION * days.length
      );
      expect(
        getPointsHistory(base.user.id).some(
          (e) => e.sourceType === schema.PointsSourceType.Streak
        )
      ).toBe(false);
    });
  });

  describe("re-running", () => {
    function seedHistory() {
      const lesson = createLesson(base.course.id, 1);
      const quiz = createQuiz(lesson.id, 0.7);
      completeLesson(base.user.id, lesson.id, "2024-01-01T09:00:00.000Z");
      recordAttempt(
        base.user.id,
        quiz.id,
        0.8,
        true,
        "2024-02-01T09:00:00.000Z"
      );
      enrol(base.user.id, base.course.id, "2024-03-01T09:00:00.000Z");

      return { lesson, quiz };
    }

    it("produces the same total as running it once", () => {
      seedHistory();

      backfillPointsLedger();
      const afterOneRun = getPointsTotal(base.user.id);
      backfillPointsLedger();
      backfillPointsLedger();

      expect(getPointsTotal(base.user.id)).toBe(afterOneRun);
      expect(afterOneRun).toBe(
        POINTS_PER_LESSON_COMPLETION +
          POINTS_PER_QUIZ_PASS +
          POINTS_PER_COURSE_COMPLETION
      );
    });

    it("leaves the history it already wrote untouched", () => {
      seedHistory();

      backfillPointsLedger();
      const afterOneRun = getPointsHistory(base.user.id);
      backfillPointsLedger();

      expect(getPointsHistory(base.user.id)).toEqual(afterOneRun);
    });

    it("reports nothing new on the second run", () => {
      seedHistory();

      backfillPointsLedger();
      const second = backfillPointsLedger();

      expect(second).toEqual({
        lessonsAwarded: 0,
        quizzesAwarded: 0,
        coursesAwarded: 0,
        pointsAwarded: 0,
      });
    });

    it("picks up history made since the last run", () => {
      seedHistory();
      backfillPointsLedger();

      const later = createLesson(base.course.id, 2);
      completeLesson(base.user.id, later.id, "2024-05-01T09:00:00.000Z");
      const summary = backfillPointsLedger();

      expect(summary.lessonsAwarded).toBe(1);
      expect(summary.pointsAwarded).toBe(POINTS_PER_LESSON_COMPLETION);
    });

    it("does not duplicate points the live system has already awarded", () => {
      const { lesson } = seedHistory();

      // The student revisits the lesson after launch and the orchestrator pays
      // for it — the lesson, and the course it finishes — before the backfill
      // has ever run. The backfill owes them only the quiz.
      recordLessonCompletion(base.user.id, lesson.id);
      const beforeBackfill = getPointsTotal(base.user.id);

      backfillPointsLedger();

      expect(beforeBackfill).toBe(
        POINTS_PER_LESSON_COMPLETION + POINTS_PER_COURSE_COMPLETION
      );
      expect(getPointsTotal(base.user.id)).toBe(
        beforeBackfill + POINTS_PER_QUIZ_PASS
      );
    });
  });

  describe("the summary", () => {
    it("reports what the run awarded", () => {
      const lesson = createLesson(base.course.id, 1);
      const other = createLesson(base.course.id, 2);
      const quiz = createQuiz(lesson.id, 0.7);
      completeLesson(base.user.id, lesson.id, "2024-01-01T09:00:00.000Z");
      completeLesson(base.user.id, other.id, "2024-01-02T09:00:00.000Z");
      recordAttempt(
        base.user.id,
        quiz.id,
        0.8,
        true,
        "2024-02-01T09:00:00.000Z"
      );
      enrol(base.user.id, base.course.id, "2024-03-01T09:00:00.000Z");

      expect(backfillPointsLedger()).toEqual({
        lessonsAwarded: 2,
        quizzesAwarded: 1,
        coursesAwarded: 1,
        pointsAwarded:
          POINTS_PER_LESSON_COMPLETION * 2 +
          POINTS_PER_QUIZ_PASS +
          POINTS_PER_COURSE_COMPLETION,
      });
    });

    it("reports nothing for a platform with no history", () => {
      expect(backfillPointsLedger()).toEqual({
        lessonsAwarded: 0,
        quizzesAwarded: 0,
        coursesAwarded: 0,
        pointsAwarded: 0,
      });
    });
  });
});
