/**
 * Build the desktop core bundle: compile the TypeScript core (which uses .ts
 * import specifiers and Node 26 type-stripping) into a single CommonJS file
 * Electron's bundled Node can require directly.
 *
 * We deliberately keep `electron` and node builtins external. Everything under
 * src/ is pure Node + zero runtime deps, so the bundle is small and self-contained.
 */
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const desktop = join(here, "..");

await build({
  entryPoints: [join(desktop, "entry.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  outfile: join(desktop, "core.cjs"),
  // Electron provides its own Node; keep builtins external.
  external: ["electron"],
  logLevel: "info",
});

console.log("✓ built desktop/core.cjs");
