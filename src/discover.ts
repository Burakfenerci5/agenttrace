/**
 * Find Claude Code session transcripts on disk.
 *
 * Layout: ~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl
 * (override the root with CLAUDE_HOME for testing).
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, readdirSync, statSync } from "node:fs";

export function claudeProjectsRoot(): string {
  const base = process.env.CLAUDE_HOME ?? join(homedir(), ".claude");
  return join(base, "projects");
}

/** Return absolute paths to every session transcript, newest first. */
export function findTranscripts(root = claudeProjectsRoot()): string[] {
  if (!existsSync(root)) return [];
  const out: { path: string; mtime: number }[] = [];
  for (const projectDir of readdirSync(root)) {
    const dir = join(root, projectDir);
    let entries: string[];
    try {
      if (!statSync(dir).isDirectory()) continue;
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const f of entries) {
      if (!f.endsWith(".jsonl")) continue;
      const p = join(dir, f);
      try {
        out.push({ path: p, mtime: statSync(p).mtimeMs });
      } catch {
        /* ignore unreadable */
      }
    }
  }
  out.sort((a, b) => b.mtime - a.mtime);
  return out.map((x) => x.path);
}
