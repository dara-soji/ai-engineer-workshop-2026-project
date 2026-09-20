import { describe, it, expect } from "vitest";
import {
  POINTS_PER_LESSON_COMPLETION,
  POINTS_PER_QUIZ_PASS,
  STREAK_MILESTONES,
  pointsForLessonCompletion,
  pointsForQuizPass,
  streakMilestoneFor,
} from "./pointsRules";

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

  describe("pointsForQuizPass", () => {
    it("returns the configured point value for passing a quiz", () => {
      expect(pointsForQuizPass()).toBe(POINTS_PER_QUIZ_PASS);
    });

    it("awards a positive number of points", () => {
      expect(pointsForQuizPass()).toBeGreaterThan(0);
    });

    it("awards a whole number of points", () => {
      expect(Number.isInteger(pointsForQuizPass())).toBe(true);
    });

    it("is stable across calls", () => {
      expect(pointsForQuizPass()).toBe(pointsForQuizPass());
    });

    it("is worth more than reading the lesson it belongs to", () => {
      expect(pointsForQuizPass()).toBeGreaterThan(pointsForLessonCompletion());
    });

    it("pins the current tuning value", () => {
      expect(POINTS_PER_QUIZ_PASS).toBe(25);
    });
  });

  describe("STREAK_MILESTONES", () => {
    it("pins the current milestones and their bonuses", () => {
      expect(STREAK_MILESTONES).toEqual([
        { days: 3, points: 25 },
        { days: 7, points: 50 },
        { days: 14, points: 100 },
        { days: 30, points: 250 },
        { days: 60, points: 500 },
        { days: 100, points: 1000 },
      ]);
    });

    it("lists milestones in ascending order of days", () => {
      const days = STREAK_MILESTONES.map((m) => m.days);

      expect(days).toEqual([...days].sort((a, b) => a - b));
    });

    it("never repeats a day count, so a run reaches each milestone once", () => {
      const days = STREAK_MILESTONES.map((m) => m.days);

      expect(new Set(days).size).toBe(days.length);
    });

    it("pays more for a longer run", () => {
      const bonuses = STREAK_MILESTONES.map((m) => m.points);

      expect(bonuses).toEqual([...bonuses].sort((a, b) => a - b));
    });

    it("awards whole, positive bonuses on whole, positive day counts", () => {
      for (const { days, points } of STREAK_MILESTONES) {
        expect(Number.isInteger(days)).toBe(true);
        expect(days).toBeGreaterThan(0);
        expect(Number.isInteger(points)).toBe(true);
        expect(points).toBeGreaterThan(0);
      }
    });

    it("is worth more than the lesson that earned the day", () => {
      for (const { points } of STREAK_MILESTONES) {
        expect(points).toBeGreaterThan(POINTS_PER_LESSON_COMPLETION);
      }
    });
  });

  describe("streakMilestoneFor", () => {
    it("returns the milestone a run of exactly that length reaches", () => {
      for (const milestone of STREAK_MILESTONES) {
        expect(streakMilestoneFor(milestone.days)).toEqual(milestone);
      }
    });

    it("returns nothing for a run that has not reached a milestone", () => {
      const milestoneDays = new Set(STREAK_MILESTONES.map((m) => m.days));

      for (let days = 1; days <= 120; days++) {
        if (milestoneDays.has(days)) continue;
        expect(streakMilestoneFor(days)).toBeNull();
      }
    });

    it("returns nothing the day after a milestone, so it pays only once", () => {
      for (const { days } of STREAK_MILESTONES) {
        expect(streakMilestoneFor(days + 1)).not.toEqual(
          streakMilestoneFor(days)
        );
      }
    });

    it("returns nothing for a student with no streak", () => {
      expect(streakMilestoneFor(0)).toBeNull();
    });

    it("returns nothing for a nonsensical run length", () => {
      expect(streakMilestoneFor(-1)).toBeNull();
      expect(streakMilestoneFor(3.5)).toBeNull();
      expect(streakMilestoneFor(NaN)).toBeNull();
    });
  });
});
