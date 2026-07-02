/**
 * Session analysis: the agent-readable layer.
 *
 * AgentTrace's dashboard is for humans. But the real leverage is letting the
 * *agent* read a session's analysis, plan against it, implement the
 * recommendations, and mark each one done or skipped — with that state flowing
 * back into the dashboard. To make that possible, recommendation state must live
 * server-side (a small JSON store), not just in the browser.
 *
 * This module owns:
 *   - the shared recommendation-state store (~/.agenttrace/recstate.json)
 *   - a Markdown render of a session's analysis an agent can consume
 *   - a machine JSON render for programmatic use
 */
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

import type { Session, Recommendation } from "./types.ts";
import { outcomeDisplay } from "./types.ts";

const STATE_PATH = join(homedir(), ".agenttrace", "recstate.json");

/** Status of one recommendation, set by either the human or the agent. */
export interface RecState {
  status: "open" | "done" | "skipped";
  /** "human" (dashboard) or "agent" (via export/MCP). */
  by: "human" | "agent";
  /** Optional note — e.g. why the agent skipped it. */
  note?: string;
  at: string;
}

type Store = Record<string, Record<string, RecState>>; // sessionId -> recId -> state

export function readStore(): Store {
  try {
    return JSON.parse(readFileSync(STATE_PATH, "utf8"));
  } catch {
    return {};
  }
}
function writeStore(s: Store): void {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
}

/** All recommendation states for a session. */
export function statesFor(sessionId: string): Record<string, RecState> {
  return readStore()[sessionId] ?? {};
}

/** Set one recommendation's status (used by dashboard AND agent export). */
export function setRecState(
  sessionId: string,
  recId: string,
  status: RecState["status"],
  by: RecState["by"],
  nowISO: string,
  note?: string,
): RecState {
  const store = readStore();
  const forSession = (store[sessionId] ??= {});
  forSession[recId] = { status, by, note, at: nowISO };
  writeStore(store);
  return forSession[recId];
}

/** Merge stored state onto a session's recommendations (adds .state at runtime). */
export function applyRecState<T extends Session>(session: T): T {
  const states = statesFor(session.id);
  session.recommendations = session.recommendations.map((r) => ({
    ...r,
    state: states[r.id],
  })) as (Recommendation & { state?: RecState })[] as T["recommendations"];
  return session;
}

/** A compact ISO for a timestamp field on an action. */
function actionLine(a: Session["actions"][number]): string {
  const flag = a.critical ? " ⚠CRITICAL" : "";
  const v = a.verified ? " [verified]" : a.critical ? " [UNVERIFIED]" : "";
  return `- \`${a.type}\` ${a.summary}${flag}${v}`;
}

/**
 * Render a session's analysis as Markdown for an agent to read at the start of
 * a new session. Includes the outcome, timeframe, cost, critical/unverified
 * actions, and the open recommendations with their ready-to-run prompts — plus
 * explicit instructions on how to mark each done or skipped.
 */
export function toAgentMarkdown(session: Session): string {
  const o = outcomeDisplay(session.outcome.label);
  const states = statesFor(session.id);
  const u = session.usage;
  const totalTok =
    u.inputTokens + u.cacheCreationTokens + u.cacheReadTokens + u.outputTokens;

  const openRecs = session.recommendations.filter(
    (r) => (states[r.id]?.status ?? "open") === "open",
  );
  const closedRecs = session.recommendations.filter(
    (r) => (states[r.id]?.status ?? "open") !== "open",
  );
  const crit = session.actions.filter((a) => a.critical);
  const critUnverified = crit.filter((a) => !a.verified);

  const lines: string[] = [];
  lines.push(`# AgentTrace analysis — ${session.title}`);
  lines.push("");
  lines.push(`- **Session id:** ${session.id}`);
  lines.push(`- **Project (cwd):** ${session.cwd || "unknown"}`);
  lines.push(`- **Outcome:** ${o.text} — ${o.hint}`);
  lines.push(
    `- **Timeframe:** ${session.startedAt ?? "?"} → ${session.endedAt ?? "?"} (${session.durationMin ?? "?"} min)`,
  );
  lines.push(
    `- **Cost/usage:** ~$${(u.estCostUsd || 0).toFixed(2)} · ${totalTok.toLocaleString()} tokens · ${session.actions.length} actions · ${session.filesChanged.length} files`,
  );
  lines.push("");

  if (critUnverified.length) {
    lines.push(`## ⚠ Unverified high-consequence actions (${critUnverified.length})`);
    lines.push(
      "These changed state outside the workspace and have no tamper-evident proof. Consider verifying them with ActionProof.",
    );
    lines.push("");
    for (const a of critUnverified) {
      lines.push(`${actionLine(a)}`);
      if (a.risk) lines.push(`  - risk: ${a.risk}`);
    }
    lines.push("");
  }

  lines.push(`## Recommendations (${openRecs.length} open, ${closedRecs.length} resolved)`);
  lines.push("");
  if (!openRecs.length) {
    lines.push("_No open recommendations._");
    lines.push("");
  }
  for (const r of openRecs) {
    lines.push(`### [${r.impact.toUpperCase()}] ${r.title}  \`id=${r.id}\``);
    lines.push(`${r.detail}`);
    if (r.estSavingsUsd > 0) lines.push(`_Estimated saving: ~$${r.estSavingsUsd.toFixed(2)} per comparable session._`);
    lines.push("");
    lines.push("**Prompt to execute:**");
    lines.push("```");
    lines.push(r.prompt);
    lines.push("```");
    lines.push("");
  }
  if (closedRecs.length) {
    lines.push("#### Already resolved");
    for (const r of closedRecs) {
      const st = states[r.id];
      lines.push(`- ~~${r.title}~~ (${st?.status} by ${st?.by}${st?.note ? `: ${st.note}` : ""})`);
    }
    lines.push("");
  }

  lines.push("## How to update this analysis");
  lines.push(
    "After you implement or decide to skip a recommendation, record it so the AgentTrace dashboard reflects it. Either:",
  );
  lines.push("");
  lines.push("- **MCP (if the agenttrace MCP server is available):** call `mark_recommendation` with the session id, the recommendation `id`, and `status` = `done` or `skipped` (optionally a `note`).");
  lines.push("- **HTTP (dashboard running):** " +
    "`curl -X POST http://127.0.0.1:4317/api/recstate -H 'content-type: application/json' " +
    `-d '{\"sessionId\":\"${session.id}\",\"recId\":\"<id>\",\"status\":\"done\",\"by\":\"agent\",\"note\":\"...\"}'\``);
  lines.push("");
  return lines.join("\n");
}

/** Machine-readable analysis (for programmatic agent consumption). */
export function toAgentJson(session: Session): unknown {
  const states = statesFor(session.id);
  return {
    sessionId: session.id,
    title: session.title,
    cwd: session.cwd,
    outcome: { label: session.outcome.label, reason: session.outcome.reason },
    timeframe: { startedAt: session.startedAt, endedAt: session.endedAt, durationMin: session.durationMin },
    usage: session.usage,
    criticalUnverified: session.actions
      .filter((a) => a.critical && !a.verified)
      .map((a) => ({ seq: a.seq, type: a.type, summary: a.summary, risk: a.risk })),
    recommendations: session.recommendations.map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      impact: r.impact,
      estSavingsUsd: r.estSavingsUsd,
      prompt: r.prompt,
      status: states[r.id]?.status ?? "open",
    })),
    updateInstructions:
      "POST /api/recstate {sessionId, recId, status:'done'|'skipped', by:'agent', note?} — or MCP mark_recommendation.",
  };
}
