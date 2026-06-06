---
'@objectstack/runtime': patch
---

fix(runtime): mount /mcp and /keys HTTP routes (ADR-0036) — were unreachable

The dispatcher mounts routes EXPLICITLY on the HTTP server (no catch-all). The
MCP transport (#1626) and key-generation (#1630) added branches inside
`dispatch()` but never registered the corresponding `server.<verb>()` routes, so
`/api/v1/mcp` and `/api/v1/keys` 404'd at the HTTP layer before ever reaching
the dispatcher. Unit tests called the handlers directly, hiding the gap; it only
showed up in live staging e2e.

- Register `/mcp` (GET/POST/DELETE → dispatch, transport reads the method) and
  `/keys` (POST) in the dispatcher plugin, routed through `dispatch()` so the
  host's project-aware kernel swap + executionContext resolution run first.
- Add `dispatcher-plugin.routes.test.ts` asserting the routes are registered
  (the regression that would have caught this).
