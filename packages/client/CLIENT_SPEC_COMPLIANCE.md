# @objectstack/client — Spec Compliance Matrix (RETIRED)

> **Retired 2026-07-27 by the #3563 route audit.** This document's
> "✅ FULLY COMPLIANT" verdict (last verified 2026-02-09) was measured against
> `DEFAULT_DISPATCHER_ROUTES` in `@objectstack/spec` — a table nothing in the
> runtime consumes, which lists two domains that do not exist (`/workflow`
> as a dispatcher route, `/realtime`) and omits eight that do (`/keys`,
> `/mcp`, `/mcp/skill`, `/actions`, `/security`, `/share-links`, `/ready`,
> `/openapi.json`). Measured against the server's real route surface, the
> audit found 27 routes with no SDK expression on the day this file still
> claimed full compliance.
>
> Hand-maintained compliance tables drift; this one is not coming back.

Coverage is now asserted by code, in CI, from both sides:

- **Inventory:** `packages/runtime/src/route-ledger.ts` — the audited
  disposition of every dispatcher route.
- **Guard:** `packages/runtime/src/route-ledger.conformance.test.ts`
  (dispatcher domains ↔ ledger, gap ratchet) and
  `packages/client/src/route-ledger-coverage.test.ts` (every ledger-named
  client method must exist).
- **Findings & follow-ups:**
  `docs/audits/2026-07-dispatcher-client-route-coverage.md`.

This file is kept only so inbound links don't break.
