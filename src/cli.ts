#!/usr/bin/env node
/**
 * AgentTrace CLI — see what your AI coding agents actually accomplished.
 *
 * Usage:
 *   agenttrace [list]          List all sessions, newest first (default).
 *   agenttrace show <id>       Drill down into one session (id prefix is enough).
 *   agenttrace serve [--port]  Start the local dashboard (see dashboard.ts).
 *   agenttrace --json          Emit the session list as JSON (for piping).
 *
 * Everything runs locally against ~/.claude/projects — no backend, no network.
 */
import { serve } from "./dashboard.ts";
import { loadSessions } from "./core.ts";

import type { Session } from "./types.ts";
import { outcomeDisplay } from "./types.ts";

/** Recommendation category → plain feature label (matches the dashboard). */
const REC_CATEGORY: Record<string, string> = {
  agenttrace: "Workflow",
  tokenkeeper: "Cost",
  sessionsentry: "Security",
  actionproof: "Proof",
};
import { toAgentMarkdown, toAgentJson, provenRoi } from "./analysis.ts";

// --- tiny ANSI helpers (no deps; disabled when not a TTY or NO_COLOR set) ---
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: string) => (s: string) =>
  useColor ? `\x1b[${code}m${s}\x1b[0m` : s;
const dim = paint("2");
const bold = paint("1");
const green = paint("32");
const red = paint("31");
const yellow = paint("33");
const cyan = paint("36");
const gray = paint("90");

/** Plain-language, colored badge for an outcome label. */
function outcomeBadge(label: Session["outcome"]["label"]): string {
  const { text, tone } = outcomeDisplay(label);
  const paintByTone =
    tone === "good" ? green : tone === "bad" ? red : tone === "warn" ? yellow : cyan;
  const glyph = tone === "good" ? "●" : tone === "bad" ? "●" : tone === "warn" ? "●" : "○";
  return paintByTone(`${glyph} ${text}`);
}

/** Shorten a model id like "claude-opus-4-8-20260101" to "opus-4-8". */
function shortModel(model?: string): string {
  if (!model) return "—";
  const m = model.match(/(opus|sonnet|haiku)-([\d-]+?)(?:-\d{8})?$/);
  return m ? `${m[1]}-${m[2]}` : model;
}

/** Collapse an absolute path to a ~-relative, trailing-component label. */
function shortCwd(cwd: string): string {
  if (!cwd) return "—";
  const home = process.env.HOME;
  const rel = home && cwd.startsWith(home) ? "~" + cwd.slice(home.length) : cwd;
  const parts = rel.split("/");
  return parts.length > 3 ? ".../" + parts.slice(-2).join("/") : rel;
}

/** Compact token count: 1234 -> 1.2k, 3400000 -> 3.4M. */
function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return String(n);
}

function fmtCost(usd: number): string {
  if (usd === 0) return "—";
  return usd >= 1 ? `$${usd.toFixed(0)}` : `$${usd.toFixed(2)}`;
}

/** Duration in minutes → "1h 20m" / "45m". */
function fmtDurCli(min?: number): string {
  if (min == null) return "—";
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** Idle minutes → "just now" / "3h ago" / "2d ago". */
function relTimeCli(min?: number): string {
  if (min == null) return "";
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function fmtDate(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
}

function listCommand(asJson: boolean): void {
  const sessions = loadSessions();

  if (asJson) {
    process.stdout.write(JSON.stringify(sessions, null, 2) + "\n");
    return;
  }

  if (sessions.length === 0) {
    console.log(
      dim("No Claude Code sessions found under ~/.claude/projects.\n") +
        dim("Run an agent session, then try again."),
    );
    return;
  }

  console.log(
    bold(`\n  AgentTrace — ${sessions.length} session(s)\n`) +
      dim("  what your coding agents did, and whether it stuck\n"),
  );

  // Tallies for a one-line summary.
  const tally: Record<Session["outcome"]["label"], number> = {
    kept: 0,
    reverted: 0,
    uncommitted: 0,
    untracked: 0,
    "no-changes": 0,
    unknown: 0,
  };

  for (const s of sessions) {
    tally[s.outcome.label]++;
    const files = s.filesChanged.length;
    const dur = fmtDurCli(s.durationMin);
    const live = s.active ? green(" ● active") : "";
    const recs = s.recommendations.length ? yellow(` 💡${s.recommendations.length}`) : "";

    console.log(
      `  ${outcomeBadge(s.outcome.label).padEnd(useColor ? 24 : 15)} ` +
        bold(s.title.slice(0, 48).padEnd(48)) +
        live +
        recs +
        dim(`  ${s.id.slice(0, 8)}`),
    );
    const totalTok =
      s.usage.inputTokens +
      s.usage.cacheCreationTokens +
      s.usage.cacheReadTokens +
      s.usage.outputTokens;
    console.log(
      dim(
        `      ${fmtDate(s.startedAt)} → ${fmtDate(s.endedAt)} (${dur}, ${relTimeCli(s.idleMin)}) · ` +
          `${shortModel(s.model)} · ${cyan(String(files))} file(s) · ${s.actions.length} action(s) · ` +
          `${fmtTokens(totalTok)} tok ~${fmtCost(s.usage.estCostUsd)} · ${shortCwd(s.cwd)}`,
      ),
    );
  }

  const activeN = sessions.filter((s) => s.active).length;
  console.log(
    "\n  " +
      [
        tally.kept && green(`${tally.kept} landed`),
        tally.reverted && red(`${tally.reverted} reverted`),
        tally.uncommitted && yellow(`${tally.uncommitted} not committed`),
        tally.untracked && cyan(`${tally.untracked} not in git`),
        tally["no-changes"] && gray(`${tally["no-changes"]} no edits`),
        tally.unknown && gray(`${tally.unknown} unknown`),
        activeN && green(`${activeN} active now`),
      ]
        .filter(Boolean)
        .join(dim(" · ")),
  );
  const grandCost = sessions.reduce((a, s) => a + s.usage.estCostUsd, 0);
  console.log(
    dim(`  total est. spend across all sessions: `) + bold(fmtCost(grandCost)),
  );

  // Proven ROI — value the user actually banked by marking recommendations done.
  const roi = provenRoi(sessions);
  if (roi.applied > 0) {
    const bits = [
      roi.savedUsd > 0 && green(`~$${roi.savedUsd.toFixed(2)}/run saved`),
      roi.securityFixed > 0 && cyan(`${roi.securityFixed} security issue(s) fixed`),
      roi.workflowImproved > 0 && `${roi.workflowImproved} workflow win(s)`,
    ].filter(Boolean);
    console.log(
      "  " + green("✨ AgentTrace ROI: ") + bold(`${roi.applied} recommendation(s) applied`) +
        (bits.length ? dim(" · ") + bits.join(dim(" · ")) : ""),
    );
  }
  console.log(dim(`\n  agenttrace show <id>  to drill into a session\n`));
}

function showCommand(idPrefix: string): void {
  if (!idPrefix) {
    console.error(red("Usage: agenttrace show <session-id>"));
    process.exitCode = 1;
    return;
  }
  const sessions = loadSessions();
  const matches = sessions.filter((s) => s.id.startsWith(idPrefix));

  if (matches.length === 0) {
    console.error(red(`No session found matching "${idPrefix}".`));
    process.exitCode = 1;
    return;
  }
  if (matches.length > 1) {
    console.error(
      yellow(`"${idPrefix}" matches ${matches.length} sessions; be more specific:`),
    );
    for (const s of matches) console.error(dim(`  ${s.id}  ${s.title}`));
    process.exitCode = 1;
    return;
  }

  const s = matches[0];
  const disp = outcomeDisplay(s.outcome.label);
  console.log(bold(`\n  ${s.title}`) + (s.active ? green("  ● active") : ""));
  console.log(dim(`  ${s.id}\n`));
  console.log(`  outcome    ${outcomeBadge(s.outcome.label)}  ${dim(disp.hint)}`);
  console.log(dim(`             ${s.outcome.reason}`));
  if (s.outcome.filesOnDisk) {
    const { present, total } = s.outcome.filesOnDisk;
    console.log(dim(`             ${present}/${total} changed file(s) still on disk`));
  }
  console.log(
    `  timeframe  ${fmtDate(s.startedAt)} → ${fmtDate(s.endedAt)}  ` +
      dim(`ran ${fmtDurCli(s.durationMin)} · ${s.active ? green("active, ") : ""}last activity ${relTimeCli(s.idleMin)}`),
  );
  console.log(`  model      ${shortModel(s.model)}`);
  console.log(`  cwd        ${s.cwd || "—"}` + (s.gitBranch ? dim(` @ ${s.gitBranch}`) : ""));
  console.log(`  messages   ${s.userMessages} you · ${s.assistantMessages} agent`);
  console.log(
    `  usage      ${fmtTokens(s.usage.inputTokens)} in · ` +
      `${fmtTokens(s.usage.outputTokens)} out · ` +
      `${fmtTokens(s.usage.cacheReadTokens)} cache-read · ~${fmtCost(s.usage.estCostUsd)}`,
  );

  if (s.recommendations.length) {
    console.log(bold(`\n  recommendations to improve this agent (${s.recommendations.length})`));
    for (const r of s.recommendations) {
      const tag = r.impact === "high" ? red("high") : r.impact === "medium" ? yellow("med ") : gray("low ");
      const cat = REC_CATEGORY[r.product] ?? "Workflow";
      console.log(`    [${tag}] ${bold(r.title)} ${dim("· " + cat)}`);
      console.log(dim(`           ${r.detail}`));
      if (r.action) console.log(cyan(`           → ${r.action}`));
    }
  }

  if (s.actions.length) {
    console.log(bold(`\n  actions (${s.actions.length}) — the unit ActionProof verifies`));
    for (const a of s.actions.slice(0, 30)) {
      console.log(`    ${cyan(a.type.padEnd(12))} ${a.summary.slice(0, 70)}`);
    }
    if (s.actions.length > 30) console.log(dim(`    … and ${s.actions.length - 30} more`));
  }

  const tools = Object.entries(s.toolCounts).sort((a, b) => b[1] - a[1]);
  if (tools.length) {
    console.log(bold(`\n  tools`));
    for (const [name, n] of tools) console.log(`    ${name.padEnd(14)} ${dim(String(n))}`);
  }

  if (s.filesChanged.length) {
    console.log(bold(`\n  files changed (${s.filesChanged.length})`));
    for (const f of s.filesChanged.slice(0, 40)) {
      const tag = f.created ? green("new") : cyan("edit");
      console.log(`    ${tag}  ${f.path} ${dim(`×${f.edits}`)}`);
    }
    if (s.filesChanged.length > 40)
      console.log(dim(`    … and ${s.filesChanged.length - 40} more`));
  }

  if (s.outcome.commits.length) {
    console.log(bold(`\n  commits`));
    for (const c of s.outcome.commits)
      console.log(`    ${yellow(c.hash.slice(0, 8))}  ${c.subject}`);
  }

  if (s.prs.length) {
    console.log(bold(`\n  pull requests`));
    for (const p of s.prs) console.log(`    #${p.number}  ${p.url}`);
  }

  console.log(dim(`\n  transcript: ${s.transcriptPath}\n`));
}

/** Print an agent-readable analysis of one session (Markdown or JSON). */
function analyzeCommand(idPrefix: string, asJson: boolean): void {
  if (!idPrefix) {
    console.error(red("Usage: agenttrace analyze <session-id> [--json]"));
    process.exitCode = 1;
    return;
  }
  const matches = loadSessions().filter((s) => s.id.startsWith(idPrefix));
  if (matches.length !== 1) {
    console.error(
      red(
        matches.length === 0
          ? `No session matching "${idPrefix}".`
          : `"${idPrefix}" matches ${matches.length} sessions; be more specific.`,
      ),
    );
    process.exitCode = 1;
    return;
  }
  const s = matches[0];
  // Raw output (no ANSI/decoration) so it can be piped straight to an agent.
  process.stdout.write(
    (asJson ? JSON.stringify(toAgentJson(s), null, 2) : toAgentMarkdown(s)) + "\n",
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (cmd === "-h" || cmd === "--help") {
    console.log(
      [
        bold("agenttrace") + " — see what your AI coding agents accomplished",
        "",
        "  agenttrace [list]        list sessions, newest first (default)",
        "  agenttrace show <id>     drill into one session",
        "  agenttrace analyze <id>  print an agent-readable analysis (Markdown; --json for JSON)",
        "  agenttrace serve         start the local dashboard",
        "  agenttrace --json        session list as JSON",
        "",
        dim("  Local-first, zero backend. Reads ~/.claude/projects."),
      ].join("\n"),
    );
    return;
  }

  if (cmd === "serve") {
    const portArg = args.indexOf("--port");
    const port = portArg >= 0 ? Number(args[portArg + 1]) : 4317;
    await serve(port, loadSessions);
    return;
  }

  if (cmd === "show") {
    showCommand(args[1]);
    return;
  }

  if (cmd === "analyze") {
    analyzeCommand(args[1], args.includes("--json"));
    return;
  }

  // Default: list (also handles `list` and `--json`).
  listCommand(args.includes("--json"));
}

main().catch((err) => {
  console.error(red("agenttrace: ") + (err?.message ?? String(err)));
  process.exitCode = 1;
});
