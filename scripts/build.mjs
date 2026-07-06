/**
 * Build the publishable CLI bundle: compile src/cli.ts (which uses .ts import
 * specifiers and relies on Node's on-the-fly type-stripping) into a single
 * plain-JS file at dist/cli.js.
 *
 * Why this exists: locally you can `node src/cli.ts` because Node strips types
 * for files you run directly. But Node REFUSES to strip types for files inside
 * node_modules — so a published .ts `bin` crashes the instant a user runs
 * `npx agenttrace`. Publishing built JS is the fix. This is a build-time step
 * only; the package ships zero RUNTIME dependencies (everything is bundled and
 * node builtins stay external).
 */
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

await build({
  entryPoints: [join(root, "src", "cli.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  outfile: join(root, "dist", "cli.js"),
  // esbuild preserves the entry file's shebang (#!/usr/bin/env node) at the top
  // of the bundle on its own, so the installed bin is directly executable — do
  // NOT add a banner shebang here or it lands twice and breaks parsing.
  logLevel: "info",
});

console.log("✓ built dist/cli.js");
