/**
 * Tests for transcript parsing: token/cost aggregation, action extraction,
 * critical-action detection, and robustness to malformed / partial input.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseTranscript } from "../src/parse.ts";

/** Write a JSONL transcript to a temp file and return its path. */
function fixture(lines: unknown[]): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "agenttrace-test-"));
  const path = join(dir, "11111111-2222-3333-4444-555555555555.jsonl");
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("parses messages, model, usage, and estimates cost", () => {
  const { path, cleanup } = fixture([
    { type: "user", timestamp: "2026-06-01T10:00:00Z", cwd: "/tmp/proj" },
    {
      type: "assistant",
      timestamp: "2026-06-01T10:05:00Z",
      message: {
        role: "assistant",
        model: "claude-opus-4-8-20260101",
        usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 2000 },
        content: [{ type: "tool_use", name: "Write", input: { file_path: "/tmp/proj/a.ts" } }],
      },
    },
  ]);
  try {
    const s = parseTranscript(path);
    assert.equal(s.userMessages, 1);
    assert.equal(s.assistantMessages, 1);
    assert.equal(s.model, "claude-opus-4-8-20260101");
    assert.equal(s.usage.inputTokens, 1000);
    assert.equal(s.usage.outputTokens, 500);
    assert.equal(s.usage.cacheReadTokens, 2000);
    // opus: (1000*15 + 500*75 + 2000*1.5)/1e6
    const expected = (1000 * 15 + 500 * 75 + 2000 * 1.5) / 1_000_000;
    assert.ok(Math.abs(s.usage.estCostUsd - expected) < 1e-9);
    assert.equal(s.durationMin, 5);
    assert.equal(s.filesChanged.length, 1);
    assert.equal(s.filesChanged[0].created, true);
    assert.equal(s.cwd, "/tmp/proj");
  } finally {
    cleanup();
  }
});

test("skips malformed JSONL lines without throwing", () => {
  const { path, cleanup } = fixture([{ type: "user", timestamp: "2026-06-01T10:00:00Z" }]);
  try {
    // Append a truncated/garbage line like a transcript cut mid-write.
    writeFileSync(path, `{"type":"user","timestamp":"2026-06-01T10:00:00Z"}\n{"type":"assist`, { flag: "w" });
    const s = parseTranscript(path);
    assert.equal(s.userMessages, 1);
  } finally {
    cleanup();
  }
});

test("ignores unparseable timestamps (no NaN duration)", () => {
  const { path, cleanup } = fixture([
    { type: "user", timestamp: "not-a-date" },
    { type: "assistant", timestamp: "2026-06-01T10:00:00Z", message: { role: "assistant" } },
    { type: "assistant", timestamp: "2026-06-01T10:10:00Z", message: { role: "assistant" } },
  ]);
  try {
    const s = parseTranscript(path);
    assert.equal(s.durationMin, 10);
    assert.ok(!Number.isNaN(s.durationMin));
  } finally {
    cleanup();
  }
});

test("flags critical shell actions with a risk string", () => {
  const { path, cleanup } = fixture([
    {
      type: "assistant",
      timestamp: "2026-06-01T10:00:00Z",
      message: {
        role: "assistant",
        content: [
          { type: "tool_use", name: "Bash", input: { command: "git push origin main" } },
          { type: "tool_use", name: "Bash", input: { command: "ls -la" } },
        ],
      },
    },
  ]);
  try {
    const s = parseTranscript(path);
    const push = s.actions.find((a) => a.target?.includes("git push"));
    const ls = s.actions.find((a) => a.target?.includes("ls -la"));
    assert.ok(push?.critical, "git push should be critical");
    assert.ok(push?.risk && push.risk.length > 0);
    assert.equal(ls?.critical, false);
    assert.equal(push?.type, "shell.exec");
  } finally {
    cleanup();
  }
});

test("no file edits yields a no-changes-ready session", () => {
  const { path, cleanup } = fixture([
    { type: "user", timestamp: "2026-06-01T10:00:00Z" },
    { type: "assistant", timestamp: "2026-06-01T10:01:00Z", message: { role: "assistant" } },
  ]);
  try {
    const s = parseTranscript(path);
    assert.equal(s.filesChanged.length, 0);
    assert.equal(s.actions.length, 0);
  } finally {
    cleanup();
  }
});
