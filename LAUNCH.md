# AgentTrace — launch & traction playbook

Internal playbook for getting AgentTrace discovered and building traction. Not shipped in
the npm package (repo-only, for reference). Sibling playbook: `actionproof/LAUNCH.md`.

**The core insight:** AgentTrace is not an MCP server, so the ActionProof directory-submission
strategy (MCP registries, Glama, mcp.so) does **not** apply. AgentTrace wins differently — it
has a **native viral loop**: the *survival rate* is a single, competitive, screenshot-able
number. The whole launch funnels people to run one command and share the number:

> **How much of your AI's code actually survived? Run `npx agenttrace-cli` and find out.**

Lead with the number + the question + the zero-friction one-liner on *every* surface.

---

## The one-liner arsenal (reuse everywhere)

- **The hook:** "How much of your AI's code actually survived?"
- **The proof:** local-first, zero backend, zero telemetry — your transcripts never leave your machine.
- **The command:** `npx agenttrace-cli`
- **The adjacency:** *"ccusage tells you what you spent. AgentTrace tells you what survived."*
  (Ride the incumbent the audience already uses; don't compete with it.)
- **The bridge:** free to measure (AgentTrace) → provable when it matters (ActionProof).

---

## Tier 1 — launch day (highest leverage, do first)

### 1. Show HN
**Title:** `Show HN: AgentTrace – how much of your AI's code actually survived?`

Post Tue–Thu, ~08:00–10:00 ET (US morning). Be present in comments all day; reply fast.

**Body:**
> I run Claude Code all day but couldn't see whether its work *lasted* — how much got
> committed and survived vs. reverted or silently thrown away. So I built AgentTrace: it
> reads the session transcripts already on your disk, matches them to your git history, and
> gives you one number — a **survival rate** — plus what each session changed, what it cost,
> and a recommendation for the next one.
>
> Everything is local. It binds to 127.0.0.1, never reads your message *content* (only event
> metadata), makes zero network calls, and has no account or telemetry. Zero runtime deps.
>
> - `npx agenttrace-cli` (Node ≥ 20), or a signed & notarized Mac app (.dmg).
> - `agenttrace serve` opens a local dashboard; `agenttrace analyze <id>` prints an
>   agent-readable analysis you can pipe back to your agent.
> - MIT. Repo: https://github.com/Burakfenerci5/agenttrace
>
> **Honest question for HN:** is "did my agent's work actually survive?" a metric you'd
> track, or do your existing tools already tell you this? What would make this a daily habit?

### 2. Reddit — the actual home of the audience
Post to the Claude Code communities (NOT r/AI_Agents — that was right for ActionProof, wrong
here). Primary: **r/ClaudeAI** and **r/ClaudeCode**. Secondary: r/LocalLLaMA, r/programming.

> ⚠️ Read each sub's self-promo rules first; lead with the question, not the pitch. Reddit
> punishes anything that smells like an ad. Frame as "I built this to scratch my own itch,
> is this useful to you?"

**Title:** `I measured how much of my AI's code actually survived. It was [X]%. Made a tool so you can check yours.`

**Body:**
> If you run Claude Code, you can see what it *did* — but not whether the work *lasted*. I
> got curious how much of my agent's code actually landed and stuck vs. got reverted or never
> committed, so I built a small local tool that reads your session transcripts, matches them
> to git, and gives you a survival rate. Runs entirely on your machine — zero backend, zero
> telemetry, nothing uploaded. `npx agenttrace-cli`. MIT, repo below.
>
> Genuinely curious what everyone's survival rate comes out to — and whether this is a number
> worth tracking or just a novelty. Blunt takes welcome.
> https://github.com/Burakfenerci5/agenttrace

### 3. The ccusage adjacency (thread through 1 & 2)
Wherever ccusage comes up (and it will), position as complementary, not competitive:
*"ccusage answers 'what did I spend?'. AgentTrace answers 'what did I get for it — did the
work survive?'"* Consider a comment/post in threads where people share ccusage screenshots.

---

## Tier 2 — launch week

### 4. X / Twitter — the most shareable surface for the number
Post a **screenshot of your own survival score** (dashboard or CLI) + the one-liner. Thread
into the Claude Code + AI-coding conversation.

> Your AI wrote a lot of code this week. How much of it actually *survived* — landed in a
> commit and stuck, vs. got reverted or thrown away?
>
> AgentTrace reads your Claude Code sessions, matches them to git, and tells you. Local-first,
> zero telemetry. `npx agenttrace-cli`
>
> Mine was [X]%. What's yours? 👇
> https://github.com/Burakfenerci5/agenttrace

### 5. awesome-claude-code — durable discovery (submit via ISSUE FORM, not a PR)
**hesreallyhim/awesome-claude-code** (~48.5k stars, updated daily) is THE list — an order of
magnitude bigger than any other. Non-obvious mechanic: **do NOT open a PR.** Their CONTRIBUTING
requires the web-UI **issue form**:
`https://github.com/hesreallyhim/awesome-claude-code/issues/new?template=recommend-resource.yml`

- **Category:** **Observability** (the list has both "Observability" and "Usage & Cost
  Monitoring" — AgentTrace is survival/observability, not cost tracking).
- **Description rules:** 1–3 sentences, 10–500 chars, **descriptive not promotional, no emojis,
  don't address the reader** ("the user's" not "your"). A bot auto-detects the license from the
  repo — our `LICENSE` (MIT) is present, so that's covered.
- **Suggested entry** (reader-neutral, no emoji):
  > `AgentTrace` — Local-first CLI and Mac app that maps every Claude Code session to the git
  > history and reports a "survival rate": how much of an agent's code actually landed and
  > stuck versus was reverted or never committed. Zero backend, zero telemetry.

### 6. Narrative blog post (the linkable anchor)
Write **"I measured how much of my AI's code actually survived. It was [X]%."** on dev.to /
Hashnode / your own site (agenttrace.raiselabs.app once DNS lands). This is what HN/Reddit/X
link *back to*, and it's SEO-durable. Tell the dogfooding story, show real numbers, end with
the one-liner + install.

---

## Tier 3 — sustaining

### 7. Product Hunt — for the Mac app
The polished dashboard screenshots beautifully; PH rewards visual tools. Launch the .dmg with
a gallery of the dashboard (chart, survival score, session drill-down). Coordinate for a
single day; rally early upvotes in the first hours.

### 8. Follow-up content
- "2 weeks in: what dogfooding my own survival rate taught me."
- A comparison-of-runs post (before/after adding a skill, per the tool's own recommendations).
- Cross-promote the ActionProof bridge for users who need *provable* (not just measured) logs.

---

## ⚠️ The competitor you MUST out-position: CodeBurn / AgentSeal

**This is the single most important thing in this doc.** CodeBurn (aka AgentSeal, `npx codeburn`,
~8.5k stars, MIT, local-first) is primarily a token/cost tracker — BUT it already ships a **`yield`
command that correlates sessions with git commits into Productive / Reverted / Abandoned buckets.**
That is conceptually *our* survival rate. It launched on HN as "Show HN: CodeBurn – Analyze Claude
Code token usage by task" and hit **112 pts / 27 comments (2026-04-13)**.

We cannot pretend the space is empty. Win by **narrowing, not matching**:
1. **Survival rate is THE product, not a buried subcommand.** CodeBurn hides `yield` among cost
   features; for us it's the first-class, benchmark-style, screenshot-able number. "The
   survival-rate tool," never "another cost tracker."
2. **Go deeper on git correlation** — line-level survival / churn over time, not just
   commit-timestamp bucketing.
3. **The polished, signed Mac app** — CodeBurn is CLI-only; our dashboard is the PH/visual hook.
4. **Say it out loud.** In HN/Reddit comments, when CodeBurn comes up (it will), be gracious:
   "CodeBurn's `yield` pointed the same direction; AgentTrace makes that one number the whole
   point and goes to line-level." Owning the comparison reads as confident, not defensive.

**Complementary, not threats** (don't fight these; they validate the "shareable stat" appetite):
- **AgentGraphed** (`npx agentgraphed`, ~43 stars) — session timeline/resume + cost; uses git
  only to detect project roots, no survival tracking. Has a leaderboard/share-card idea but no
  traction.
- Claude Wrapped, Year in Code, ccheatmap, CCTray, Claumon, etc. — one-off "wrapped"/stat toys;
  none do git-correlated survival. Proof the number-as-status pattern works.

> 🔧 **Memory correction:** prior notes named "CodeChurn" and "Traceseal" as competitors — no live
> repos found under those exact names (2026-07-06). The tool actually occupying the
> "did-it-stick" space today is **CodeBurn/AgentSeal**. (memory `market-research-2026-07` updated.)

## Verified channels (research pass, 2026-07-06)

**awesome-claude-code** — `github.com/hesreallyhim/awesome-claude-code`, ~48.5k★, updated daily.
Submit via **issue form** (not PR), category **Observability**. See Tier-2 §5 above. No other
Claude Code list exists at meaningful scale.

**Subreddits** (member counts ≈ from a third-party aggregator — verify sidebar self-promo rules
manually before posting):
- **r/ClaudeAI** — ~992k. Primary target.
- **r/ClaudeCode** — ~341k, fastest-growing; the most on-topic power-user audience.
- r/Anthropic ~176k · r/claude ~139k · r/LocalLLaMA (broader). Norm: self-promo tolerated if
  framed "I built this free/open-source tool" with the repo link — not a landing-page pitch.

**X/Twitter** — the topic space is **#ClaudeCode**; individual dev accounts (e.g. ccusage's
@cc_usage / ryoppippi) drive far more than hashtags. Screenshots-as-status is the proven pattern.

**Anthropic's own Discord / forum** — exists but invite links + self-promo policy unverified from
research; check directly before relying on it.

**How ccusage actually got traction (the model to mirror):** built in ~4 hours *right after the
Opus 4 announcement* (first-mover on a fresh universal pain); breakout was an **organic HN post by
a third party** (75 pts, 2025-07-18) *after* it was already circulating — not a Show HN by the
author; amplified by a Greg Baugues YouTube interview and by people **sharing screenshots as a
status symbol** ("next-gen commit graph"). Now ~16.9k★, 107k+ downloads. Lesson: the shareable
number + easy `npx` + riding a launch moment is exactly our play.

**Show HN reality check:** local-first Claude Code tools *can* hit the front page (CodeBurn 112pts;
"Recall – local project memory" 138pts/85comments), but the *majority* of attempts in this niche
score 1–4 pts. Title must start "Show HN:", must be runnable with no signup (our strength), and
**never solicit upvotes** (HN penalizes it). Realistic outcome is a coin flip — the survival-rate
novelty is what differentiates from the cost-tracker pack.

**Product Hunt specifics:** launch **12:01 AM Pacific**, **Tue/Wed**, 24-hr window. First-hour
velocity > total votes; expect 40–60% of votes from your own audience, so line them up for 12:05.
Tagline < 60 chars, outcome-driven ("[action] for [audience]"). ≥3 gallery images with the
**survival-rate number as the hero image** + a short workflow video. Self-hunting is fine (≈79% of
featured posts are). Never ask directly for upvotes — say "check it out."

---

## After posting — what to watch (the demand signal)

Run **`npm run metrics`** (see `scripts/metrics.mjs`) for a one-command dated snapshot of every
proxy below. AgentTrace is zero-telemetry, so we can't measure active usage directly — every
number is a public proxy, tracked as a funnel:

| Funnel stage | Metric | Source |
|---|---|---|
| **Reach** | HN points, Reddit upvotes, X impressions, GH traffic views | manual + `npm run metrics` |
| **Interest** | GitHub stars, unique visitors, clones | `npm run metrics` |
| **Install (north star)** | **weekly `agenttrace-cli` npm downloads** | `npm run metrics` |
| **Install (app)** | `.dmg` download counts (arm64 + intel) | `npm run metrics` |
| **Engagement** | inbound issues / "can it also do X" / ActionProof-bridge mentions | repo Insights |

**North star: weekly npm downloads of `agenttrace-cli`** — the best proxy for "people actually
running it" — with `.dmg` downloads and GitHub stars as co-primaries. Any inbound "can it also
do X" is the roadmap *and* the signal for what to build next (and what the paid tier anchors on).

Baseline at launch (2026-07-06): 0 stars, 3 .dmg downloads, npm just published. ActionProof
sibling sits at ~120 npm/mo from its directory-submission launch — that's the number to beat.
