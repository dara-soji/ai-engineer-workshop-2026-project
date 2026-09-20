import { backfillPointsLedger } from "../app/services/pointsBackfillService";

// ─── Points Backfill Script ───
// Converts the history that existed before gamification shipped into ledger
// entries. Run it at release, check the numbers, and run it again if you like:
// the ledger's unique index makes a second run a no-op, so it reports zeros
// rather than paying anyone twice.
//
//   npm run db:backfill-points

const summary = backfillPointsLedger();

console.log("Backfilled the points ledger:");
console.log(`  lesson completions: ${summary.lessonsAwarded}`);
console.log(`  quiz passes:        ${summary.quizzesAwarded}`);
console.log(`  course completions: ${summary.coursesAwarded}`);
console.log(`  points awarded:     ${summary.pointsAwarded}`);

if (summary.pointsAwarded === 0) {
  console.log("Nothing new to convert — every entry was already in the ledger.");
}
