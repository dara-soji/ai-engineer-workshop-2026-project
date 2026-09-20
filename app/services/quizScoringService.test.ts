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
  getScore,
  calculateGrade,
  computeResult,
  getQuizStats,
  getUserQuizHistory,
  renderQuizResults,
} from "./quizScoringService";

// Helper to create a quiz (with its owning module and lesson) in the test db
function createQuiz(passingScore: number, position = 1) {
  const mod = testDb
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: `Module ${position}`, position })
    .returning()
    .get();

  const lesson = testDb
    .insert(schema.lessons)
    .values({ moduleId: mod.id, title: `Lesson ${position}`, position: 1 })
    .returning()
    .get();

  return testDb
    .insert(schema.quizzes)
    .values({ lessonId: lesson.id, title: `Quiz ${position}`, passingScore })
    .returning()
    .get();
}

// Helper to add a question with one correct and one incorrect option
function addQuestion(
  quizId: number,
  position: number,
  questionType: schema.QuestionType = schema.QuestionType.MultipleChoice
) {
  const question = testDb
    .insert(schema.quizQuestions)
    .values({
      quizId,
      questionText: `Question ${position}`,
      questionType,
      position,
    })
    .returning()
    .get();

  const correct = testDb
    .insert(schema.quizOptions)
    .values({ questionId: question.id, optionText: "Correct", isCorrect: true })
    .returning()
    .get();

  const wrong = testDb
    .insert(schema.quizOptions)
    .values({ questionId: question.id, optionText: "Wrong", isCorrect: false })
    .returning()
    .get();

  return { question, correct, wrong };
}

// Helper to build a quiz of `count` questions, all of the given type
function createQuizWithQuestions(
  passingScore: number,
  count: number,
  questionType: schema.QuestionType = schema.QuestionType.MultipleChoice,
  position = 1
) {
  const quiz = createQuiz(passingScore, position);
  const questions = [];
  for (let i = 0; i < count; i++) {
    questions.push(addQuestion(quiz.id, i + 1, questionType));
  }
  return { quiz, questions };
}

describe("quizScoringService", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  describe("getScore", () => {
    it("scores every question correct as a full score", () => {
      const { quiz, questions } = createQuizWithQuestions(0.7, 4);

      const result = getScore(
        quiz.id,
        questions.map((q) => ({
          questionId: q.question.id,
          selectedOptionId: q.correct.id,
        }))
      );

      expect(result.score).toBe(1);
      expect(result.totalCorrect).toBe(4);
      expect(result.totalQuestions).toBe(4);
      expect(result.grade).toBe("A");
      expect(result.passed).toBe(true);
    });

    it("scores a partially correct submission", () => {
      const { quiz, questions } = createQuizWithQuestions(0.7, 4);

      const result = getScore(quiz.id, [
        { questionId: questions[0].question.id, selectedOptionId: questions[0].correct.id },
        { questionId: questions[1].question.id, selectedOptionId: questions[1].correct.id },
        { questionId: questions[2].question.id, selectedOptionId: questions[2].wrong.id },
        { questionId: questions[3].question.id, selectedOptionId: questions[3].wrong.id },
      ]);

      expect(result.score).toBe(0.5);
      expect(result.totalCorrect).toBe(2);
      expect(result.grade).toBe("F");
      expect(result.passed).toBe(false);
    });

    it("counts unanswered questions as incorrect", () => {
      const { quiz, questions } = createQuizWithQuestions(0.7, 2);

      const result = getScore(quiz.id, [
        { questionId: questions[0].question.id, selectedOptionId: questions[0].correct.id },
      ]);

      expect(result.score).toBe(0.5);
      expect(result.totalQuestions).toBe(2);
    });

    it("scores true/false questions alongside multiple choice", () => {
      const quiz = createQuiz(0.5);
      const mc = addQuestion(quiz.id, 1, schema.QuestionType.MultipleChoice);
      const tf = addQuestion(quiz.id, 2, schema.QuestionType.TrueFalse);

      const result = getScore(quiz.id, [
        { questionId: mc.question.id, selectedOptionId: mc.correct.id },
        { questionId: tf.question.id, selectedOptionId: tf.correct.id },
      ]);

      expect(result.score).toBe(1);
      expect(result.totalQuestions).toBe(2);
    });

    it("returns a zero score for a quiz that does not exist", () => {
      const result = getScore(9999, []);

      expect(result.score).toBe(0);
      expect(result.passed).toBe(false);
      expect(result.grade).toBe("F");
    });

    describe("the configured passing score governs pass and fail", () => {
      it("passes a score exactly at the configured passing mark", () => {
        const { quiz, questions } = createQuizWithQuestions(0.5, 2);

        const result = getScore(quiz.id, [
          { questionId: questions[0].question.id, selectedOptionId: questions[0].correct.id },
          { questionId: questions[1].question.id, selectedOptionId: questions[1].wrong.id },
        ]);

        expect(result.score).toBe(0.5);
        expect(result.passed).toBe(true);
      });

      it("fails a score just below the configured passing mark", () => {
        const { quiz, questions } = createQuizWithQuestions(0.5, 4);

        const result = getScore(quiz.id, [
          { questionId: questions[0].question.id, selectedOptionId: questions[0].correct.id },
          { questionId: questions[1].question.id, selectedOptionId: questions[1].wrong.id },
          { questionId: questions[2].question.id, selectedOptionId: questions[2].wrong.id },
          { questionId: questions[3].question.id, selectedOptionId: questions[3].wrong.id },
        ]);

        expect(result.score).toBe(0.25);
        expect(result.passed).toBe(false);
      });

      it("fails a score below a quiz's own high passing mark that would pass a default threshold", () => {
        const { quiz, questions } = createQuizWithQuestions(0.9, 4);

        const result = getScore(
          quiz.id,
          questions
            .slice(0, 3)
            .map((q) => ({ questionId: q.question.id, selectedOptionId: q.correct.id }))
        );

        expect(result.score).toBe(0.75);
        expect(result.passed).toBe(false);
      });

      it("passes a low score when the quiz's own passing mark is low", () => {
        const { quiz, questions } = createQuizWithQuestions(0.2, 4);

        const result = getScore(quiz.id, [
          { questionId: questions[0].question.id, selectedOptionId: questions[0].correct.id },
        ]);

        expect(result.score).toBe(0.25);
        expect(result.passed).toBe(true);
      });
    });
  });

  describe("calculateGrade", () => {
    it.each([
      [1, "A"],
      [0.9, "A"],
      [0.89, "B"],
      [0.8, "B"],
      [0.79, "C"],
      [0.7, "C"],
      [0.69, "D"],
      [0.6, "D"],
      [0.59, "F"],
      [0, "F"],
    ])("grades %s as %s", (score, grade) => {
      expect(calculateGrade(score)).toBe(grade);
    });
  });

  describe("computeResult", () => {
    it("records an attempt and returns the scored result", () => {
      const { quiz, questions } = createQuizWithQuestions(0.7, 2);

      const result = computeResult(base.user.id, quiz.id, {
        [questions[0].question.id]: questions[0].correct.id,
        [questions[1].question.id]: questions[1].correct.id,
      });

      expect(result).not.toBeNull();
      expect(result!.score).toBe(1);
      expect(result!.passed).toBe(true);
      expect(result!.grade).toBe("A");
      expect(result!.totalCorrect).toBe(2);
      expect(result!.totalQuestions).toBe(2);
      expect(result!.attemptId).toBeDefined();
    });

    it("reports which questions were answered correctly", () => {
      const { quiz, questions } = createQuizWithQuestions(0.7, 2);

      const result = computeResult(base.user.id, quiz.id, {
        [questions[0].question.id]: questions[0].correct.id,
        [questions[1].question.id]: questions[1].wrong.id,
      });

      expect(result!.questionResults).toHaveLength(2);
      expect(result!.questionResults[0]).toMatchObject({
        questionId: questions[0].question.id,
        correct: true,
        selectedOptionId: questions[0].correct.id,
        correctOptionId: questions[0].correct.id,
      });
      expect(result!.questionResults[1]).toMatchObject({
        questionId: questions[1].question.id,
        correct: false,
        selectedOptionId: questions[1].wrong.id,
      });
    });

    it("reports unanswered questions as incorrect with no selection", () => {
      const { quiz, questions } = createQuizWithQuestions(0.7, 2);

      const result = computeResult(base.user.id, quiz.id, {
        [questions[0].question.id]: questions[0].correct.id,
      });

      expect(result!.score).toBe(0.5);
      expect(result!.questionResults[1]).toMatchObject({
        questionId: questions[1].question.id,
        correct: false,
        selectedOptionId: null,
      });
    });

    it("records a score exactly at the configured passing mark as a pass", () => {
      const { quiz, questions } = createQuizWithQuestions(0.5, 2);

      const result = computeResult(base.user.id, quiz.id, {
        [questions[0].question.id]: questions[0].correct.id,
        [questions[1].question.id]: questions[1].wrong.id,
      });

      expect(result!.score).toBe(0.5);
      expect(result!.passed).toBe(true);

      // The recorded attempt agrees with the returned result
      const history = getUserQuizHistory(base.user.id, quiz.id);
      expect(history).toHaveLength(1);
      expect(history[0].passed).toBe(true);
    });

    it("records a failure against a quiz's own high passing mark", () => {
      const { quiz, questions } = createQuizWithQuestions(0.9, 4);

      const result = computeResult(base.user.id, quiz.id, {
        [questions[0].question.id]: questions[0].correct.id,
        [questions[1].question.id]: questions[1].correct.id,
        [questions[2].question.id]: questions[2].correct.id,
        [questions[3].question.id]: questions[3].wrong.id,
      });

      expect(result!.score).toBe(0.75);
      expect(result!.passed).toBe(false);

      const history = getUserQuizHistory(base.user.id, quiz.id);
      expect(history[0].passed).toBe(false);
    });

    it("returns null for a quiz that does not exist", () => {
      expect(computeResult(base.user.id, 9999, {})).toBeNull();
    });
  });

  describe("getQuizStats", () => {
    it("summarises the attempts recorded for a quiz", () => {
      const { quiz, questions } = createQuizWithQuestions(0.5, 2);

      // One full-mark attempt (pass) and one zero-mark attempt (fail)
      computeResult(base.user.id, quiz.id, {
        [questions[0].question.id]: questions[0].correct.id,
        [questions[1].question.id]: questions[1].correct.id,
      });
      computeResult(base.user.id, quiz.id, {
        [questions[0].question.id]: questions[0].wrong.id,
        [questions[1].question.id]: questions[1].wrong.id,
      });

      const stats = getQuizStats(quiz.id);

      expect(stats.totalAttempts).toBe(2);
      expect(stats.averageScore).toBe(0.5);
      expect(stats.highScore).toBe(1);
      expect(stats.lowScore).toBe(0);
      expect(stats.passRate).toBe(0.5);
    });

    it("returns zeroed stats for a quiz with no attempts", () => {
      const { quiz } = createQuizWithQuestions(0.7, 1);

      expect(getQuizStats(quiz.id)).toEqual({
        totalAttempts: 0,
        averageScore: 0,
        highScore: 0,
        lowScore: 0,
        passRate: 0,
      });
    });

    it("only counts attempts for the requested quiz", () => {
      const first = createQuizWithQuestions(0.5, 2, schema.QuestionType.MultipleChoice, 1);
      const second = createQuizWithQuestions(0.5, 2, schema.QuestionType.MultipleChoice, 2);

      computeResult(base.user.id, first.quiz.id, {
        [first.questions[0].question.id]: first.questions[0].correct.id,
        [first.questions[1].question.id]: first.questions[1].correct.id,
      });

      expect(getQuizStats(first.quiz.id).totalAttempts).toBe(1);
      expect(getQuizStats(second.quiz.id).totalAttempts).toBe(0);
    });
  });

  describe("getUserQuizHistory", () => {
    it("returns each attempt with its score, grade and pass state", () => {
      const { quiz, questions } = createQuizWithQuestions(0.5, 2);

      computeResult(base.user.id, quiz.id, {
        [questions[0].question.id]: questions[0].correct.id,
        [questions[1].question.id]: questions[1].correct.id,
      });

      const history = getUserQuizHistory(base.user.id, quiz.id);

      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        score: 1,
        passed: true,
        grade: "A",
      });
      expect(history[0].attemptedAt).toBeDefined();
    });

    it("returns an empty history for a user with no attempts", () => {
      const { quiz } = createQuizWithQuestions(0.7, 1);

      expect(getUserQuizHistory(base.user.id, quiz.id)).toEqual([]);
    });

    it("does not return another user's attempts", () => {
      const { quiz, questions } = createQuizWithQuestions(0.5, 2);

      computeResult(base.instructor.id, quiz.id, {
        [questions[0].question.id]: questions[0].correct.id,
        [questions[1].question.id]: questions[1].correct.id,
      });

      expect(getUserQuizHistory(base.user.id, quiz.id)).toEqual([]);
      expect(getUserQuizHistory(base.instructor.id, quiz.id)).toHaveLength(1);
    });
  });

  describe("renderQuizResults", () => {
    it("derives percentage and grade from the raw score", () => {
      const result = renderQuizResults(9, 10, true, false, false);

      expect(result.percentage).toBe(0.9);
      expect(result.grade).toBe("A");
      expect(result.passed).toBe(true);
      expect(result.message).toContain("passed");
    });

    it("reports a failure message when the attempt did not pass", () => {
      const result = renderQuizResults(5, 10, false, false, false);

      expect(result.grade).toBe("F");
      expect(result.passed).toBe(false);
      expect(result.message).toContain("did not pass");
    });

    it("includes answer and explanation flags only when requested", () => {
      const withFlags = renderQuizResults(10, 10, true, true, true);
      expect(withFlags.showAnswers).toBe(true);
      expect(withFlags.showExplanations).toBe(true);

      const withoutFlags = renderQuizResults(10, 10, true, false, false);
      expect(withoutFlags.showAnswers).toBeUndefined();
      expect(withoutFlags.showExplanations).toBeUndefined();
    });

    it("reports a zero percentage when there are no questions", () => {
      const result = renderQuizResults(0, 0, false, false, false);

      expect(result.percentage).toBe(0);
      expect(result.grade).toBe("F");
    });
  });
});
