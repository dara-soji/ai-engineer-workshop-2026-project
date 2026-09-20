import { describe, it, expect } from "vitest";
import { LEVEL_THRESHOLDS, MAX_LEVEL, getLevelProgress } from "./levels";

describe("levels", () => {
  describe("the threshold table", () => {
    it("starts the first level at zero points", () => {
      expect(LEVEL_THRESHOLDS[0]).toBe(0);
    });

    it("rises strictly, so every total maps to exactly one level", () => {
      for (let i = 1; i < LEVEL_THRESHOLDS.length; i++) {
        expect(LEVEL_THRESHOLDS[i]).toBeGreaterThan(LEVEL_THRESHOLDS[i - 1]);
      }
    });

    it("is made of whole numbers", () => {
      for (const threshold of LEVEL_THRESHOLDS) {
        expect(Number.isInteger(threshold)).toBe(true);
      }
    });

    it("has one level per threshold", () => {
      expect(MAX_LEVEL).toBe(LEVEL_THRESHOLDS.length);
    });

    it("pins the current level curve", () => {
      expect(LEVEL_THRESHOLDS).toEqual([
        0, 50, 150, 300, 500, 800, 1200, 1700, 2300, 3000,
      ]);
    });
  });

  describe("threshold boundaries", () => {
    // The whole point of the module: the exact total at which a level begins,
    // and one point either side of it.
    LEVEL_THRESHOLDS.forEach((threshold, index) => {
      const level = index + 1;

      it(`begins level ${level} at exactly ${threshold} points`, () => {
        expect(getLevelProgress(threshold).level).toBe(level);
      });

      it(`is still level ${level} at ${threshold + 1} points`, () => {
        expect(getLevelProgress(threshold + 1).level).toBe(level);
      });

      if (index > 0) {
        it(`is still level ${level - 1} at ${threshold - 1} points`, () => {
          expect(getLevelProgress(threshold - 1).level).toBe(level - 1);
        });

        it(`reports 1 point remaining at ${threshold - 1} points`, () => {
          expect(getLevelProgress(threshold - 1).pointsToNextLevel).toBe(1);
        });
      }

      it(`reports zero progress into level ${level} at exactly ${threshold} points`, () => {
        expect(getLevelProgress(threshold).pointsIntoLevel).toBe(0);
      });
    });
  });

  describe("a student with no points", () => {
    it("is on the first level, not an error or a blank", () => {
      expect(getLevelProgress(0).level).toBe(1);
    });

    it("has made no progress into that level", () => {
      expect(getLevelProgress(0).pointsIntoLevel).toBe(0);
      expect(getLevelProgress(0).progressPercent).toBe(0);
    });

    it("is told how far the second level is", () => {
      expect(getLevelProgress(0).pointsToNextLevel).toBe(LEVEL_THRESHOLDS[1]);
      expect(getLevelProgress(0).nextLevelAt).toBe(LEVEL_THRESHOLDS[1]);
    });
  });

  describe("progress within a level", () => {
    it("counts points earned since the level began", () => {
      expect(getLevelProgress(200).pointsIntoLevel).toBe(50);
    });

    it("counts points still owed to the next level", () => {
      expect(getLevelProgress(200).pointsToNextLevel).toBe(100);
    });

    it("reports where the current level began and where the next one starts", () => {
      const progress = getLevelProgress(200);
      expect(progress.levelStartsAt).toBe(150);
      expect(progress.nextLevelAt).toBe(300);
    });

    it("expresses progress as a percentage of the way to the next level", () => {
      expect(getLevelProgress(225).progressPercent).toBe(50);
    });

    it("rounds the percentage to a whole number", () => {
      expect(Number.isInteger(getLevelProgress(199).progressPercent)).toBe(true);
    });

    it("never reports 100% before the next level is actually reached", () => {
      expect(getLevelProgress(299).progressPercent).toBeLessThan(100);
    });

    it("accounts for every point: progress plus remaining spans the level", () => {
      for (let total = 0; total <= 3000; total += 7) {
        const { pointsIntoLevel, pointsToNextLevel, levelStartsAt, nextLevelAt } =
          getLevelProgress(total);
        expect(levelStartsAt + pointsIntoLevel).toBe(total);
        if (nextLevelAt !== null) {
          expect(pointsIntoLevel + pointsToNextLevel!).toBe(
            nextLevelAt - levelStartsAt
          );
        }
      }
    });
  });

  describe("the highest level", () => {
    const topThreshold = LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1];

    it("is reached at the final threshold", () => {
      expect(getLevelProgress(topThreshold).level).toBe(MAX_LEVEL);
    });

    it("has no next level to count towards", () => {
      const progress = getLevelProgress(topThreshold);
      expect(progress.nextLevelAt).toBeNull();
      expect(progress.pointsToNextLevel).toBeNull();
    });

    it("stays at the highest level however many points are earned beyond it", () => {
      expect(getLevelProgress(topThreshold * 10).level).toBe(MAX_LEVEL);
    });

    it("shows a full progress bar rather than an unfinished one", () => {
      expect(getLevelProgress(topThreshold).progressPercent).toBe(100);
    });
  });

  describe("levels never go backwards", () => {
    it("is non-decreasing as points accumulate", () => {
      let previous = 0;
      for (let total = 0; total <= 3500; total++) {
        const { level } = getLevelProgress(total);
        expect(level).toBeGreaterThanOrEqual(previous);
        previous = level;
      }
    });
  });

  describe("totals that should never occur", () => {
    it("treats a negative total as the starting level", () => {
      expect(getLevelProgress(-10).level).toBe(1);
      expect(getLevelProgress(-10).pointsIntoLevel).toBe(0);
    });

    it("treats a non-finite total as the starting level", () => {
      expect(getLevelProgress(Number.NaN).level).toBe(1);
      expect(getLevelProgress(Number.POSITIVE_INFINITY).level).toBe(1);
    });

    it("ignores a fractional part rather than reporting a fractional level", () => {
      expect(getLevelProgress(149.9).level).toBe(2);
      expect(getLevelProgress(150.9).level).toBe(3);
      expect(getLevelProgress(150.9).pointsIntoLevel).toBe(0);
    });
  });
});
