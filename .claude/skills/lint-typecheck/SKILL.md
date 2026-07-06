---
name: lint-typecheck
description: Type-check the AgentTrace codebase with tsc. Use when asked to lint, typecheck, verify types compile, or before committing/publishing. Covers the CLI/core package (repo root) and the desktop app.
---

# Lint / typecheck

AgentTrace's quality gate is **TypeScript type-checking** (`tsc --noEmit`). There
is no separate ESLint config in the CLI/core repo — `tsc` in `strict` mode is the
lint. (The rAIse Labs website repo, if you're there, additionally has `next lint`.)

## Where to run

- **CLI / core package** — repo root (`/Users/bfenercioglu/Documents/agenttrace`).
- **ActionProof** (sibling) — `/Users/bfenercioglu/Documents/actionproof`.

## Typecheck the core package (default)

From the repo root:

```bash
npm run typecheck
```

This runs `tsc --noEmit` against `tsconfig.json` (`strict: true`,
`allowImportingTsExtensions: true`, includes `src/**/*.ts`). A clean run prints
**nothing** and exits 0. Any output is an error to fix — read the `file:line`
and address it; do not ignore.

## ActionProof

```bash
cd /Users/bfenercioglu/Documents/actionproof && npm run typecheck
# → tsc --noEmit --allowImportingTsExtensions
```

## rAIse Labs website (Next.js)

```bash
cd /Users/bfenercioglu/Documents/rAIseLabs
npm run typecheck   # tsc --noEmit
npm run lint        # next lint (ESLint) — only exists here
```

## Notes

- `tsconfig.json` includes only `src/**/*.ts`, so **test files are type-checked
  when run** (via `node --test`), not by `npm run typecheck`. To type-check a
  quick change in `test/`, run the test file.
- Always typecheck **before** committing or publishing. The publish gate is
  `npm run typecheck && npm test && npm run build` (`prepublishOnly`).
- Report the exact `tsc` error text if it fails; never claim "typecheck passed"
  without having seen a clean (empty) run.
