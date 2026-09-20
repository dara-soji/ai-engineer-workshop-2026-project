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
import { awardPoints, getPointsTotal } from "./pointsLedgerService";

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
  });
});
