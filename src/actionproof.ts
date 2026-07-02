/**
 * Bridge to ActionProof — the paid/cryptographic sibling of AgentTrace.
 *
 * AgentTrace shows what your agents did (heuristic). ActionProof lets you *prove*
 * it (Ed25519-signed receipts). This module is the "✓ verified" bridge: from a
 * session's drill-down you can sign its outcome into a real, tamper-evident
 * receipt and verify it — all offline, using the SAME agent identity that the
 * ActionProof MCP server uses (~/.actionproof/agent.key.pem).
 *
 * ActionProof is an OPTIONAL peer: we import its built package dynamically so
 * AgentTrace still runs with zero setup when it isn't present — the Sign button
 * simply reports that ActionProof isn't installed.
 */
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

import type { Session, Action } from "./types.ts";

/** Where we persist signed receipts, keyed by session id. */
const RECEIPTS_PATH = join(homedir(), ".agenttrace", "receipts.json");

/** Candidate locations for the built ActionProof package (first hit wins). */
function actionproofCandidates(): string[] {
  const c: string[] = [];
  if (process.env.ACTIONPROOF_DIR) c.push(join(process.env.ACTIONPROOF_DIR, "dist"));
  // Sibling checkout next to agenttrace (the common local-dev layout).
  c.push(join(homedir(), "Documents", "actionproof", "dist"));
  // Installed as a dependency.
  c.push(join(process.cwd(), "node_modules", "actionproof", "dist"));
  return c;
}

// The subset of ActionProof's API we use, loaded lazily.
interface ActionProofApi {
  loadOrCreateKeypair: (path?: string) => { kp: unknown; path: string; created: boolean };
  attest: (kp: unknown, action: Record<string, unknown>) => unknown;
  verify: (signed: unknown, opts?: unknown) => { valid: boolean; agent?: string; reason?: string };
}

let apiPromise: Promise<ActionProofApi | null> | null = null;

/** Dynamically import ActionProof's built modules; null if not installed. */
function loadApi(): Promise<ActionProofApi | null> {
  if (apiPromise) return apiPromise;
  apiPromise = (async () => {
    for (const dist of actionproofCandidates()) {
      const indexJs = join(dist, "index.js");
      const keystoreJs = join(dist, "keystore.js");
      if (!existsSync(indexJs) || !existsSync(keystoreJs)) continue;
      try {
        const index = await import(indexJs);
        const keystore = await import(keystoreJs);
        return {
          loadOrCreateKeypair: keystore.loadOrCreateKeypair,
          attest: index.attest,
          verify: index.verify,
        } as ActionProofApi;
      } catch {
        /* try the next candidate */
      }
    }
    return null;
  })();
  return apiPromise;
}

export function isActionProofAvailable(): Promise<boolean> {
  return loadApi().then((a) => a !== null);
}

/** A stored, verified receipt plus the verification result, for the UI. */
export interface StoredReceipt {
  sessionId: string;
  signedAt: string;
  agent: string;
  receipt: unknown;
  verified: boolean;
}

function readReceipts(): Record<string, StoredReceipt> {
  try {
    return JSON.parse(readFileSync(RECEIPTS_PATH, "utf8"));
  } catch {
    return {};
  }
}

function writeReceipts(all: Record<string, StoredReceipt>): void {
  mkdirSync(dirname(RECEIPTS_PATH), { recursive: true });
  writeFileSync(RECEIPTS_PATH, JSON.stringify(all, null, 2));
}

/** Session ids that already have a verified receipt (for the ✓ badge on load). */
export function verifiedSessionIds(): Set<string> {
  const all = readReceipts();
  return new Set(Object.values(all).filter((r) => r.verified).map((r) => r.sessionId));
}

/**
 * Sign a session's outcome into a real ActionProof receipt, verify it, persist
 * it, and return it. `nowISO` is passed in (the caller stamps time) so this stays
 * deterministic and testable.
 */
export async function signSession(
  session: Session,
  nowISO: string,
): Promise<{ ok: true; receipt: StoredReceipt } | { ok: false; error: string }> {
  const api = await loadApi();
  if (!api) {
    return {
      ok: false,
      error:
        "ActionProof isn't installed. Clone it next to agenttrace or set ACTIONPROOF_DIR.",
    };
  }

  try {
    // Use the SAME persistent identity as the ActionProof MCP server.
    const { kp } = api.loadOrCreateKeypair();

    // The action we're attesting: "AgentTrace observed this session's outcome."
    // params/result are hashed by ActionProof — we bind the real evidence
    // (files, commits, tools) so the receipt is tied to this exact session.
    const signed = api.attest(kp, {
      type: "agenttrace.session.attest",
      target: session.cwd || "unknown",
      summary: `${session.title} — outcome: ${session.outcome.label}`,
      params: {
        sessionId: session.id,
        model: session.model,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        filesChanged: session.filesChanged.map((f) => f.path).sort(),
        toolCounts: session.toolCounts,
      },
      result: {
        outcome: session.outcome.label,
        reason: session.outcome.reason,
        commits: session.outcome.commits.map((c) => c.hash),
      },
      outcome: session.outcome.label === "reverted" ? "failed" : "ok",
      agentName: "agenttrace",
      ts: nowISO,
    });

    const v = api.verify(signed);
    const stored: StoredReceipt = {
      sessionId: session.id,
      signedAt: nowISO,
      agent: v.agent ?? "unknown",
      receipt: signed,
      verified: v.valid,
    };

    const all = readReceipts();
    all[session.id] = stored;
    writeReceipts(all);

    return { ok: true, receipt: stored };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message ?? String(err) };
  }
}

/**
 * Sign a SINGLE action into its own receipt and verify it. This is the unit
 * ActionProof is designed around — proving each discrete thing the agent did
 * (a file write, a shell command) rather than only the session as a whole.
 */
export async function signAction(
  session: Session,
  seq: number,
  nowISO: string,
): Promise<{ ok: true; verified: boolean; agent: string; receipt: unknown } | { ok: false; error: string }> {
  const api = await loadApi();
  if (!api) {
    return { ok: false, error: "ActionProof isn't installed." };
  }
  const action: Action | undefined = session.actions.find((a) => a.seq === seq);
  if (!action) return { ok: false, error: "action not found" };

  try {
    const { kp } = api.loadOrCreateKeypair();
    const signed = api.attest(kp, {
      type: action.type,
      target: action.target ?? session.cwd,
      summary: action.summary,
      params: { sessionId: session.id, seq: action.seq, tool: action.tool },
      outcome: "ok",
      agentName: "agenttrace",
      ts: nowISO,
    });
    const v = api.verify(signed);
    return { ok: true, verified: v.valid, agent: v.agent ?? "unknown", receipt: signed };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message ?? String(err) };
  }
}
