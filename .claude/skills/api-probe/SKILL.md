---
name: api-probe
description: Start the local AgentTrace dashboard server and hit its HTTP API with curl. Use when asked to test an endpoint, verify the server/guards work, check what the dashboard returns, or debug the API. Local-only (127.0.0.1); reads Claude Code sessions on disk.
---

# API probe

The AgentTrace dashboard is a zero-dependency HTTP server on **127.0.0.1** (see
`src/dashboard.ts`). It is **local-only by design**: requests must have a loopback
`Host` and no cross-origin `Origin`/`Referer`, or they get `403`. Endpoints that
POST are body-capped (1 MiB → `413`).

## 0. ALWAYS back up real state before probing write endpoints

`/api/groups`, `/api/recstate`, `/api/sign` mutate `~/.agenttrace/*.json`. Back up
first, restore after:

```bash
mkdir -p /tmp/at-backup && cp ~/.agenttrace/*.json /tmp/at-backup/ 2>/dev/null
# ... probe ...
# restore if anything changed:
cp /tmp/at-backup/*.json ~/.agenttrace/ 2>/dev/null
```

## 1. Start the server on a SCRATCH port (not the user's 4317)

```bash
cd /Users/bfenercioglu/Documents/agenttrace
node src/cli.ts serve --port 4321 > /tmp/at-serve.log 2>&1 &
echo "pid $!"; sleep 1.5; head -3 /tmp/at-serve.log
```

Default port is 4317; use a scratch port (e.g. 4321) so you don't collide with a
dashboard the user already has open. **Kill it when done:** `kill <pid>`.

## 2. Hit endpoints (GET)

```bash
B="http://127.0.0.1:4321"
curl -s "$B/api/sessions" | head -c 200          # session list (JSON array)
curl -s "$B/api/roi"                              # proven-ROI aggregate
curl -s "$B/api/status"                           # { actionproof: bool }
curl -s "$B/api/groups"                           # groups + assignments + titles
curl -s "$B/api/recstate"                         # recommendation states
curl -s "$B/api/analysis?id=<prefix>&format=md"   # agent-readable brief
curl -s "$B/api/transcript?id=<prefix>" | head    # raw transcript
```

Available endpoints: `/api/sessions`, `/api/roi`, `/api/status`, `/api/groups`,
`/api/recstate`, `/api/analysis`, `/api/transcript`, `/api/sign`, `/api/launch`.

## 3. POST endpoints

```bash
# rename a session / assign a group (writes groups.json — back up first!)
curl -s -X POST -H "content-type: application/json" \
  -d '{"op":"rename-session","sessionId":"<id>","title":"New title"}' "$B/api/groups"
```

## 4. Verify the security guards (expect these exact codes)

```bash
# spoofed non-loopback Host → 403 (DNS-rebind guard)
curl -s -o /dev/null -w "%{http_code}\n" -H "Host: evil.com" "$B/api/sessions"      # 403
# cross-origin Origin → 403 (CSRF guard)
curl -s -o /dev/null -w "%{http_code}\n" -H "Origin: https://evil.com" "$B/api/sessions"  # 403
# oversized POST body → 413 (memory-DoS guard)
head -c 2097152 /dev/zero | tr '\0' 'x' | \
  curl -s -o /dev/null -w "%{http_code}\n" -X POST --data-binary @- "$B/api/groups"  # 413
```

## 5. Tear down + restore

```bash
kill <pid>
# diff live state vs backup; restore if changed
for f in groups.json receipts.json recstate.json; do
  diff -q ~/.agenttrace/$f /tmp/at-backup/$f >/dev/null 2>&1 || cp /tmp/at-backup/$f ~/.agenttrace/$f
done
rm -f /tmp/at-serve.log
```

## Notes

- The served HTML is the real browser JS; to sanity-check it parses, extract the
  inline `<script>` and `node --check` it.
- Never expose this beyond 127.0.0.1 — the server binds loopback only and rejects
  non-loopback peers.
