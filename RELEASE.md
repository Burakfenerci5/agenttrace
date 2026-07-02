# Release checklist

## Done — v0.1.0 (2026-07-01)
- [x] Typecheck clean (`npm run typecheck`)
- [x] Tests pass (`npm test` — 16 tests)
- [x] README, LICENSE, .gitignore
- [x] `package.json` publishable (files/keywords/repository, `prepublishOnly` runs typecheck+test)
- [x] Git repo initialized, committed
- [x] Public GitHub repo: https://github.com/Burakfenerci5/agenttrace
- [x] Topics added, `v0.1.0` tag + GitHub Release published

## Pending — npm publish
Blocked on npm auth: `npm whoami` currently returns **401** (the token in `~/.npmrc`
is expired/invalid). To publish:

```bash
npm login                 # re-authenticate (fixes the 401)
npm whoami                # confirm you're logged in
npm publish --access public
```

Notes:
- The name `agenttrace` is **available** on npm (verified 2026-07-01).
- `prepublishOnly` will re-run typecheck + tests before the publish goes out.
- **`min-release-age=7`** in your `~/.npmrc` is your supply-chain protection — after a
  successful publish, `npx agenttrace` won't install on *your own* machine for 7 days.
  To test immediately after publishing: `npm_config_min_release_age=0 npx agenttrace`.

## Cutting the next version
1. Bump `version` in `package.json`.
2. `git commit -am "vX.Y.Z" && git tag vX.Y.Z && git push --follow-tags`
3. `gh release create vX.Y.Z --generate-notes`
4. `npm publish` (if publishing to npm).
