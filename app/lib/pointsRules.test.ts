import { describe, it, expect } from "vitest";
import { POINTS_PER_LESSON_COMPLETION, pointsForLessonCompletion } from "./pointsRules";

describe("pointsRules", () => {
  describe("pointsForLessonCompletion", () => {
    it("returns the configured point value for completing a lesson", () => {
      expect(pointsForLessonCompletion()).toBe(POINTS_PER_LESSON_COMPLETION);
    });

    it("awards a positive number of points", () => {
      expect(pointsForLessonCompletion()).toBeGreaterThan(0);
    });

    it("awards a whole number of points", () => {
      expect(Number.isInteger(pointsForLessonCompletion())).toBe(true);
    });

    it("is stable across calls", () => {
      expect(pointsForLessonCompletion()).toBe(pointsForLessonCompletion());
    });

    it("pins the current tuning value", () => {
      expect(POINTS_PER_LESSON_COMPLETION).toBe(10);
    });
  });
});
