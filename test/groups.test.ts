/**
 * Tests for the user-defined session-groups store. HOME is redirected to a
 * temp dir before importing so the real ~/.agenttrace/groups.json is untouched.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOME = mkdtempSync(join(tmpdir(), "agenttrace-groups-"));
process.env.HOME = HOME;

const { readGroups, addGroup, assignSessions, renameGroup, renameSession, deleteGroup, DEFAULT_GROUPS } =
  await import("../src/groups.ts");

test("defaults to Personal/Entrepreneurial/Business when empty", () => {
  const s = readGroups();
  assert.deepEqual(s.groups, [...DEFAULT_GROUPS]);
  assert.deepEqual(s.assignments, {});
  assert.deepEqual(s.titles, {});
});

test("assignSessions files sessions under a group and persists", () => {
  assignSessions(["s1", "s2"], "Business");
  const s = readGroups();
  assert.equal(s.assignments["s1"], "Business");
  assert.equal(s.assignments["s2"], "Business");
});

test("assigning to a brand-new group creates it", () => {
  assignSessions(["s3"], "Side Project");
  const s = readGroups();
  assert.ok(s.groups.includes("Side Project"));
  assert.equal(s.assignments["s3"], "Side Project");
});

test("assigning null un-groups sessions", () => {
  assignSessions(["s1"], null);
  const s = readGroups();
  assert.equal(s.assignments["s1"], undefined);
  assert.equal(s.assignments["s2"], "Business"); // untouched
});

test("addGroup is idempotent", () => {
  const before = readGroups().groups.length;
  addGroup("Business"); // already exists
  assert.equal(readGroups().groups.length, before);
  addGroup("Research"); // new
  assert.ok(readGroups().groups.includes("Research"));
});

test("renameGroup re-points assignments", () => {
  assignSessions(["s4"], "Business");
  renameGroup("Business", "Company");
  const s = readGroups();
  assert.ok(s.groups.includes("Company"));
  assert.ok(!s.groups.includes("Business"));
  assert.equal(s.assignments["s2"], "Company");
  assert.equal(s.assignments["s4"], "Company");
});

test("deleteGroup removes it and clears its assignments", () => {
  deleteGroup("Company");
  const s = readGroups();
  assert.ok(!s.groups.includes("Company"));
  assert.equal(s.assignments["s2"], undefined);
  assert.equal(s.assignments["s4"], undefined);
});

test("renameSession stores a title override and a blank clears it", () => {
  renameSession("s5", "  My renamed session  ");
  assert.equal(readGroups().titles["s5"], "My renamed session"); // trimmed
  renameSession("s5", "   "); // blank restores the original (drops override)
  assert.equal(readGroups().titles["s5"], undefined);
});

test("renameSession override is independent of group assignment", () => {
  assignSessions(["s6"], "Personal");
  renameSession("s6", "Custom name");
  const s = readGroups();
  assert.equal(s.titles["s6"], "Custom name");
  assert.equal(s.assignments["s6"], "Personal"); // unaffected
});

test.after(() => rmSync(HOME, { recursive: true, force: true }));
