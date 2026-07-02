/** Shared types for AgentTrace. */

/** A file the agent created or edited during a session. */
export interface FileChange {
  path: string;
  /** How many Edit/Write operations touched it. */
  edits: number;
  /** True if the session created it (first op was a Write). */
  created: boolean;
}

/** A pull request the session opened (from Claude Code's pr-link events). */
export interface SessionPR {
  number: number;
  url: string;
  repository: string;
}

/** Outcome of a session's work, correlated against git. */
export type OutcomeLabel =
  | "kept" // changes landed in a commit that still exists in history
  | "reverted" // a later commit reverted the session's work
  | "uncommitted" // in a repo, files changed but no matching commit found
  | "untracked" // files changed outside any git repo (disk-checked instead)
  | "no-changes" // session made no file edits
  | "unknown"; // correlation genuinely unavailable (no timestamps, etc.)

/**
 * Plain-language presentation of an outcome label. The internal labels are
 * precise but jargony; users just want to know "did the work land?" This maps
 * each to a short phrase + a tone for coloring, with a one-line explanation.
 */
export function outcomeDisplay(label: OutcomeLabel): {
  text: string;
  tone: "good" | "bad" | "warn" | "neutral";
  hint: string;
} {
  switch (label) {
    case "kept":
      return { text: "Landed", tone: "good", hint: "Committed to git and still in history." };
    case "reverted":
      return { text: "Reverted", tone: "bad", hint: "Committed, then undone by a later commit." };
    case "uncommitted":
      return { text: "Not committed", tone: "warn", hint: "In a git repo, but no commit captured these edits." };
    case "untracked":
      return { text: "Not in git", tone: "neutral", hint: "Files changed outside any git repository." };
    case "no-changes":
      return { text: "No edits", tone: "neutral", hint: "The agent changed no files (chat/planning only)." };
    default:
      return { text: "Unknown", tone: "neutral", hint: "Not enough information to judge." };
  }
}

export interface Outcome {
  label: OutcomeLabel;
  /** Commits attributed to this session (by time window + touched files). */
  commits: { hash: string; subject: string; ts: string }[];
  /** Human explanation of why this label was chosen. */
  reason: string;
  /** For committed work: how many attributed commits landed AFTER the session
   * ended (within the grace window) vs. during it — surfaces "committed later". */
  committedLater?: number;
  /** For untracked work: how many of the session's changed files still exist on
   * disk (a best-effort "did it stick?" when there's no git to ask). */
  filesOnDisk?: { present: number; total: number };
}

/**
 * A single agent action within a session — the unit ActionProof is designed
 * around. Each meaningful tool call (a file write, a bash command, a PR) is an
 * action that can be individually inspected and (later) cryptographically
 * verified. We keep these lightweight; the transcript remains the source of truth.
 */
export interface Action {
  /** Stable index within the session (0-based order of occurrence). */
  seq: number;
  /** Tool name, e.g. "Edit", "Write", "Bash", "Agent". */
  tool: string;
  /** Reverse-dot action type for ActionProof, e.g. "file.write", "shell.exec". */
  type: string;
  /** Human summary, e.g. "Edit src/cli.ts" or "Bash: npm test". */
  summary: string;
  /** The primary target (file path, command, url) when we can extract one. */
  target?: string;
  /** RFC 3339 timestamp of the action, when available. */
  ts?: string;
  /** True once this specific action has an ActionProof receipt. */
  verified?: boolean;
  /**
   * True for high-consequence actions we RECOMMEND verifying (state-changing
   * shell commands, deploys, pushes, payments). Leaving these unverified is the
   * risk ActionProof mitigates.
   */
  critical?: boolean;
  /** When critical, why it matters (shown as the risk of not verifying). */
  risk?: string;
}

/** Token usage and estimated cost, summed across a session's assistant turns. */
export interface Usage {
  /** Non-cached input tokens. */
  inputTokens: number;
  /** Tokens written to the prompt cache (billed at a premium). */
  cacheCreationTokens: number;
  /** Tokens read from the prompt cache (billed at a discount). */
  cacheReadTokens: number;
  outputTokens: number;
  /** Estimated USD cost from published per-model rates (best-effort). */
  estCostUsd: number;
}

/**
 * A recommendation AgentTrace surfaces to improve a session's future runs —
 * the core "make my agents better" value. Generated locally from heuristics by
 * default; an opt-in deep analysis (Claude API) can add richer ones.
 */
export interface Recommendation {
  /** Stable id (per session) so acceptance can be tracked. */
  id: string;
  kind: "skill" | "cost" | "workflow" | "quality";
  /** Short imperative title, e.g. "Add a test-runner skill". */
  title: string;
  /** Why this session triggered it. */
  detail: string;
  /** Concrete next step the developer can take. */
  action?: string;
  /**
   * A ready-to-paste prompt the developer can hand to Claude Code / Cursor to
   * actually execute the recommendation in their next session.
   */
  prompt: string;
  /** Rough impact tag for sorting/urgency. */
  impact: "high" | "medium" | "low";
  /** Estimated USD saved (or value gained) per future session if adopted. */
  estSavingsUsd: number;
  /** "heuristic" (offline) or "ai" (deep analysis). */
  source: "heuristic" | "ai";
}

/** One agent session, parsed and correlated. */
export interface Session {
  id: string;
  source: "claude-code";
  title: string;
  cwd: string;
  gitBranch?: string;
  /** First event timestamp — when the agent was spun up. */
  startedAt?: string;
  /** Last event timestamp — when the agent was last active. */
  endedAt?: string;
  /** Wall-clock minutes from first to last event. */
  durationMin?: number;
  /** Minutes since the session was last active (computed at load time). */
  idleMin?: number;
  /** True if the session looks still-active (last event within a recent window). */
  active?: boolean;
  model?: string;
  /** Count of each tool the agent invoked. */
  toolCounts: Record<string, number>;
  filesChanged: FileChange[];
  /** Ordered list of the session's meaningful actions (ActionProof's unit). */
  actions: Action[];
  prs: SessionPR[];
  userMessages: number;
  assistantMessages: number;
  /** Token usage + estimated cost for the session. */
  usage: Usage;
  outcome: Outcome;
  /** Local, offline recommendations to improve this session's future runs. */
  recommendations: Recommendation[];
  /** Absolute path to the source transcript, for drill-down. */
  transcriptPath: string;
}
