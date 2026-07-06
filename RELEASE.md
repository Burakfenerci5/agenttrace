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

## Security hardening (2026-07-05)
Both surfaces were hardened before deploy. All 37 tests pass; the guards were
verified live and against a signed `--dir` build.

**CLI / dashboard server (`src/dashboard.ts`)**
- Strict **Content-Security-Policy** + `X-Content-Type-Options`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`, and cross-origin isolation headers on every
  response (single choke point wrapping `writeHead`). The UI ships no external
  assets and no `eval`, so CSP is `default-src 'none'` with `'unsafe-inline'`
  only for the inline script/style; `connect-src 'self'` blocks exfiltration,
  `frame-ancestors 'none'` blocks clickjacking.
- **Request-body cap** (`MAX_BODY_BYTES` = 1 MiB) on all four POST readers →
  `413` instead of unbounded memory growth (`readBody`).
- **Socket-level loopback assertion** behind the existing Host/Origin DNS-rebind
  + CSRF guard.
- **`/api/launch` cwd validation** (`isLaunchableCwd`): absolute, existing
  directory only, no NUL bytes — defense in depth on top of `shellQuote`.

**Desktop app (`desktop/`)**
- Renderer runs with `sandbox: true`, `contextIsolation`, no `nodeIntegration`,
  `webSecurity` on.
- `web-contents-created` hardening: navigation pinned to the app's own loopback
  origin (`will-navigate` guard), external links opened via the OS browser only
  for `http(s)`/`mailto`, webviews blocked, single-instance lock.
- **Hardened runtime + entitlements** (`build/entitlements.mac.plist`) and an
  `afterSign` **notarize hook** (`scripts/notarize.cjs`) that no-ops until Apple
  credentials are set — the local build keeps working today.

## Notarizing the .dmg (LIVE as of 2026-07-05)
Signing identity: **Developer ID Application: Burak Fenercioglu (DLGZKZV4KN)**.
The app and both `.dmg`s (arm64 + x64) are Developer-ID signed, hardened-runtime,
notarized by Apple, and stapled — `spctl` accepts them as "Notarized Developer ID".

Two electron-builder hooks make this automatic:
- `afterSign` → `scripts/notarize.cjs` notarizes the **.app**.
- `afterAllArtifactBuild` → `scripts/staple-dmg.cjs` notarizes + staples each
  **.dmg** container (electron-builder builds the DMG after signing, so the
  container needs its own ticket or `spctl -t install` rejects it on download).

Both hooks **no-op unless** these three env vars are set, so local `--dir` builds
still work without credentials:
```bash
export APPLE_ID=alpfenercioglu@gmail.com
export APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx   # appleid.apple.com → App-Specific Passwords (shown once)
export APPLE_TEAM_ID=DLGZKZV4KN
cd desktop && npm run dist        # build + sign + notarize app AND dmgs + staple
```

Verify a built artifact before shipping:
```bash
codesign --verify --deep --strict release/mac-arm64/AgentTrace.app
spctl -a -t install release/AgentTrace-0.1.0-arm64.dmg   # → accepted, Notarized Developer ID
xcrun stapler validate release/AgentTrace-0.1.0-arm64.dmg
```

> Notarization can sit "In Progress" on Apple's side for 20–40 min; the build
> parks on `notarytool --wait` and resumes automatically. Check status with:
> `xcrun notarytool history --apple-id "$APPLE_ID" --password "$APPLE_APP_SPECIFIC_PASSWORD" --team-id "$APPLE_TEAM_ID"`
>
> **Rotate the app-specific password** if it was ever exposed — revoke it at
> appleid.apple.com → Sign-In & Security → App-Specific Passwords.

## Cutting the next version
1. Bump `version` in `package.json` (and `desktop/package.json` for the app).
2. `git commit -am "vX.Y.Z" && git tag vX.Y.Z && git push --follow-tags`
3. `gh release create vX.Y.Z --generate-notes`
4. `npm publish` (if publishing to npm).
5. `cd desktop && npm run dist`, then attach the notarized `.dmg` to the release.
