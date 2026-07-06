/**
 * User-defined session groups — a durable, human-chosen way to organize
 * sessions that cuts across projects. The user selects sessions in the
 * dashboard and files them under a named group (default set: Personal,
 * Entrepreneurial, Business), then sorts/groups the list by it.
 *
 * State is server-side (~/.agenttrace/groups.json) so it survives restarts and
 * is shared by the CLI and the desktop app, mirroring the recstate store.
 */
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const GROUPS_PATH = join(homedir(), ".agenttrace", "groups.json");

/** The default groups the user tracks by, in display order. */
export const DEFAULT_GROUPS = ["Personal", "Entrepreneurial", "Business"] as const;

export interface GroupStore {
  /** Ordered list of group names the user has defined. */
  groups: string[];
  /** sessionId -> group name (a session belongs to at most one group). */
  assignments: Record<string, string>;
  /** sessionId -> custom title the user renamed it to (overrides the parsed title). */
  titles: Record<string, string>;
}

export function readGroups(): GroupStore {
  try {
    const parsed = JSON.parse(readFileSync(GROUPS_PATH, "utf8"));
    return {
      groups: Array.isArray(parsed.groups) && parsed.groups.length ? parsed.groups : [...DEFAULT_GROUPS],
      assignments: parsed.assignments && typeof parsed.assignments === "object" ? parsed.assignments : {},
      titles: parsed.titles && typeof parsed.titles === "object" ? parsed.titles : {},
    };
  } catch {
    return { groups: [...DEFAULT_GROUPS], assignments: {}, titles: {} };
  }
}

function writeGroups(s: GroupStore): void {
  mkdirSync(dirname(GROUPS_PATH), { recursive: true });
  writeFileSync(GROUPS_PATH, JSON.stringify(s, null, 2));
}

/** Ensure a group exists (idempotent); returns the updated store. */
export function addGroup(name: string): GroupStore {
  const store = readGroups();
  const trimmed = name.trim();
  if (trimmed && !store.groups.includes(trimmed)) {
    store.groups.push(trimmed);
    writeGroups(store);
  }
  return store;
}

/**
 * Assign sessions to a group (creating the group if new). Passing group=null
 * un-assigns them. Returns the updated store.
 */
export function assignSessions(sessionIds: string[], group: string | null): GroupStore {
  const store = readGroups();
  if (group) {
    const trimmed = group.trim();
    if (trimmed && !store.groups.includes(trimmed)) store.groups.push(trimmed);
    for (const id of sessionIds) store.assignments[id] = trimmed;
  } else {
    for (const id of sessionIds) delete store.assignments[id];
  }
  writeGroups(store);
  return store;
}

/**
 * Rename one session: store a custom title override (or clear it when the title
 * is blank / restored). Returns the updated store. The override wins over the
 * parsed transcript title everywhere the session is shown.
 */
export function renameSession(sessionId: string, title: string): GroupStore {
  const store = readGroups();
  const trimmed = title.trim();
  if (trimmed) store.titles[sessionId] = trimmed;
  else delete store.titles[sessionId];
  writeGroups(store);
  return store;
}

/** Rename a group and re-point every assignment to the new name. */
export function renameGroup(from: string, to: string): GroupStore {
  const store = readGroups();
  const trimmed = to.trim();
  if (!trimmed) return store;
  store.groups = store.groups.map((g) => (g === from ? trimmed : g));
  for (const id of Object.keys(store.assignments)) {
    if (store.assignments[id] === from) store.assignments[id] = trimmed;
  }
  writeGroups(store);
  return store;
}

/** Delete a group definition and clear its assignments. */
export function deleteGroup(name: string): GroupStore {
  const store = readGroups();
  store.groups = store.groups.filter((g) => g !== name);
  for (const id of Object.keys(store.assignments)) {
    if (store.assignments[id] === name) delete store.assignments[id];
  }
  writeGroups(store);
  return store;
}
