/**
 * Tests for the dashboard's local-only guard and shell/AppleScript quoting.
 * These protect two sensitive endpoints (/api/launch spawns processes,
 * /api/sign writes files), so they're the highest-value things to lock down.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  isLoopbackHost,
  isLocalRequest,
  shellQuote,
  appleScriptString,
  readBody,
  MAX_BODY_BYTES,
  SECURITY_HEADERS,
  isLaunchableCwd,
} from "../src/dashboard.ts";

/** A minimal async-iterable stand-in for an IncomingMessage body. */
async function* bodyOf(...chunks: (string | Buffer)[]) {
  for (const c of chunks) yield c as never;
}

test("isLoopbackHost accepts loopback literals", () => {
  for (const h of [
    "localhost",
    "localhost:4317",
    "127.0.0.1",
    "127.0.0.1:4317",
    "127.5.5.5",
    "[::1]",
    "[::1]:4317",
    "::1",
    "LOCALHOST:4317",
  ]) {
    assert.equal(isLoopbackHost(h), true, `expected loopback: ${h}`);
  }
});

test("isLoopbackHost rejects non-loopback hosts", () => {
  for (const h of [
    "evil.com",
    "evil.com:4317",
    "10.0.0.5",
    "192.168.1.9:4317",
    "attacker.127.0.0.1.nip.io",
    "example.com",
    "",
  ]) {
    assert.equal(isLoopbackHost(h), false, `expected non-loopback: ${h}`);
  }
});

test("isLocalRequest requires a loopback Host header", () => {
  assert.equal(isLocalRequest({ headers: { host: "127.0.0.1:4317" } }), true);
  assert.equal(isLocalRequest({ headers: { host: "evil.com" } }), false);
  assert.equal(isLocalRequest({ headers: {} }), false); // no Host at all
});

test("isLocalRequest rejects cross-origin Origin/Referer (CSRF)", () => {
  // A malicious page fetching our port sends its own Origin.
  assert.equal(
    isLocalRequest({ headers: { host: "127.0.0.1:4317", origin: "https://evil.com" } }),
    false,
  );
  assert.equal(
    isLocalRequest({ headers: { host: "127.0.0.1:4317", referer: "https://evil.com/x" } }),
    false,
  );
  // Same-origin browser requests are fine.
  assert.equal(
    isLocalRequest({ headers: { host: "127.0.0.1:4317", origin: "http://127.0.0.1:4317" } }),
    true,
  );
  // No Origin (curl / the agent) is allowed once Host passes.
  assert.equal(isLocalRequest({ headers: { host: "localhost:4317" } }), true);
});

test("isLocalRequest rejects a malformed Origin", () => {
  assert.equal(
    isLocalRequest({ headers: { host: "127.0.0.1:4317", origin: "not a url" } }),
    false,
  );
});

test("shellQuote neutralizes shell metacharacters", () => {
  // A cwd/prompt an attacker or an odd path might contain must not break out.
  const evil = `/tmp/x'; rm -rf ~; echo '`;
  const quoted = shellQuote(evil);
  // Result is a single-quoted token; embedded single quotes are escaped.
  assert.equal(quoted.startsWith("'") && quoted.endsWith("'"), true);
  assert.equal(quoted.includes(`'\\''`), true);
  // Round-trip through the shell yields the original string, unexecuted.
  // (We can't exec here, but assert no unescaped single quote splits the token.)
  const inner = quoted.slice(1, -1);
  assert.equal(inner.split(`'\\''`).join("'"), evil);
});

test("shellQuote handles a path with spaces", () => {
  assert.equal(shellQuote("/Users/me/World Cup/x"), "'/Users/me/World Cup/x'");
});

test("appleScriptString escapes backslashes and quotes", () => {
  assert.equal(appleScriptString(`say "hi"`), `"say \\"hi\\""`);
  assert.equal(appleScriptString(`a\\b`), `"a\\\\b"`);
});

test("readBody returns the concatenated body when under the cap", async () => {
  const body = await readBody(bodyOf('{"a":', "1}"));
  assert.equal(body, '{"a":1}');
});

test("readBody rejects a body that exceeds MAX_BODY_BYTES (memory-DoS guard)", async () => {
  const oversized = "x".repeat(MAX_BODY_BYTES + 1);
  await assert.rejects(() => readBody(bodyOf(oversized)), /payload too large/);
});

test("readBody counts bytes across chunks, not just per-chunk", async () => {
  const half = "x".repeat(Math.ceil(MAX_BODY_BYTES / 2) + 1); // two halves > cap
  await assert.rejects(() => readBody(bodyOf(half, half)), /payload too large/);
});

test("SECURITY_HEADERS locks the page down (CSP, nosniff, no framing)", () => {
  const csp = SECURITY_HEADERS["content-security-policy"];
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /connect-src 'self'/); // no exfiltration to other origins
  assert.match(csp, /frame-ancestors 'none'/); // clickjacking
  assert.equal(SECURITY_HEADERS["x-content-type-options"], "nosniff");
  assert.equal(SECURITY_HEADERS["x-frame-options"], "DENY");
  assert.equal(SECURITY_HEADERS["referrer-policy"], "no-referrer");
});

test("isLaunchableCwd accepts a real directory, rejects bogus/relative/NUL paths", () => {
  const dir = mkdtempSync(join(tmpdir(), "agenttrace-cwd-"));
  try {
    assert.equal(isLaunchableCwd(dir), true);
    assert.equal(isLaunchableCwd(""), false);
    assert.equal(isLaunchableCwd("relative/path"), false); // must be absolute
    assert.equal(isLaunchableCwd("/no/such/dir/here-xyz"), false);
    assert.equal(isLaunchableCwd(join(dir, "\0evil")), false); // NUL byte
    assert.equal(isLaunchableCwd(join(dir, "not-a-real-file")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
