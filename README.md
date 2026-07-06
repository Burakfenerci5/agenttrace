# AgentTrace

**How much of your AI's code actually survived?** AgentTrace correlates every Claude Code
session with your git history and gives you one number: the share of your agent's work that
**landed and stuck** — versus what got **reverted** or **never committed**. Local-first,
zero backend, zero telemetry.

You run coding agents all day, but you can't see whether their work lasts. That hour of
edits — did it get committed and survive, or silently thrown away? AgentTrace reads the
session transcripts already on your disk, matches them to commits, and shows you a
survival rate — plus what each session changed, what it cost, and how to make the next one
better. All in your terminal or a local dashboard, without sending anything anywhere.

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
  *Reverted*, *Not committed*, *Not in git*, or *No edits* — and rolls them into a single
  **survival rate**. Plenty of tools count your tokens; AgentTrace is the one that tells you,
  per session, whether the work actually survived.
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
