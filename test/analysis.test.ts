/**
 * Tests for the agent-readable analysis layer and the shared recommendation
 * state store. We point HOME at a temp dir so the real ~/.agenttrace is never
 * touched. Because analysis.ts resolves the store path from homedir() at import
 * time, we set HOME *before* importing it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Redirect HOME to a throwaway dir before importing the module under test.
const HOME = mkdtempSync(join(tmpdir(), "agenttrace-home-"));
process.env.HOME = HOME;

const { setRecState, statesFor, toAgentMarkdown, toAgentJson, provenRoi } = await import(
  "../src/analysis.ts"
);
import type { Session } from "../src/types.ts";

function sampleSession(): Session {
  return {
    id: "abcd1234-0000-0000-0000-000000000000",
    source: "claude-code",
    title: "Test session",
    cwd: "/tmp/proj",
    startedAt: "2026-06-01T10:00:00Z",
    endedAt: "2026-06-01T10:30:00Z",
    durationMin: 30,
    toolCounts: { Bash: 2 },
    filesChanged: [{ path: "/tmp/proj/a.ts", edits: 1, created: true }],
    actions: [
      { seq: 0, tool: "Bash", type: "shell.exec", summary: "Bash: git push", target: "git push", critical: true, risk: "Pushes code to a remote." },
    ],
    prs: [],
    userMessages: 3,
    assistantMessages: 4,
    usage: { inputTokens: 100, cacheCreationTokens: 0, cacheReadTokens: 0, outputTokens: 50, estCostUsd: 0.01 },
    outcome: { label: "kept", commits: [{ hash: "deadbeef", subject: "do it", ts: "2026-06-01T10:20:00Z" }], reason: "landed" },
    recommendations: [
      { id: "abcd1234-0", kind: "skill", product: "agenttrace", title: "Add a git-flow skill", detail: "d", prompt: "make a skill", impact: "high", estSavingsUsd: 2, source: "heuristic" },
      { id: "abcd1234-1", kind: "cost", product: "tokenkeeper", title: "Trim context", detail: "d", prompt: "trim", impact: "medium", estSavingsUsd: 1, source: "heuristic" },
    ],
  };
}

test("setRecState persists and statesFor reads it back", () => {
  const s = sampleSession();
  setRecState(s.id, "abcd1234-0", "done", "agent", "2026-06-01T11:00:00Z", "did it");
  const states = statesFor(s.id);
  assert.equal(states["abcd1234-0"].status, "done");
  assert.equal(states["abcd1234-0"].by, "agent");
  assert.equal(states["abcd1234-0"].note, "did it");
});

test("toAgentMarkdown reflects open vs resolved recommendations", () => {
  const s = sampleSession();
  // rec 0 was marked done in the previous test; rec 1 remains open.
  const md = toAgentMarkdown(s);
  assert.match(md, /1 open, 1 resolved/);
  assert.match(md, /Trim context/); // open rec shown with its prompt
  assert.match(md, /Already resolved/); // closed section present
  assert.match(md, /Unverified high-consequence actions/); // critical action surfaced
  assert.match(md, /How to update this analysis/);
});

test("toAgentJson exposes recommendation status and critical actions", () => {
  const s = sampleSession();
  const j = toAgentJson(s) as any;
  assert.equal(j.sessionId, s.id);
  assert.equal(j.criticalUnverified.length, 1);
  assert.equal(j.criticalUnverified[0].type, "shell.exec");
  const rec0 = j.recommendations.find((r: any) => r.id === "abcd1234-0");
  assert.equal(rec0.status, "done");
  const rec1 = j.recommendations.find((r: any) => r.id === "abcd1234-1");
  assert.equal(rec1.status, "open");
});

test("provenRoi counts only done recs and attributes by product", () => {
  const s = sampleSession();
  // rec 0 (agenttrace/workflow) was marked done earlier; mark rec 1 (tokenkeeper) done too.
  setRecState(s.id, "abcd1234-1", "done", "human", "2026-06-01T12:00:00Z");
  const roi = provenRoi([s]);
  assert.equal(roi.applied, 2);
  assert.equal(roi.workflowImproved, 1); // rec 0
  assert.equal(roi.savedUsd, 1); // rec 1's estSavingsUsd
  assert.equal(roi.securityFixed, 0);
});

test("provenRoi ignores open/skipped recs", () => {
  const s = sampleSession();
  setRecState(s.id, "abcd1234-0", "open", "human", "2026-06-01T13:00:00Z");
  setRecState(s.id, "abcd1234-1", "skipped", "human", "2026-06-01T13:00:00Z");
  const roi = provenRoi([s]);
  assert.equal(roi.applied, 0);
  assert.equal(roi.savedUsd, 0);
});

test.after(() => rmSync(HOME, { recursive: true, force: true }));
