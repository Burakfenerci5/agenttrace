/**
 * The shared data pipeline: discover → parse → correlate.
 *
 * Both entry points — the developer CLI (cli.ts) and the desktop app
 * (desktop/main) — call loadSessions() so there is exactly one source of truth
 * for how a transcript becomes a fully-correlated Session.
 */
import { findTranscripts } from "./discover.ts";
import { parseTranscript } from "./parse.ts";
import { correlate } from "./correlate.ts";
import { readGroups } from "./groups.ts";
import type { Session } from "./types.ts";

/** Load, parse, and correlate every transcript on disk. */
export function loadSessions(): Session[] {
  // Read user title overrides once, then apply per session so a renamed
  // session shows its custom title everywhere (dashboard, CLI, search).
  const { titles } = readGroups();
  return findTranscripts().map((path) => {
    const session = parseTranscript(path);
    session.outcome = correlate(session);
    const custom = titles[session.id];
    if (custom) session.title = custom;
    return session;
  });
}
