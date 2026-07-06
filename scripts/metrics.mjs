/**
 * Adoption snapshot for AgentTrace — one command, one dated table.
 *
 * AgentTrace is zero-telemetry by design, so we can't measure active usage
 * directly. Every number here is a PUBLIC proxy pulled live:
 *   - npm downloads   (best "people ran it" proxy)      → api.npmjs.org
 *   - .dmg downloads  (Mac-app installs)                → GitHub releases API
 *   - stars / forks / watchers                          → GitHub repo API
 *   - traffic views + clones (needs repo push access)   → `gh api` (authed)
 *
 * No secrets, no writes, no telemetry — just reads. `gh` is optional; the
 * traffic rows degrade to "—  (gh not available / not authed)" without it.
 *
 * Usage:
 *   npm run metrics            # human table
 *   npm run metrics -- --json  # machine-readable, for logging snapshots over time
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

const REPO = "Burakfenerci5/agenttrace";
const NPM_PKG = "agenttrace-cli";
// ActionProof is the paid sibling launched earlier — carry it as a baseline so
// each snapshot shows AgentTrace relative to a launch we've already run.
const BASELINE_NPM = "actionproof";

const NA = "—";

/** GET JSON with a short timeout; return null on any failure (never throw). */
async function getJson(url) {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "agenttrace-metrics" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Run `gh api <path>` and parse JSON; null if gh missing/unauthed/errored. */
async function ghJson(path) {
  try {
    const { stdout } = await execFileP("gh", ["api", path], { timeout: 15_000 });
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

/**
 * Read a GitHub REST path, preferring the `gh` CLI (authed → no 60/hr
 * unauthenticated rate limit, and the traffic endpoints REQUIRE auth). Fall
 * back to the public REST API so the script still works without `gh`.
 * Returns { data, viaGh } so callers can tell the traffic rows apart from a
 * genuine zero.
 */
async function github(path) {
  const viaGh = await ghJson(path);
  if (viaGh !== null) return { data: viaGh, viaGh: true };
  const viaFetch = await getJson(`https://api.github.com/${path}`);
  return { data: viaFetch, viaGh: false };
}

/** last-month download point for an npm package (null if unpublished/no data yet). */
async function npmLastMonth(pkg) {
  const d = await getJson(`https://api.npmjs.org/downloads/point/last-month/${pkg}`);
  return d && typeof d.downloads === "number" ? d.downloads : null;
}

async function npmLastWeek(pkg) {
  const d = await getJson(`https://api.npmjs.org/downloads/point/last-week/${pkg}`);
  return d && typeof d.downloads === "number" ? d.downloads : null;
}

async function main() {
  const asJson = process.argv.includes("--json");

  // ── Reach / interest: GitHub repo (prefers authed `gh`, falls back to REST) ──
  const { data: repo } = await github(`repos/${REPO}`);

  // ── Install (app): release-asset download counts ──
  const { data: releases } = await github(`repos/${REPO}/releases`);
  const dmgAssets = [];
  if (Array.isArray(releases)) {
    for (const rel of releases) {
      for (const a of rel.assets ?? []) {
        if (a.name.endsWith(".dmg")) {
          dmgAssets.push({ name: a.name, downloads: a.download_count, tag: rel.tag_name });
        }
      }
    }
  }
  const dmgTotal = dmgAssets.reduce((n, a) => n + a.downloads, 0);

  // ── Install (CLI): npm downloads (public) ──
  const [npmWeek, npmMonth, baseWeek, baseMonth] = await Promise.all([
    npmLastWeek(NPM_PKG),
    npmLastMonth(NPM_PKG),
    npmLastWeek(BASELINE_NPM),
    npmLastMonth(BASELINE_NPM),
  ]);

  // ── Reach: repo traffic (needs push access → only works via authed `gh`) ──
  const { data: viewsData } = await github(`repos/${REPO}/traffic/views`);
  const { data: clonesData } = await github(`repos/${REPO}/traffic/clones`);
  const pair = (d) =>
    d && typeof d.count === "number" ? { count: d.count, uniques: d.uniques } : null;
  const views = pair(viewsData);
  const clones = pair(clonesData);

  const snapshot = {
    capturedAt: new Date().toISOString(),
    repo: REPO,
    github: repo
      ? {
          stars: repo.stargazers_count,
          forks: repo.forks_count,
          watchers: repo.subscribers_count,
          openIssues: repo.open_issues_count,
        }
      : null,
    trafficLast14d: { views, clones },
    npm: { pkg: NPM_PKG, lastWeek: npmWeek, lastMonth: npmMonth },
    dmg: { total: dmgTotal, assets: dmgAssets },
    baseline: { pkg: BASELINE_NPM, lastWeek: baseWeek, lastMonth: baseMonth },
  };

  if (asJson) {
    process.stdout.write(JSON.stringify(snapshot, null, 2) + "\n");
    return;
  }

  const v = (x) => (x === null || x === undefined ? NA : String(x));
  const line = "─".repeat(52);
  const out = [];
  out.push("");
  out.push(`  AgentTrace adoption — ${snapshot.capturedAt.slice(0, 16).replace("T", " ")} UTC`);
  out.push(`  ${REPO}`);
  out.push("  " + line);
  out.push("  FUNNEL STAGE          METRIC                    VALUE");
  out.push("  " + line);
  out.push(`  Reach      GitHub views (14d)         ${v(views?.count)}  (${v(views?.uniques)} unique)`);
  out.push(`  Reach      Clones (14d)               ${v(clones?.count)}  (${v(clones?.uniques)} unique)`);
  out.push(`  Interest   ★ Stars                    ${v(snapshot.github?.stars)}`);
  out.push(`  Interest   Forks                      ${v(snapshot.github?.forks)}`);
  out.push(`  Interest   Open issues                ${v(snapshot.github?.openIssues)}`);
  out.push("  " + line);
  out.push(`  Install ▶  npm ${NPM_PKG}   /wk  ${v(npmWeek)}   /mo  ${v(npmMonth)}   ★ north star`);
  out.push(`  Install    .dmg downloads (all)       ${v(dmgTotal)}`);
  for (const a of dmgAssets) {
    out.push(`               ${a.name.padEnd(30)} ${v(a.downloads)}`);
  }
  out.push("  " + line);
  out.push(`  Baseline   npm ${BASELINE_NPM} (sibling)  /wk ${v(baseWeek)}   /mo ${v(baseMonth)}`);
  out.push("  " + line);
  if (!views) {
    out.push("  note: traffic rows need `gh` + repo push access (gh auth login).");
  }
  if (npmMonth === null) {
    out.push("  note: npm shows 0/no-data for ~24–48h after first publish.");
  }
  out.push("");
  process.stdout.write(out.join("\n") + "\n");
}

main();
