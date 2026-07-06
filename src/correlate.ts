/**
 * Correlate a parsed session with git history to label its OUTCOME.
 *
 * This is the differentiator: turning a session into a plain-English verdict on
 * whether its work actually stuck. We attribute commits to a session when they
 * land in the session's repo(s), within (or after) its time window, and touch
 * files the session edited. Then we check whether those commits are still on HEAD.
 *
 * When the changed files aren't in a git repo at all (common — many project
 * folders aren't repos), we fall back to a disk-existence check so the outcome
 * is still meaningful rather than a shrug ("untracked", not "unknown").
 *
 * Heuristic, not cryptographic — that precision is exactly what the ActionProof
 * layer adds later. Here we optimize for a useful, explainable label.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, relative } from "node:path";

import type { Session, Outcome } from "./types.ts";

/**
 * Grace window (minutes) after a session ends during which a commit still counts
 * as "this session's work". Devs frequently commit well after the agent stops —
 * a tight 30-min window misses those, so we widen it substantially. Exact
 * repo-relative path matching (below) keeps a wide window from over-attributing.
 */
const GRACE_MIN = 12 * 60;

function git(cwd: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 8 * 1024 * 1024,
    }).trim();
  } catch {
    return null;
  }
}

/** The git repo root that contains a file, or null if it's not in a repo. */
function repoRootForFile(filePath: string): string | null {
  return git(dirname(filePath), ["rev-parse", "--show-toplevel"]);
}

/**
 * Group a session's changed files by the git repo that actually contains them.
 * Real agent sessions edit files across multiple repos, and the session's own
 * cwd is often not a repo at all — so we resolve each file to its true repo.
 * Files not in any repo are returned separately for the disk-based fallback.
 */
function partitionByRepo(session: Session): {
  byRepo: Map<string, string[]>;
  looseFiles: string[];
} {
  const byRepo = new Map<string, string[]>();
  const looseFiles: string[] = [];
  // Cache repo lookups per directory — many files share a directory.
  const dirRepo = new Map<string, string | null>();
  for (const f of session.filesChanged) {
    const dir = dirname(f.path);
    let root = dirRepo.get(dir);
    if (root === undefined) {
      root = repoRootForFile(f.path);
      dirRepo.set(dir, root);
    }
    if (root) {
      const list = byRepo.get(root) ?? [];
      list.push(f.path);
      byRepo.set(root, list);
    } else {
      looseFiles.push(f.path);
    }
  }
  return { byRepo, looseFiles };
}

interface Commit {
  hash: string;
  subject: string;
  ts: string;
  files: string[];
}

/** Commits in a time window (with a grace period after session end). */
function commitsInWindow(cwd: string, startISO: string, endISO: string): Commit[] {
  const since = new Date(startISO);
  const until = new Date(new Date(endISO).getTime() + GRACE_MIN * 60_000);
  const log = git(cwd, [
    "log",
    `--since=${since.toISOString()}`,
    `--until=${until.toISOString()}`,
    "--pretty=format:%H%x1f%s%x1f%cI",
    "--name-only",
    "-z",
  ]);
  if (!log) return [];

  // With `--name-only -z`, git emits NUL-separated fields. Each commit is:
  //   <header>\n<file>\0<file>\0...\0   and the NEXT commit's header follows.
  // So the whole stream is NUL-delimited tokens; a token that contains "\x1f"
  // (our field separator) OR embeds a newline starts a new commit record.
  const tokens = log.split("\0");
  const commits: Commit[] = [];
  let current: Commit | null = null;

  for (const tok of tokens) {
    if (tok === "") continue;
    const nl = tok.indexOf("\n");
    const looksLikeHeader = tok.includes("\x1f");
    if (looksLikeHeader) {
      // The token may be "HEADER\nfirstfile" (git packs the first filename onto
      // the header line via the trailing newline). Split header from first file.
      const headerLine = nl >= 0 ? tok.slice(0, nl) : tok;
      const [hash, subject, ts] = headerLine.split("\x1f");
      current = { hash, subject: subject ?? "", ts: ts ?? "", files: [] };
      commits.push(current);
      const firstFile = nl >= 0 ? tok.slice(nl + 1) : "";
      if (firstFile) current.files.push(firstFile);
    } else if (current) {
      // Subsequent NUL-separated tokens are filenames for the current commit.
      // (Guard against a stray leading newline.)
      const file = nl >= 0 ? tok.slice(nl + 1) : tok;
      if (file) current.files.push(file);
    }
  }
  return commits.filter((c) => c.hash);
}

/**
 * Does a commit touch any file this session edited *in this repo*?
 * We match on exact repo-relative paths (git paths ARE repo-relative), which is
 * far more precise than basename matching — precise enough that we can safely
 * use a wide time window without over-attributing unrelated commits.
 */
function commitTouchesSessionFile(
  commitFiles: string[],
  sessionRelPaths: Set<string>,
): boolean {
  return commitFiles.some((cf) => sessionRelPaths.has(cf));
}

export function correlate(session: Session): Outcome {
  if (session.filesChanged.length === 0) {
    return { label: "no-changes", commits: [], reason: "Session made no file edits." };
  }
  if (!session.startedAt || !session.endedAt) {
    return { label: "unknown", commits: [], reason: "Session has no timestamps to correlate." };
  }

  const { byRepo, looseFiles } = partitionByRepo(session);

  // --- Case 1: no changed file is in any git repo → disk-existence fallback. ---
  if (byRepo.size === 0) {
    const present = looseFiles.filter((p) => existsSync(p)).length;
    const total = looseFiles.length;
    return {
      label: "untracked",
      commits: [],
      filesOnDisk: { present, total },
      reason:
        `Changed files aren't in a git repository; ${present}/${total} still ` +
        `exist on disk. (Not version-controlled, so we can't confirm they were kept.)`,
    };
  }

  const endMs = new Date(session.endedAt).getTime();
  const allCommits: Outcome["commits"] = [];
  let anyReverted = false;
  let anyKept = false;
  let committedLater = 0;

  for (const [repoRoot, repoFiles] of byRepo) {
    // Session file paths are absolute; convert to this repo's relative paths.
    const relPaths = new Set(repoFiles.map((f) => relative(repoRoot, f)));
    const attributed = commitsInWindow(
      repoRoot,
      session.startedAt,
      session.endedAt,
    ).filter((c) => commitTouchesSessionFile(c.files, relPaths));

    for (const c of attributed) {
      allCommits.push({ hash: c.hash, subject: c.subject, ts: c.ts });
      if (c.ts && new Date(c.ts).getTime() > endMs) committedLater++;

      const stillReachable =
        git(repoRoot, ["merge-base", "--is-ancestor", c.hash, "HEAD"]) !== null;
      const revertedBy = git(repoRoot, [
        "log",
        "--grep",
        `revert.*${c.hash.slice(0, 8)}`,
        "-i",
        "--pretty=format:%H",
      ]);
      if (!stillReachable || (revertedBy && revertedBy.length > 0)) {
        anyReverted = true;
      } else {
        anyKept = true;
      }
    }
  }

  // --- Case 2: files were in repos, but no commit touched them. ---
  if (allCommits.length === 0) {
    return {
      label: "uncommitted",
      commits: [],
      reason:
        "Files were edited inside a git repo but no commit in the session's window " +
        "(plus grace period) touched them. Work may be uncommitted or stashed.",
    };
  }

  // --- Case 3: reverted. ---
  if (anyReverted && !anyKept) {
    return {
      label: "reverted",
      commits: allCommits,
      committedLater,
      reason: "The session's commits were later reverted or are no longer on HEAD.",
    };
  }

  // --- Case 4: kept (the good outcome). ---
  const laterNote =
    committedLater > 0
      ? ` (${committedLater} committed after the session ended)`
      : "";
  return {
    label: "kept",
    commits: allCommits,
    committedLater,
    reason:
      `${allCommits.length} commit(s) from this session across ${byRepo.size} repo(s) ` +
      `are still in the current history${laterNote}.` +
      (anyReverted ? " Some other commits were reverted." : ""),
  };
}
