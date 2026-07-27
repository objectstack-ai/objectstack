---
"@objectstack/runtime": minor
---

feat(runtime): extract the /share-links dispatcher domain body — ADR-0076 D11 step ③, PR-4 (#2462)

The share-link capability-token surface (ADR-0047) moves out of
`HttpDispatcher` into `domains/share-links.ts`. This is cloud's designed
primary surface for per-env kernels (`registerShareLinkRoutes: false`, host
dispatcher serves after kernel swap — the #2462 step-① re-scope finding), so
the handler keeps working from the registry exactly as from the if-chain.
`DomainHandlerDeps` grows `getRequestKernelService` (reads off the
per-request RESOLVED kernel — the engine the shareLinks service is bound to)
and `routeNotFound` (the shared 404 envelope). Zero behavior change — locked
by http-conformance (41) and 5 new seam tests incl. token-resolve redaction.
