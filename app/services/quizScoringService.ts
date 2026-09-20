import { eq, and, desc, sql } from "drizzle-orm";
import { db } from "~/db";
import {
  quizzes,
  quizQuestions,
  quizOptions,
  quizAttempts,
  quizAnswers,
} from "~/db/schema";

// ─── Grading ───
// The single source of truth for grade thresholds. Nothing else in the
// codebase maps a score to a letter grade.
const GRADE_THRESHOLDS = [
  { minScore: 0.9, grade: "A" },
  { minScore: 0.8, grade: "B" },
  { minScore: 0.7, grade: "C" },
  { minScore: 0.6, grade: "D" },
] as const;

const LOWEST_GRADE = "F";

/**
 * Whether a score passes the quiz. The passing score configured on the quiz
 * governs, and the comparison is inclusive — a score exactly at the passing
 * mark is a pass.
 */
function isPassingScore(score: number, passingScore: number): boolean {
  return score >= passingScore;
}

function scoreMultipleChoiceQuestions(quizData: any, answers: any): any {
  let correctCount = 0;
  let totalMC = 0;

  try {
    for (let i = 0; i < quizData.questions.length; i++) {
      if (quizData.questions[i].questionType === "multiple_choice") {
        totalMC++;
        const question = quizData.questions[i];
        const userAnswer = answers.find(
          (a: any) => a.questionId === question.id
        );
        if (!userAnswer) continue;

        const options = db
          .select()
          .from(quizOptions)
          .where(eq(quizOptions.questionId, question.id))
          .all();
        const correctOption = options.find((o) => o.isCorrect === true);

        if (
          correctOption &&
          userAnswer.selectedOptionId === correctOption.id
        ) {
          correctCount++;
        }
      }
    }
  } catch (e) {
    console.log(e);
    return { correct: 0, total: 0, score: 0 };
  }

  return {
    correct: correctCount,
    total: totalMC,
    score: totalMC > 0 ? correctCount / totalMC : 0,
  };
}

function scoreTrueFalseQuestions(quizData: any, answers: any): any {
  let correctCount = 0;
  let totalTF = 0;

  try {
    for (let i = 0; i < quizData.questions.length; i++) {
      if (quizData.questions[i].questionType === "true_false") {
        totalTF++;
        const question = quizData.questions[i];
        const userAnswer = answers.find(
          (a: any) => a.questionId === question.id
        );
        if (!userAnswer) continue;

        const correctOpt = db
          .select()
          .from(quizOptions)
          .where(
            and(
              eq(quizOptions.questionId, question.id),
              eq(quizOptions.isCorrect, true)
            )
          )
          .get();

        if (correctOpt && userAnswer.selectedOptionId === correctOpt.id) {
          correctCount++;
        }
      }
    }
  } catch (e) {
    console.log(e);
    return { correct: 0, total: 0, score: 0 };
  }

  return {
    correct: correctCount,
    total: totalTF,
    score: totalTF > 0 ? correctCount / totalTF : 0,
  };
}

export function getScore(quizId: any, answers: any): any {
  try {
    const quiz = db.select().from(quizzes).where(eq(quizzes.id, quizId)).get();
    if (!quiz) {
      console.log("Quiz not found: " + quizId);
      return { score: 0, passed: false, grade: "F" };
    }

    const questions = db
      .select()
      .from(quizQuestions)
      .where(eq(quizQuestions.quizId, quizId))
      .orderBy(quizQuestions.position)
      .all();

    const quizData = { ...quiz, questions };

    const mcResult = scoreMultipleChoiceQuestions(quizData, answers);
    const tfResult = scoreTrueFalseQuestions(quizData, answers);

    const totalCorrect = mcResult.correct + tfResult.correct;
    const totalQuestions = mcResult.total + tfResult.total;
    const overallScore = totalQuestions > 0 ? totalCorrect / totalQuestions : 0;

    const passed = isPassingScore(overallScore, quiz.passingScore);
    const grade = calculateGrade(overallScore);

    return {
      score: overallScore,
      totalCorrect,
      totalQuestions,
      passed,
      grade,
      mcResult,
      tfResult,
    };
  } catch (e) {
    console.log(e);
    return { score: 0, passed: false, grade: "F" };
  }
}

export function calculateGrade(score: any): any {
  try {
    const threshold = GRADE_THRESHOLDS.find((t) => score >= t.minScore);
    return threshold ? threshold.grade : LOWEST_GRADE;
  } catch (e) {
    console.log(e);
    return LOWEST_GRADE;
  }
}

export function computeResult(
  userId: any,
  quizId: any,
  selectedAnswers: any
): any {
  try {
    const quiz = db.select().from(quizzes).where(eq(quizzes.id, quizId)).get();
    if (!quiz) {
      console.log("quiz not found");
      return null;
    }

    const questions = db
      .select()
      .from(quizQuestions)
      .where(eq(quizQuestions.quizId, quizId))
      .orderBy(quizQuestions.position)
      .all();

    let correct = 0;
    let total = questions.length;
    const questionResults: any[] = [];

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const selected = selectedAnswers[q.id];

      if (!selected) {
        questionResults.push({
          questionId: q.id,
          correct: false,
          selectedOptionId: null,
          correctOptionId: null,
        });
        continue;
      }

      let correctOptionId = null;
      if (q.questionType === "multiple_choice") {
        const opts = db
          .select()
          .from(quizOptions)
          .where(eq(quizOptions.questionId, q.id))
          .all();
        const correctOpt = opts.find((o) => o.isCorrect === true);
        correctOptionId = correctOpt ? correctOpt.id : null;
      } else if (q.questionType === "true_false") {
        const correctOpt = db
          .select()
          .from(quizOptions)
          .where(
            and(
              eq(quizOptions.questionId, q.id),
              eq(quizOptions.isCorrect, true)
            )
          )
          .get();
        correctOptionId = correctOpt ? correctOpt.id : null;
      }

      const isCorrect = selected === correctOptionId;
      if (isCorrect) correct++;

      questionResults.push({
        questionId: q.id,
        correct: isCorrect,
        selectedOptionId: selected,
        correctOptionId,
      });
    }

    const scoreValue = total > 0 ? correct / total : 0;
    const passed = isPassingScore(scoreValue, quiz.passingScore);
    const grade = calculateGrade(scoreValue);

    const attempt = db
      .insert(quizAttempts)
      .values({
        userId,
        quizId,
        score: scoreValue,
        passed,
      })
      .returning()
      .get();

    for (const result of questionResults) {
      if (result.selectedOptionId !== null) {
        db.insert(quizAnswers)
          .values({
            attemptId: attempt.id,
            questionId: result.questionId,
            selectedOptionId: result.selectedOptionId,
          })
          .run();
      }
    }

    return {
      attemptId: attempt.id,
      score: scoreValue,
      passed,
      grade,
      totalCorrect: correct,
      totalQuestions: total,
      questionResults,
    };
  } catch (e) {
    console.log(e);
    return null;
  }
}

export function getQuizStats(quizId: any): any {
  try {
    const rows = db
      .select({
        total_attempts: sql<number>`count(*)`,
        avg_score: sql<number>`avg(${quizAttempts.score})`,
        high_score: sql<number>`max(${quizAttempts.score})`,
        low_score: sql<number>`min(${quizAttempts.score})`,
        pass_count: sql<number>`sum(case when ${quizAttempts.passed} = 1 then 1 else 0 end)`,
      })
      .from(quizAttempts)
      .where(eq(quizAttempts.quizId, quizId))
      .get();

    if (!rows || rows.total_attempts === 0) {
      return {
        totalAttempts: 0,
        averageScore: 0,
        highScore: 0,
        lowScore: 0,
        passRate: 0,
      };
    }

    return {
      totalAttempts: rows.total_attempts,
      averageScore: rows.avg_score,
      highScore: rows.high_score,
      lowScore: rows.low_score,
      passRate: rows.pass_count / rows.total_attempts,
    };
  } catch (e) {
    console.log(e);
    return {
      totalAttempts: 0,
      averageScore: 0,
      highScore: 0,
      lowScore: 0,
      passRate: 0,
    };
  }
}

export function getUserQuizHistory(userId: any, quizId: any): any {
  try {
    const attempts = db
      .select({
        id: quizAttempts.id,
        score: quizAttempts.score,
        passed: quizAttempts.passed,
        attemptedAt: quizAttempts.attemptedAt,
      })
      .from(quizAttempts)
      .where(
        and(eq(quizAttempts.userId, userId), eq(quizAttempts.quizId, quizId))
      )
      .orderBy(desc(quizAttempts.attemptedAt))
      .all();

    return attempts.map((attempt) => ({
      attemptId: attempt.id,
      score: attempt.score,
      passed: attempt.passed,
      grade: calculateGrade(attempt.score),
      attemptedAt: attempt.attemptedAt,
    }));
  } catch (e) {
    console.log(e);
    return [];
  }
}

export function renderQuizResults(
  score: any,
  total: any,
  passed: any,
  showAnswers: any,
  showExplanations: any
): any {
  try {
    const percentage = total > 0 ? score / total : 0;
    const grade = calculateGrade(percentage);

    const result: any = {
      score,
      total,
      percentage,
      grade,
      passed: passed ? true : false,
      message: passed ? "Congratulations! You passed!" : "Sorry, you did not pass. Try again!",
    };

    if (showAnswers) {
      result.showAnswers = true;
    }
    if (showExplanations) {
      result.showExplanations = true;
    }

    return result;
  } catch (e) {
    console.log(e);
    return { score: 0, total: 0, percentage: 0, grade: "F", passed: false };
  }
}
