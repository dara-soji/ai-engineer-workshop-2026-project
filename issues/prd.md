# PRD: Gamification — Points, Levels, and Streaks

**Source:** `client-brief.md` — Sarah Chen (VP Product), #product-requests
**Status:** Ready for breakdown into tickets

## Problem Statement

Students sign up for Cadence courses, complete a few lessons, and drop off. Retention is poor.

The root cause, in Sarah's framing, is that the platform gives students **no sense of accumulated progress**. Completing a lesson flips a checkbox and nothing else changes. Nothing carries across lessons, nothing carries across courses, and nothing acknowledges consistency of effort. One student summarised it: *"I finished 40 lessons and I have nothing to show for it."*

Two further gaps compound this:

- **Quizzes have no incentive.** A student who skips every quiz has an identical-looking profile to one who passes them all. There is no reason to do them.
- **There is no reward for showing up daily.** Sarah cites evidence that students who complete one lesson a day for a week are 3x more likely to finish a course, but nothing in the product encourages or even notices that behaviour.

Cadence's students are working professionals. Whatever we build must feel like a private record of their own effort — **not a competition**. Leaderboards, rankings, and peer comparison are explicitly unwanted.

## Solution

Give every student a private, always-visible record of their accumulated effort, made of three connected parts:

1. **Points** — earned for completing lessons, passing quizzes, finishing courses, and sustaining streaks. Points only ever accumulate; they are never spent or lost.
2. **Levels** — milestones derived from the points total, so there is always a visible "next thing to reach" and a sense of distance travelled.
3. **Streaks** — a count of consecutive days on which the student completed at least one lesson, creating a daily reason to return.

Every point a student has ever earned is recorded as an individual event, so the system can answer "what did I just earn?" and "what have I earned this week?", not merely "what is my total?".

Crucially, this launches with **history intact**. Existing students' completed lessons, passed quizzes, and finished courses are converted into points on release, so the student with 40 completed lessons opens the dashboard and sees those 40 lessons already counted. The feature is meaningful on day one to exactly the students most at risk of churning.

Nothing about the system is comparative. A student sees only their own points, their own level, and their own streak.

## User Stories

### Earning points

1. As a student, I want to earn points when I complete a lesson, so that my progress accumulates visibly instead of vanishing into a checkbox.
2. As a student, I want to earn points when I pass a quiz, so that there is a reason to attempt quizzes rather than skip them.
3. As a student, I want a larger bonus when I finish an entire course, so that completing a course feels like a genuine achievement.
4. As a student, I want bonus points when I reach a streak milestone, so that showing up consistently is rewarded and not just noticed.
5. As a student, I want my points total to only ever go up, so that I never feel punished for taking a break.
6. As a student, I want re-taking a quiz I have already passed to not award points again, so that my total reflects real learning rather than farming.
7. As a student, I want re-completing a lesson I have already completed to not award points again, so that my total is honest.
8. As a student, I want resetting my progress on a lesson to not strip points I legitimately earned, so that experimenting with the UI is safe.

### Seeing points

9. As a student, I want to see my total points on my dashboard, so that I have a single number representing everything I have done.
10. As a student, I want to see a "+N points" confirmation the moment I complete a lesson, so that the reward is connected to the action that earned it.
11. As a student, I want to see how many points I have earned in a particular course, so that my effort is attributable to specific work rather than a single global number.
12. As a student, I want to see a history of what I earned and when, so that my total is explicable and feels trustworthy.

### Levels

13. As a student, I want to be assigned a level based on my points total, so that I have milestones to aim for rather than an unbounded number.
14. As a student, I want to see how many points remain until my next level, so that I know how close the next milestone is.
15. As a student, I want a visible celebration when I cross into a new level, so that reaching a milestone is a distinct moment and not a number quietly changing.
16. As a student, I want my level to never decrease, so that a milestone once reached stays reached.

### Streaks

17. As a student, I want my streak to increase when I complete at least one lesson on a given day, so that daily effort is recognised.
18. As a student, I want my streak visible on every page, so that it acts as a daily reminder rather than something I must go looking for.
19. As a student, I want completing several lessons in one day to count as one day of streak, so that the streak measures consistency rather than volume.
20. As a student, I want my streak to reset if I miss a day, so that the number means what I expect it to mean.
21. As a student, I want to see my longest-ever streak alongside my current one, so that a reset does not erase the evidence that I once sustained a long run.
22. As a student, I want to understand what my streak requires of me, so that I am not confused about why it broke.

### History and launch

23. As an existing student, I want my previously completed lessons to already be worth points when the feature launches, so that I am not starting from zero after months of work.
24. As an existing student, I want my previously passed quizzes and completed courses to count as well, so that the backfilled total is complete rather than partial.
25. As an existing student, I want my streak to start fresh at launch, so that I am not shown a milestone for a run nobody ever told me I was on.

### Privacy

26. As a student, I want my points, level, and streak to be visible only to me, so that learning does not become a competition with my peers.
27. As a student, I want no leaderboards or peer rankings anywhere in the product, so that the platform stays appropriate for working professionals.

### Quizzes (prefactor)

28. As a student, I want a quiz score exactly at the passing mark to count as a pass, so that I am not denied credit on a technicality.
29. As an instructor, I want the passing score I set on a quiz to actually govern pass and fail, so that the threshold I configured is the one applied.
30. As a developer, I want quiz scoring to be covered by tests, so that awarding points on top of it is safe.

## Implementation Decisions

### Points are an append-only ledger

Points are stored as **individual earning events**, not as a running total on the user record. A new `points_events` table records, for each award: the user, the amount, the reason, the kind of thing that caused it, the identifier of that thing, and when it happened.

**Rationale:** a derived-on-read total cannot answer "what did I just earn" (needed for the toast) or "what did I earn this week", and retuning the point values would silently rewrite every student's history. A cached total on the user record was rejected as a second source of truth that can drift.

**Idempotency is enforced at the database level** by a unique constraint across user, reason, source type, and source id. This is the single mechanism that makes the entire system safe:

- Re-completing a lesson cannot double-award.
- Re-passing a quiz cannot double-award.
- The backfill is re-runnable without duplicating anything.
- A retried request cannot double-award.

An award for an event that already exists is a **silent no-op, not an error** — callers should not have to handle "already awarded" as an exceptional case.

Recorded reasons: lesson completed, quiz passed, course completed, streak milestone reached.

### Levels are a pure function of points

A level is **derived**, never stored. A threshold table in code maps a points total to a level, the progress into that level, and the points remaining to the next one. There is no level column, no level-up job, and no state that can disagree with the points total.

A **level-up is detected by comparing the level before an award to the level after it** — a level-up is not a stored event but a computed difference, reported back to the caller so the UI can celebrate it. Because points never decrease, levels never decrease.

### Streaks are derived from completion dates

There is **no streak table**. The current streak is computed by taking the distinct UTC calendar dates on which the student completed a lesson and walking backwards from today while consecutive dates are present. The longest streak is the longest consecutive run across that same set of dates.

**Rationale:** the absence of a completion row *is* the break in the streak. This means no scheduled job is needed to break streaks, and there is no counter that can drift from reality.

A **day is a UTC calendar day.** No timezone is stored anywhere in the system today, and introducing one was judged out of proportion to the feature. This is a known, accepted imperfection — students far from UTC will see the day boundary fall at an odd local hour. Recorded in "Further Notes" as the most likely thing to revisit.

Multiple completions on the same date collapse to a single day, so the streak measures consistency and not volume.

**Streak milestones compose with the derived model without compromising it:** the streak itself stays derived, and only the *milestone award* is written to the ledger, keyed by the milestone's day count as its source id. The award is therefore idempotent, and there is still no streak state to keep in sync.

### Module structure

Two **pure modules**, with no database access:

- A **points rules** module holding the entire earning table as pure functions — the point value of a lesson, of a quiz pass, of a course completion, and of each streak milestone. Nothing else in the system hardcodes a point value; this is the single tuning surface.
- A **levels** module exposing a single function from points total to level, progress within the level, and points to the next.

Two **data modules**:

- A **points ledger** module owning the `points_events` table: an idempotent award operation, plus reads for the total, the recent history, and the total attributable to a given course.
- A **streak** module exposing the current streak, the longest streak, and the last active date for a student, and encapsulating all UTC day-bucketing so no other module does date arithmetic.

One **orchestrator**:

- A **gamification service** is the only module the routes call. Recording a lesson completion awards the lesson points, determines whether that completion finished the course and awards the bonus if so, checks whether a streak milestone was reached, and returns a summary of **what was just earned and whether a level was crossed**. Routes never touch the ledger, the rules, the levels, or the streak module directly.

This keeps the seam narrow: the lesson route's action gains a single call, and everything the UI needs to celebrate comes back from that one call.

### Quiz scoring prefactor (must land first)

The existing quiz scoring service is in the direct path of quiz points and is not currently safe to build on. Before any quiz points work:

- **It opens its own database connection at module scope**, pointing at the live database file. This bypasses the dependency injection every other service uses, and is why it is the only service in the codebase with no tests. It must be routed through the shared database module so it can be tested in isolation.
- **Grade thresholds are duplicated in five places.** These consolidate to one source of truth.
- **The passing score configured on the quiz is ignored**, in favour of a hardcoded threshold. The configured value must govern.
- **A score exactly at the passing mark is recorded as a failure** while simultaneously being graded as a pass. The comparison must be inclusive.

The last two are behaviour changes, accepted deliberately: they are bugs, they sit directly under the quiz points feature, and fixing them while the module is open is cheaper than fixing them later. Some historic attempts recorded as failures would be passes under the corrected rule.

Quiz points key off a **passing attempt**, awarded once per quiz regardless of how many attempts it takes or how the score improves on re-takes.

### Backfill

A re-runnable backfill converts existing history into ledger entries on release: completed lessons, passed quiz attempts, and completed enrolments. The unique constraint makes re-running it harmless.

**Streak milestones are not backfilled.** Points for past work are owed to the student; a bonus for a 30-day run they were never told they were on is not meaningful. Streaks begin accruing at launch.

Backfilled entries carry the original completion timestamp, not the backfill time, so the history reads correctly.

### UI surfaces

- **Dashboard** — points total, current level with progress to the next, and current and longest streak.
- **Sidebar** — a persistent streak indicator, visible on every page. This is what converts the streak from a statistic into a daily habit.
- **Lesson completion** — a "+N points" toast on completion, and a distinct celebration when a level is crossed. The toast consumes the summary returned by the orchestrator. The toast library is already a project dependency.
- **Dashboard course cards** — points earned per course, so effort is attributable to specific courses.

No screen anywhere displays another student's points, level, or streak.

## Testing Decisions

### What makes a good test here

Tests assert **external, observable behaviour** through each module's public interface — the points a student ends up with, the streak reported for a set of completion dates, the level returned for a total. They do not assert on table contents directly, on the number of queries issued, or on internal helper functions.

The established convention in this codebase is followed: a fresh in-memory SQLite database per test, built by running the **real migrations** so test and production schemas cannot drift, with the shared database module swapped for the test instance. The existing progress service tests are the closest prior art and the pattern to copy; the enrollment and purchase service tests are equivalent references.

### Modules under test

**All five** modules are tested.

- **Points rules and levels** — pure function tests with no database. These pin every tunable number and, importantly, every **threshold boundary**: the exact points total at which a level begins, and one point either side of it.
- **Points ledger** — idempotency is the entire contract and the failure mode is silent, so it is tested directly: awarding the same event twice leaves one row and one total; distinct events accumulate; per-course totals attribute correctly.
- **Streak service** — the module most likely to hide an off-by-one, and tested hardest. Consecutive days build a streak; a gap breaks it; two completions on one date count once; a completion today versus only yesterday; longest streak survives a later break; a student with no completions reports zero rather than failing.
- **Gamification service** — integration-level tests through the orchestrator's interface: a lesson completion awards the right points and reports them back; the course bonus fires exactly once when the final lesson lands; a repeated completion awards nothing the second time; a level crossing is reported when and only when a threshold is passed.

**Quiz scoring** gains tests as part of the prefactor, which is the point of doing the prefactor. Coverage includes the corrected boundary — a score exactly at the configured passing mark passes — and that the quiz's own configured threshold governs rather than a hardcoded one.

The backfill is verified by asserting it is re-runnable: running it twice produces the same totals as running it once.

## Out of Scope

- **Leaderboards, rankings, peer comparison, or any social or competitive surface.** Explicitly ruled out by the brief and not to be reintroduced in any form.
- **Badges or achievements** beyond levels and streak milestones.
- **Spending points.** Points accumulate permanently; there is no store, redemption, or currency behaviour.
- **Per-user timezones.** Streak days are UTC. Introducing a stored timezone, a capture flow, and a settings surface is a larger change than this feature justifies.
- **Streak freezes, grace days, or repair mechanics.** A missed day breaks the streak.
- **Notifications or email** reminding students that a streak is at risk. Plausible follow-up, not in this scope.
- **Instructor or admin visibility** into student points, levels, or streaks.
- **Points for partial engagement** — starting a lesson, watching video, or failing a quiz earns nothing.
- **Retroactive streak milestone awards.**
- **Configurable point values per course or per instructor.** Values are global and live in code.
- **A full rewrite of quiz scoring.** The prefactor is scoped to what makes quiz points safe to build.

## Further Notes

**The UTC day boundary is the most likely thing to need revisiting.** It is the one accepted compromise in the design. If students outside European timezones report confusion about when their streak day resets, the fix is a stored per-user timezone — and the streak module is deliberately the only place that does date arithmetic, so that change is contained to one module.

**The prefactor's behaviour change should be communicated.** Correcting the passing-mark comparison means some quiz attempts previously recorded as failures are passes under the new rule. Backfilled quiz points will use the corrected rule, so a student who scored exactly the passing mark will receive points for a quiz the old system said they failed. This is the right outcome, but it is a visible change and Sarah should know before release rather than after.

**Point values are a product decision, not an engineering one.** The rules module exists so those numbers can be tuned without touching anything else. Expect the first set of values to be wrong and to be adjusted once real data arrives; the ledger records what was actually awarded, so past totals are unaffected by retuning.

**Success is measurable.** The brief's premise is that daily-habit students are 3x more likely to finish a course. Because the ledger records timestamped events, the retention effect of this feature is measurable after launch without further instrumentation.
