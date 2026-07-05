# AgentTrace for Mac

The desktop app — AgentTrace in a native window, for people who don't live in a
terminal. It's a thin Electron shell: it boots the same local server the CLI uses
(`src/dashboard.ts`) on a random loopback port and loads it in a window. No rewrite,
no cloud — your Claude Code transcripts never leave your machine.

## Why a download (and not a web app)

AgentTrace reads `~/.claude/projects` from your local disk. A browser tab is sandboxed
and can't do that, and uploading transcripts to a server would break the local-first,
zero-telemetry promise. So the app is a download by design.

## Develop

```bash
cd desktop
npm install          # electron, electron-builder, esbuild
npm start            # bundle the core + launch the app
```

`npm start` runs `scripts/build.mjs`, which uses esbuild to bundle the TypeScript core
(`src/`, which relies on Node 26 type-stripping and `.ts` import specifiers) into a single
`core.cjs` that Electron's bundled Node can `require`.

## Build a distributable

```bash
npm run dist         # builds signed-adhoc .dmg for arm64 + x64 into release/
npm run dist:dir     # unpacked .app only (faster, for local testing)
```

Outputs land in `release/`:
- `AgentTrace-<version>-arm64.dmg` — Apple Silicon
- `AgentTrace-<version>.dmg` — Intel

## Signing / notarization

v1 ships **unsigned** (ad-hoc signature only). On first launch users must right-click the
app → **Open** to get past Gatekeeper's "unidentified developer" warning. To ship a
clean double-click install later, add an Apple Developer ID and set
`CSC_LINK`/`CSC_KEY_PASSWORD` + notarization credentials — electron-builder will pick them
up and the `skipped macOS notarization` step becomes a real notarize.

## Architecture

```
desktop/
  main.js            Electron main process — free port → serve() → load window
  entry.ts           bundle entry: re-exports serve + loadSessions from ../src
  scripts/build.mjs  esbuild: src/*.ts → core.cjs
  assets/icon.svg    app icon source (reuses the dashboard's trace/node mark)
  package.json       electron + electron-builder config
```

The core in `../src` stays zero-dependency and unchanged; all the heavy app tooling
lives here so the CLI and the published `agenttrace` npm package remain lean.
