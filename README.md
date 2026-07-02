# AgentTrace

**See what your AI coding agents actually did — and whether it stuck.** Every Claude Code
session, mapped to the files it changed, the commits it produced, the tokens it burned,
and a plain-English outcome: *did the work land?* Local-first, zero backend, zero telemetry.

You run coding agents all day, but you can't see them. Which sessions ran? What did each
one change? Did that hour of edits get committed, or silently thrown away? How much did it
cost? AgentTrace reads the session transcripts already on your disk and answers all of
that — in your terminal or a local dashboard — without sending anything anywhere.

## Install

Requires **Node ≥ 23.6** (AgentTrace runs TypeScript directly — no build step).

```bash
npx agenttrace            # list your sessions, newest first
```

Or clone and run locally:

```bash
git clone https://github.com/Burakfenerci5/agenttrace && cd agenttrace
node src/cli.ts           # same as `npx agenttrace`
```

## Quick start

```bash
agenttrace                # list every session, with outcome + cost
agenttrace show <id>      # drill into one session (id prefix is enough)
agenttrace serve          # open the local dashboard (http://127.0.0.1:4317)
agenttrace analyze <id>   # print an agent-readable analysis (pipe it to your agent)
```

Everything runs against `~/.claude/projects` on your machine. Nothing is uploaded.

## What you get

- **Outcome labeling** — each session is correlated with git and labeled *Landed*,
  *Reverted*, *Not committed*, *Not in git*, or *No edits*. This is the question no other
  tool answers: did the agent's work actually survive?
- **Cost & tokens** — per-session token usage and a USD estimate from published model
  rates, so you can see where your spend goes.
- **Recommendations** — local heuristics spot repeated commands (→ add a skill), context
  bloat (→ trim cache reads), marathon sessions, and uncommitted work. Each comes with a
  ready-to-paste prompt you can hand straight back to your agent.
- **Actions** — every meaningful step (file writes, shell commands, deploys) is listed;
  high-consequence ones (pushes, publishes, `rm -rf`, payments) are flagged as worth
  verifying.
- **A striking local dashboard** — searchable, groupable, an interactive metric chart,
  multi-session selection to compare cost, and per-session drill-down.

## Prove it, don't just observe it

AgentTrace shows you what your agents *reportedly* did (heuristics over local logs). Its
sibling **[ActionProof](https://github.com/Burakfenerci5/actionproof)** lets you *prove* it:
Ed25519-signed, tamper-evident receipts for any action or session, verifiable offline.
If ActionProof is installed alongside AgentTrace, the dashboard's **Sign** button mints a
real receipt and shows a `✓ verified` badge — the free-to-provable bridge, built in.

## Privacy

- Binds to `127.0.0.1` only; rejects any non-loopback `Host` and cross-origin request.
- Never reads your message *content* — only event metadata (tools, files, timing, usage).
- No network calls, no analytics, no account. Your transcripts never leave your machine.

## Development

```bash
npm run typecheck    # tsc --noEmit
npm test             # node:test suite
```

## License

MIT
