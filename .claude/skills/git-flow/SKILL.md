---
name: git-flow
description: Stage, commit, and push changes in the AgentTrace / rAIse Labs repos following this project's conventions. Use when asked to commit, push, split changes into logical commits, or open a PR. Encodes the co-author trailer, commit-message style, and the confirm-before-push rule.
---

# Git flow

How git is done across these repos (`agenttrace`, `actionproof`, `rAIseLabs`).
All use `main` as the default branch and `https://github.com/Burakfenerci5/...`.

## Golden rules (do not skip)

1. **Commit or push ONLY when the user asks.** Never auto-push.
2. **Pushing is a high-consequence action — confirm first** unless the user
   already said to push in this turn. Same for tags/releases. (See the
   `shell.exec` review policy: pause before anything that pushes, deploys,
   deletes data, or moves money.)
3. **Verify before you commit:** `npm run typecheck && npm test` must be green.
4. **Never commit secrets or build artifacts.** `dist/`, `desktop/core.cjs`,
   `desktop/release/`, `node_modules/`, and any `.env` are gitignored — keep it
   that way. If `git status` shows one staged, stop and remove it.
5. **Stage explicitly.** Prefer `git add <paths>` over `git add -A` so unrelated
   in-progress files (e.g. someone else's edit) aren't swept in. This session
   deliberately left an unrelated `about/page.tsx` change unstaged.

## Commit message style

- Imperative, specific subject line (~50–72 chars): what changed and why.
  Examples from history: `Harden the local server and ship a notarized macOS app`,
  `Ship built JS to npm so \`npx agenttrace\` works`, `Rename npm package to agenttrace-cli`.
- Body: wrap ~72 cols, explain the *why* and any non-obvious tradeoff.
- **Always end commit messages with this trailer:**

  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  ```

## Standard commit (heredoc keeps the trailer + wrapping intact)

```bash
cd /Users/bfenercioglu/Documents/agenttrace
git add src/foo.ts test/foo.test.ts        # explicit paths
git commit -q -F - <<'EOF'
Short imperative subject

Body explaining the change and why it was made.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
git log --oneline -1
```

## Splitting mixed work into logical commits

When one working tree holds two distinct changes (this session split feature
work from hardening), commit them separately so history is reviewable:
stage only the first change's paths → commit → stage the rest → commit.
For a file that mixes both, reduce it to one state, commit, restore the other
state, commit. **Typecheck + test at each intermediate state** so no commit is
broken. Confirm each committed diff contains only its intended change
(`git diff --cached <file> | grep <marker>`).

## Pushing (only after explicit go-ahead)

```bash
git push origin main
git status -sb | head -1     # confirm "main...origin/main" with no ahead/behind
```

If not on `main` and the change is substantial, branch first, then open a PR
with `gh`:

```bash
git checkout -b feat/thing
git push -u origin feat/thing
gh pr create --title "..." --body "$(cat <<'EOF'
Summary of the change.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

## Releases (GitHub) — high-consequence, confirm first

Assets (e.g. `.dmg`) attach to a tagged release; they are gitignored, not committed:

```bash
gh release upload v0.1.0 desktop/release/AgentTrace-0.1.0-arm64.dmg --clobber
gh release view v0.1.0 --json assets --jq '.assets[].name'
```
