---
name: test-runner
description: Run the AgentTrace test suite (node:test over TypeScript). Use when asked to run tests, verify a change, check the suite is green, or before committing/publishing. Covers the CLI/core package (repo root) and the desktop app.
---

# Test runner

AgentTrace uses the built-in **`node:test`** runner over TypeScript sources
executed directly by Node's type-stripping (no separate compile step for tests).
There is **one runtime dependency: none** — tests use only the Node standard library.

## Where to run

- **CLI / core package** — repo root (`/Users/bfenercioglu/Documents/agenttrace`).
  This is the default; almost every test lives in `test/*.test.ts`.
- **ActionProof** (sibling repo, if asked) — `/Users/bfenercioglu/Documents/actionproof`,
  tests live in `src/*.test.ts`.

## Run the whole suite (default)

From the repo root:

```bash
npm test
```

This runs `node --test "test/**/*.test.ts"` (see `package.json` scripts). Expect
a summary ending in `pass <N>` / `fail 0`. As of this writing the suite is **37 tests**.

## Run a single test file

```bash
node --test test/security.test.ts
```

## Run tests matching a name

```bash
node --test --test-name-pattern "survival" "test/**/*.test.ts"
```

## Important conventions (do not break these)

- **Tests that touch stores redirect `HOME` to a temp dir BEFORE importing the
  module under test**, so the real `~/.agenttrace/*.json` is never mutated. See
  `test/groups.test.ts` for the pattern (`mkdtempSync` → `process.env.HOME = ...`
  → dynamic `await import(...)`). Preserve this when adding store tests.
- If a test must run against real data, **back up `~/.agenttrace/*.json` first**
  and restore it after (`cp ~/.agenttrace/*.json /tmp/backup/`).
- Requires **Node ≥ 23.6** locally (type-stripping runs the `.ts` files directly).

## Verify before commit / publish

The publish gate already chains everything:

```bash
npm run typecheck && npm test    # what prepublishOnly runs (plus build)
```

If tests fail, report the failing test name and the assertion output verbatim —
do not summarize a failure as "some tests failed."
