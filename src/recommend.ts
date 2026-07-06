/**
 * Local, offline recommendation engine — AgentTrace's "make my agents better"
 * value (and a future paywalled capability). From what we already parsed (tool
 * mix, repeated commands, cache behaviour, cost, outcome), infer concrete
 * suggestions: skills to add, ways to save tokens, workflow improvements.
 *
 * Every recommendation carries a ready-to-paste PROMPT the developer can hand
 * to Claude Code / Cursor to execute it next session, and an estimated $ saving.
 * Zero network, zero cost. A future opt-in "deep analysis" (Claude API) can add
 * richer, intent-aware recommendations on top.
 */
import type { Session, Recommendation } from "./types.ts";

/** Bash commands worth turning into a reusable skill when repeated a lot. */
const SKILLABLE = [
  { rx: /\b(npm|pnpm|yarn)\s+(run\s+)?test\b|\bpytest\b|\bjest\b|\bvitest\b/, name: "test-runner", label: "running tests" },
  { rx: /\bgit\s+(commit|push|rebase|merge)\b/, name: "git-flow", label: "git operations" },
  { rx: /\b(docker|kubectl|helm)\b/, name: "deploy", label: "container/deploy commands" },
  { rx: /\b(tsc|eslint|prettier|ruff|black|mypy)\b/, name: "lint-typecheck", label: "lint/typecheck" },
  { rx: /\b(curl|wget)\b.*http/, name: "api-probe", label: "hitting APIs" },
];

/** Count how many bash actions match a regex. */
function bashMatches(session: Session, rx: RegExp): number {
  return session.actions.filter((a) => a.tool === "Bash" && rx.test(a.target ?? a.summary)).length;
}

/** Cost per output token for the session's model family — rough savings math. */
function outCostPerTok(model?: string): number {
  const m = model ?? "";
  if (m.includes("opus")) return 75 / 1e6;
  if (m.includes("sonnet")) return 15 / 1e6;
  if (m.includes("haiku")) return 4 / 1e6;
  return 15 / 1e6;
}
function cacheReadCostPerTok(model?: string): number {
  const m = model ?? "";
  if (m.includes("opus")) return 1.5 / 1e6;
  if (m.includes("sonnet")) return 0.3 / 1e6;
  if (m.includes("haiku")) return 0.08 / 1e6;
  return 0.3 / 1e6;
}

export function recommend(session: Session): Recommendation[] {
  const recs: Recommendation[] = [];
  const tools = session.toolCounts;
  const totalTools = Object.values(tools).reduce((a, b) => a + b, 0);
  const push = (r: Omit<Recommendation, "id" | "source">) =>
    recs.push({ ...r, id: `${session.id.slice(0, 8)}-${recs.length}`, source: "heuristic" });

  // --- Skill suggestions: repeated command families → a saved skill. ---
  for (const s of SKILLABLE) {
    const n = bashMatches(session, s.rx);
    if (n >= 3) {
      // Saving ~ a fraction of the exploratory output tokens these repeats cost.
      const est = Math.min(2, n * 0.15) * outCostPerTok(session.model) * (session.usage.outputTokens / Math.max(1, totalTools)) * n;
      push({
        kind: "skill",
        product: "agenttrace",
        title: `Add a "${s.name}" skill`,
        detail: `The agent used raw Bash for ${s.label} ${n} times. A saved skill makes this one reliable step and stops the agent re-deriving the approach each time.`,
        action: `Create a .claude/skills/${s.name}/ skill capturing your approach to ${s.label}.`,
        prompt: `Create a reusable Claude Code skill at .claude/skills/${s.name}/ for ${s.label} in this project. Inspect how ${s.label} was done here (commands, flags, working directory), then write SKILL.md with a clear description and step-by-step instructions so future sessions can do ${s.label} in one step instead of ad-hoc Bash.`,
        impact: n >= 6 ? "high" : "medium",
        estSavingsUsd: Math.max(0.5, Math.round(est * 100) / 100),
      });
    }
  }

  // --- Cost: heavy cache re-reads suggest context bloat. ---
  const u = session.usage;
  const cacheRead = u.cacheReadTokens;
  const output = u.outputTokens || 1;
  if (cacheRead > 20_000_000 && cacheRead / output > 100) {
    // If half the cache-reads were avoidable, that's the saving per comparable session.
    const est = 0.5 * cacheRead * cacheReadCostPerTok(session.model);
    push({
      kind: "cost",
      product: "tokenkeeper",
      title: "Trim context to cut cache-read spend",
      detail: `This session re-read ${(cacheRead / 1e6).toFixed(0)}M cached tokens — the dominant cost driver. Long-lived context is re-sent every turn.`,
      action: "Use /compact or start fresh sessions for unrelated tasks; narrow what's brought into context.",
      prompt: `This session re-read ${(cacheRead / 1e6).toFixed(0)}M cached tokens, which dominated its cost. Going forward, keep my context lean: proactively /compact when the conversation grows, avoid re-reading large files you've already seen, and tell me when we should split an unrelated task into a fresh session.`,
      impact: "high",
      estSavingsUsd: Math.max(1, Math.round(est * 100) / 100),
    });
  }

  // --- Cost: very long single session. ---
  if ((session.durationMin ?? 0) > 600 && session.userMessages > 40) {
    push({
      kind: "workflow",
      product: "tokenkeeper",
      title: "Split marathon sessions",
      detail: `This session ran ${Math.round((session.durationMin ?? 0) / 60)}h with ${session.userMessages} of your messages. Very long sessions accumulate context and cost.`,
      action: "Break distinct goals into separate sessions so each stays focused and cheap.",
      prompt: `When I start a new task that's unrelated to the current one, remind me to start a fresh session instead of continuing this one — long sessions accumulate expensive context. If you notice we've drifted to a new goal, say so.`,
      impact: "medium",
      estSavingsUsd: Math.max(1, Math.round(0.15 * (session.usage.estCostUsd || 0) * 100) / 100),
    });
  }

  // --- Quality: lots of edits but nothing landed in git. ---
  if (session.filesChanged.length >= 5 && session.outcome.label === "uncommitted") {
    push({
      kind: "quality",
      product: "agenttrace",
      title: "Commit or discard this work",
      detail: `${session.filesChanged.length} files were edited in a git repo but nothing was committed. Work like this is easy to lose.`,
      action: "Review the diff and commit intentionally, or revert if it was exploratory.",
      prompt: `Review the uncommitted changes in this repo (git status + git diff), summarize what changed and why, then propose a clear commit message and commit the work — or tell me if any of it looks accidental and should be reverted.`,
      impact: "medium",
      estSavingsUsd: 0,
    });
  }

  // --- Quality: no planning tool on a big session. ---
  if (totalTools > 60 && !tools["TodoWrite"] && !tools["ExitPlanMode"]) {
    push({
      kind: "quality",
      product: "agenttrace",
      title: "Plan big tasks up front",
      detail: `${totalTools} tool calls with no planning step. Long tasks tend to drift without an explicit plan or todo list.`,
      action: "Ask the agent to draft a plan (plan mode) or track a todo list before large changes.",
      prompt: `Before making large changes, first draft a short plan and a todo list of the steps, confirm it with me, then work through it — don't start editing files until we agree on the approach.`,
      impact: "low",
      estSavingsUsd: 0,
    });
  }

  // --- Efficiency: heavy read/grep ratio suggests weak navigation. ---
  const reads = (tools["Read"] ?? 0) + (tools["Grep"] ?? 0) + (tools["Glob"] ?? 0);
  if (reads > 40 && reads / Math.max(1, totalTools) > 0.5) {
    const est = 0.3 * reads * 2000 * cacheReadCostPerTok(session.model); // rough: avoided re-context
    push({
      kind: "cost",
      product: "tokenkeeper",
      title: "Add a CLAUDE.md map or navigation skill",
      detail: `${reads} read/search calls (${Math.round((100 * reads) / totalTools)}% of activity) — the agent spent heavy effort just locating things.`,
      action: "Add a CLAUDE.md that maps the codebase, or a skill pointing to key files, to cut exploratory reads.",
      prompt: `Generate a CLAUDE.md for this repository that maps the codebase: the purpose of each top-level directory, the key entry-point files, where common things live, and how to run/test it — so future sessions can navigate without a lot of exploratory reads.`,
      impact: "medium",
      estSavingsUsd: Math.max(0.5, Math.round(est * 100) / 100),
    });
  }

  // --- SessionSentry: session-security recommendations. ---
  securityRecs(session, push);

  const rank = { high: 0, medium: 1, low: 2 };
  return recs.sort((a, b) => rank[a.impact] - rank[b.impact]);
}

/** Secrets/credentials worth flagging when they appear in shell commands. */
const SECRET_PATTERNS: { rx: RegExp; what: string }[] = [
  { rx: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/, what: "an AWS access key id" },
  { rx: /\b(sk|rk)-[A-Za-z0-9]{20,}\b/, what: "an API secret key" },
  { rx: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/, what: "a GitHub token" },
  { rx: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, what: "a Slack token" },
  { rx: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, what: "a private key" },
  { rx: /\b(export\s+)?[A-Z_]*(SECRET|TOKEN|PASSWORD|API_?KEY)[A-Z_]*\s*=\s*['"]?[^\s'"]{6,}/, what: "an inline secret in an env var" },
];

/**
 * SessionSentry heuristics — the session-security mini product. Two angles:
 *  1) High-consequence actions (push/deploy/rm -rf/payment) ran without a
 *     tamper-evident record — recommend verifying them with ActionProof.
 *  2) A secret/credential appears in plaintext in a shell command — recommend
 *     moving it to an env var / secret manager and rotating it.
 */
function securityRecs(
  session: Session,
  push: (r: Omit<Recommendation, "id" | "source">) => void,
): void {
  // 1) Unverified critical actions.
  const criticalUnverified = session.actions.filter((a) => a.critical && !a.verified);
  if (criticalUnverified.length > 0) {
    const kinds = [...new Set(criticalUnverified.map((a) => a.type))].join(", ");
    push({
      kind: "security",
      product: "sessionsentry",
      title: `Verify ${criticalUnverified.length} high-consequence action(s)`,
      detail:
        `This session ran ${criticalUnverified.length} state-changing action(s) (${kinds}) with no tamper-evident record. ` +
        `Risk: if anything went wrong — a bad deploy, an unintended push, a destructive command — there's no signed proof of what actually ran, by which agent, or when.`,
      action: "Sign these actions with ActionProof so you have an offline-verifiable receipt of each one.",
      prompt: `Review the high-consequence commands this agent ran (${kinds}). For each, confirm it did what was intended, and going forward: pause and ask me before running anything that pushes code, deploys, deletes data, or moves money.`,
      impact: criticalUnverified.length >= 3 ? "high" : "medium",
      estSavingsUsd: 0,
    });
  }

  // 2) Secrets in shell commands.
  const leaks = new Set<string>();
  for (const a of session.actions) {
    if (a.tool !== "Bash") continue;
    const cmd = a.target ?? a.summary;
    for (const p of SECRET_PATTERNS) {
      if (p.rx.test(cmd)) leaks.add(p.what);
    }
  }
  if (leaks.size > 0) {
    push({
      kind: "security",
      product: "sessionsentry",
      title: "Move secrets out of shell commands",
      detail:
        `A command in this session appears to contain ${[...leaks].join(", ")} in plaintext. ` +
        `Secrets typed on the command line land in shell history, transcripts, and process listings.`,
      action: "Move the secret to an environment variable or a secret manager, and rotate it if it was exposed.",
      prompt: `A secret appears to have been passed in plaintext on the command line in this project. Help me move it to an environment variable (or a secret manager), update the code/commands to read it from there, add it to .gitignore/.env.example as appropriate, and remind me to rotate the exposed credential.`,
      impact: "high",
      estSavingsUsd: 0,
    });
  }
}
