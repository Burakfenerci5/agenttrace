/**
 * Bundle entry for the desktop app. Re-exports exactly what the Electron main
 * process needs from the core, so esbuild can produce a single core.cjs.
 */
export { serve } from "../src/dashboard.ts";
export { loadSessions } from "../src/core.ts";
