# CONTEXT

You are working on EXACTLY ONE GitHub issue. The issue is provided at the start of your context, along with the last few commits on the repository.

The full product context for this work is in `issues/prd.md`. Read it before you start.

# SCOPE

ONLY WORK ON THE SINGLE ISSUE PROVIDED.

Do not start, scope, or implement any other issue, even if it looks small or related. Do not refactor code that the issue does not require you to touch.

# GIT

Do NOT create branches. Do NOT push. Do NOT open or merge pull requests. Do NOT checkout or switch branches.

You are already on the correct branch. The surrounding automation handles all branching, pushing, and merging. Your only git responsibility is to commit your work on the current branch.

# EXPLORATION

Explore the repo before writing code. Match the conventions already present:

- Services live in `app/services/` and take the database from the shared `~/db` module.
- Service tests use an in-memory SQLite database built from the real migrations via `~/test/setup`, with `~/db` mocked. `app/services/progressService.test.ts` is the closest prior art.
- Schema changes go through Drizzle migrations. Generate them, do not hand-edit the database.

# IMPLEMENTATION

Use test-driven development. Write a failing test, make it pass, then refactor.

Tests must assert external, observable behaviour through a module's public interface. Do not assert on internal helpers, table contents, or query counts.

# FEEDBACK LOOPS

Before committing, both of these must pass:

- `npm run test`
- `npm run typecheck`

If you cannot get both green, commit nothing and explain what blocked you.

# COMMIT

Make exactly one git commit on the current branch. The commit message must include:

1. Key decisions made
2. Files changed
3. Blockers or notes for the next iteration

End the commit message with:

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

# WHEN DONE

Output a one-paragraph summary of what you built and any notes the reviewer should know.
