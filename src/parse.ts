/**
 * Parse a Claude Code JSONL transcript into a structured Session.
 *
 * Claude Code stores one JSONL file per session under
 * ~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl. Each line is an event;
 * the ones we care about:
 *   - assistant/user   -> message counts, model, timing
 *   - ai-title         -> human-readable session title
 *   - tool_use blocks  -> what the agent did (Bash/Edit/Write/...)
 *   - Edit/Write inputs-> files changed
 *   - pr-link          -> PRs the session opened
 *   - cwd / gitBranch  -> where it ran (for git correlation)
 *
 * We deliberately do NOT read message text content here (privacy + size); the
 * dashboard reads the raw transcript on demand for drill-down.
 */
import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";

import type { FileChange, SessionPR, Session, Usage, Action } from "./types.ts";
import { recommend } from "./recommend.ts";

/**
 * Per-million-token USD rates by model family, used for a best-effort cost
 * estimate. Order matters: the first family whose name appears in the model id
 * wins. Rates are approximate published list prices (input / cacheWrite /
 * cacheRead / output) and are easy to update as pricing changes.
 */
const RATES: { match: string; in: number; cacheWrite: number; cacheRead: number; out: number }[] = [
  { match: "opus", in: 15, cacheWrite: 18.75, cacheRead: 1.5, out: 75 },
  { match: "sonnet", in: 3, cacheWrite: 3.75, cacheRead: 0.3, out: 15 },
  { match: "haiku", in: 0.8, cacheWrite: 1.0, cacheRead: 0.08, out: 4 },
];

function estimateCost(model: string | undefined, u: Omit<Usage, "estCostUsd">): number {
  const rate = RATES.find((r) => (model ?? "").includes(r.match));
  if (!rate) return 0;
  return (
    (u.inputTokens * rate.in +
      u.cacheCreationTokens * rate.cacheWrite +
      u.cacheReadTokens * rate.cacheRead +
      u.outputTokens * rate.out) /
    1_000_000
  );
}

interface RawEvent {
  type?: string;
  timestamp?: string;
  sessionId?: string;
  cwd?: string;
  gitBranch?: string;
  aiTitle?: string;
  prNumber?: number;
  prUrl?: string;
  prRepository?: string;
  message?: {
    role?: string;
    model?: string;
    content?: unknown;
    usage?: {
      input_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
      output_tokens?: number;
    };
  };
}

/** Pull the file path out of an Edit/Write/MultiEdit tool_use input. */
function filePathFromToolInput(name: string, input: any): string | null {
  if (!input || typeof input !== "object") return null;
  // Claude Code file tools use file_path; some use path.
  return input.file_path ?? input.path ?? null;
}

/** Map a tool name to a reverse-dot ActionProof action type. */
function actionType(tool: string): string {
  switch (tool) {
    case "Write": return "file.write";
    case "Edit":
    case "MultiEdit": return "file.edit";
    case "Read": return "file.read";
    case "Bash": return "shell.exec";
    case "Grep":
    case "Glob": return "repo.search";
    case "WebFetch":
    case "WebSearch": return "web.fetch";
    case "Agent": return "agent.spawn";
    case "TodoWrite": return "plan.todo";
    default: return "tool." + tool.toLowerCase();
  }
}

/** Build a short, human summary + target for one tool_use block. */
function describeAction(tool: string, input: any): { summary: string; target?: string } {
  const base = (p: string) => p.split("/").pop() ?? p;
  if (!input || typeof input !== "object") return { summary: tool };
  switch (tool) {
    case "Write":
    case "Edit":
    case "MultiEdit": {
      const fp = filePathFromToolInput(tool, input);
      return { summary: `${tool} ${fp ? base(fp) : ""}`.trim(), target: fp ?? undefined };
    }
    case "Read": {
      const fp = input.file_path ?? input.path;
      return { summary: `Read ${fp ? base(fp) : ""}`.trim(), target: fp };
    }
    case "Bash": {
      const cmd = String(input.command ?? "").replace(/\s+/g, " ").trim();
      return { summary: `Bash: ${cmd.slice(0, 80)}`, target: cmd };
    }
    case "Grep":
    case "Glob":
      return { summary: `${tool} ${input.pattern ?? ""}`.trim(), target: input.pattern };
    case "WebFetch":
    case "WebSearch":
      return { summary: `${tool} ${input.url ?? input.query ?? ""}`.trim(), target: input.url ?? input.query };
    case "Agent":
      return { summary: `Spawn agent: ${String(input.description ?? "subagent")}`.slice(0, 80) };
    default:
      return { summary: tool };
  }
}

/** Tools we treat as real "actions" worth listing/verifying (skip pure reads/noise). */
const ACTION_TOOLS = new Set([
  "Write", "Edit", "MultiEdit", "Bash", "Agent", "WebFetch", "WebSearch",
]);

/**
 * High-consequence action patterns we recommend verifying with ActionProof.
 * These change state outside the workspace (deploys, pushes, publishes,
 * payments, destructive ops) — exactly where a tamper-evident receipt matters.
 */
const CRITICAL_PATTERNS: { rx: RegExp; risk: string }[] = [
  { rx: /\bgit\s+push\b/, risk: "Pushes code to a remote — no proof of what was published or by which agent." },
  { rx: /\b(npm|pnpm|yarn)\s+publish\b|twine\s+upload|mcp-publisher\s+publish/, risk: "Publishes a package to a public registry — unverifiable supply-chain action." },
  { rx: /\b(docker\s+push|kubectl\s+apply|helm\s+(install|upgrade)|terraform\s+apply|serverless\s+deploy|vercel\s+(deploy|--prod)|netlify\s+deploy)\b/, risk: "Deploys/changes infrastructure — no attestation of what was shipped." },
  { rx: /\brm\s+-rf\b|\bdrop\s+(table|database)\b|\btruncate\b/i, risk: "Destructive operation — no signed record of what was deleted." },
  { rx: /\bcurl\b.*-X\s*(POST|PUT|DELETE|PATCH)|\bstripe\b|\bpayment\b|\bcharge\b/i, risk: "Mutating API/payment call — the highest-value thing to prove happened as recorded." },
  { rx: /\baws\s+|\bgcloud\s+|\baz\s+/, risk: "Cloud CLI mutation — unattested change to production resources." },
];

/** Classify a Bash action as critical (worth verifying) and why. */
function criticalityOf(tool: string, target?: string): { critical: boolean; risk?: string } {
  if (tool !== "Bash" || !target) return { critical: false };
  for (const p of CRITICAL_PATTERNS) {
    if (p.rx.test(target)) return { critical: true, risk: p.risk };
  }
  return { critical: false };
}

/** Hard cap on how much of a transcript we read into memory (256 MB). Real
 * sessions are KBs–low MBs; this only guards against a runaway/corrupt file. */
const MAX_TRANSCRIPT_BYTES = 256 * 1024 * 1024;

export function parseTranscript(path: string): Session {
  try {
    const { size } = statSync(path);
    if (size > MAX_TRANSCRIPT_BYTES) {
      // Return a minimal, honest stub rather than OOM-ing the whole run.
      const id = basename(path).replace(/\.jsonl$/, "");
      return {
        id,
        source: "claude-code",
        title: "(transcript too large to parse)",
        cwd: "",
        toolCounts: {},
        filesChanged: [],
        actions: [],
        prs: [],
        userMessages: 0,
        assistantMessages: 0,
        usage: { inputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, outputTokens: 0, estCostUsd: 0 },
        outcome: { label: "unknown", commits: [], reason: `Transcript exceeds ${Math.round(MAX_TRANSCRIPT_BYTES / 1024 / 1024)} MB; skipped.` },
        recommendations: [],
        transcriptPath: path,
      };
    }
  } catch {
    /* if stat fails, fall through and let readFileSync surface the error */
  }
  const raw = readFileSync(path, "utf8");
  const events: RawEvent[] = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      events.push(JSON.parse(t));
    } catch {
      /* skip malformed lines — transcripts can be truncated mid-write */
    }
  }

  const toolCounts: Record<string, number> = {};
  const fileMap = new Map<string, FileChange>();
  const actions: Action[] = [];
  const prs: SessionPR[] = [];
  const timestamps: string[] = [];

  let title = "";
  let cwd = "";
  let gitBranch: string | undefined;
  let model: string | undefined;
  let sessionId = basename(path).replace(/\.jsonl$/, "");
  let userMessages = 0;
  let assistantMessages = 0;
  const usage: Usage = {
    inputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
    estCostUsd: 0,
  };

  for (const e of events) {
    if (e.timestamp) timestamps.push(e.timestamp);
    if (e.cwd && !cwd) cwd = e.cwd;
    if (e.gitBranch && !gitBranch) gitBranch = e.gitBranch;
    if (e.sessionId) sessionId = e.sessionId;
    if (e.type === "ai-title" && e.aiTitle) title = e.aiTitle;

    if (e.type === "pr-link" && e.prNumber && e.prUrl) {
      if (!prs.some((p) => p.number === e.prNumber)) {
        prs.push({
          number: e.prNumber,
          url: e.prUrl,
          repository: e.prRepository ?? "",
        });
      }
    }

    if (e.type === "user") userMessages++;
    if (e.type === "assistant") {
      assistantMessages++;
      if (e.message?.model && !model) model = e.message.model;
      const u = e.message?.usage;
      if (u) {
        usage.inputTokens += u.input_tokens ?? 0;
        usage.cacheCreationTokens += u.cache_creation_input_tokens ?? 0;
        usage.cacheReadTokens += u.cache_read_input_tokens ?? 0;
        usage.outputTokens += u.output_tokens ?? 0;
      }
    }

    // Walk message content for tool_use blocks.
    const content = e.message?.content;
    if (Array.isArray(content)) {
      for (const block of content as any[]) {
        if (block?.type !== "tool_use") continue;
        const name = block.name ?? "unknown";
        toolCounts[name] = (toolCounts[name] ?? 0) + 1;

        // Record the meaningful ones as first-class actions (ActionProof's unit).
        if (ACTION_TOOLS.has(name)) {
          const { summary, target } = describeAction(name, block.input);
          const { critical, risk } = criticalityOf(name, target);
          actions.push({
            seq: actions.length,
            tool: name,
            type: actionType(name),
            summary,
            target,
            ts: e.timestamp,
            critical,
            risk,
          });
        }

        if (name === "Edit" || name === "Write" || name === "MultiEdit") {
          const fp = filePathFromToolInput(name, block.input);
          if (fp) {
            const existing = fileMap.get(fp);
            if (existing) {
              existing.edits++;
            } else {
              fileMap.set(fp, {
                path: fp,
                edits: 1,
                created: name === "Write",
              });
            }
          }
        }
      }
    }
  }

  // Keep only timestamps that actually parse — a malformed value must not poison
  // duration/idle/active with NaN. Sort the valid ones lexically (ISO-8601 sorts
  // chronologically).
  const validTs = timestamps.filter((t) => !Number.isNaN(Date.parse(t))).sort();
  const startedAt = validTs[0];
  const endedAt = validTs[validTs.length - 1];
  const durationMin =
    startedAt && endedAt
      ? Math.max(
          0,
          Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 60000),
        )
      : undefined;

  // Activity: how long since the last event, and whether it looks still-running.
  // A session with a live process typically has an event within the last ~15 min.
  const ACTIVE_WINDOW_MIN = 15;
  const idleMin = endedAt
    ? Math.max(0, Math.round((Date.now() - Date.parse(endedAt)) / 60000))
    : undefined;
  const active = idleMin != null && idleMin <= ACTIVE_WINDOW_MIN;

  const session: Session = {
    id: sessionId,
    source: "claude-code",
    title: title || "(untitled session)",
    cwd,
    gitBranch,
    startedAt,
    endedAt,
    durationMin,
    idleMin,
    active,
    model,
    toolCounts,
    filesChanged: [...fileMap.values()].sort((a, b) => b.edits - a.edits),
    actions,
    prs,
    userMessages,
    assistantMessages,
    usage: { ...usage, estCostUsd: estimateCost(model, usage) },
    // Outcome is filled in later by the git-correlation pass.
    outcome: { label: "unknown", commits: [], reason: "not correlated yet" },
    recommendations: [],
    transcriptPath: path,
  };
  session.recommendations = recommend(session);
  return session;
}
