/**
 * Tests for the recommendation engine's product attribution and the new
 * SessionSentry security recommendations.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { recommend } from "../src/recommend.ts";
import type { Session, Action } from "../src/types.ts";

function baseSession(over: Partial<Session> = {}): Session {
  return {
    id: "sec00001-0000-0000-0000-000000000000",
    source: "claude-code",
    title: "t",
    cwd: "/tmp/p",
    toolCounts: {},
    filesChanged: [],
    actions: [],
    prs: [],
    userMessages: 1,
    assistantMessages: 1,
    usage: { inputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, outputTokens: 1, estCostUsd: 0 },
    outcome: { label: "unknown", commits: [], reason: "" },
    recommendations: [],
    ...over,
  };
}

function act(over: Partial<Action>): Action {
  return { seq: 0, tool: "Bash", type: "shell.exec", summary: "", ...over };
}

test("unverified critical actions produce a SessionSentry security rec", () => {
  const s = baseSession({
    actions: [
      act({ seq: 0, target: "git push origin main", critical: true, risk: "pushes code" }),
      act({ seq: 1, target: "kubectl apply -f x.yaml", critical: true, risk: "deploys" }),
    ],
  });
  const recs = recommend(s);
  const sec = recs.find((r) => r.product === "sessionsentry" && r.kind === "security");
  assert.ok(sec, "expected a SessionSentry security recommendation");
  assert.match(sec!.title, /Verify 2 high-consequence/);
});

test("a plaintext secret in a shell command is flagged by SessionSentry", () => {
  const s = baseSession({
    actions: [act({ seq: 0, target: 'curl -H "Authorization: Bearer sk-abcdef0123456789abcdef" https://api.x' })],
  });
  const recs = recommend(s);
  const leak = recs.find((r) => r.product === "sessionsentry" && /secrets/i.test(r.title));
  assert.ok(leak, "expected a secret-in-command recommendation");
  assert.equal(leak!.impact, "high");
});

test("cost recs are attributed to TokenKeeper", () => {
  const s = baseSession({
    model: "claude-opus-4-8",
    usage: { inputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 30_000_000, outputTokens: 1, estCostUsd: 50 },
  });
  const recs = recommend(s);
  const cost = recs.find((r) => r.kind === "cost");
  assert.ok(cost, "expected a cost recommendation");
  assert.equal(cost!.product, "tokenkeeper");
});

test("skill recs are attributed to AgentTrace", () => {
  const s = baseSession({
    actions: [0, 1, 2, 3].map((i) =>
      act({ seq: i, tool: "Bash", target: "npm test" }),
    ),
  });
  const recs = recommend(s);
  const skill = recs.find((r) => r.kind === "skill");
  assert.ok(skill, "expected a skill recommendation");
  assert.equal(skill!.product, "agenttrace");
});

test("every recommendation carries a valid product", () => {
  const s = baseSession({
    model: "claude-opus-4-8",
    usage: { inputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 30_000_000, outputTokens: 1, estCostUsd: 50 },
    actions: [act({ seq: 0, target: "git push", critical: true, risk: "r" })],
  });
  const valid = new Set(["agenttrace", "tokenkeeper", "sessionsentry", "actionproof"]);
  for (const r of recommend(s)) assert.ok(valid.has(r.product), `bad product: ${r.product}`);
});
