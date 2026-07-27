---
"@objectstack/runtime": minor
---

feat(runtime): extract /keys, /storage and /ui dispatcher domain bodies — ADR-0076 D11 step ③, PR-3 (#2462)

Continues the per-domain decomposition: three more handler bodies move out
of `HttpDispatcher` into `domains/keys.ts` (incl. the zero-tolerance
API-key-mint security contract), `domains/storage.ts` and `domains/ui.ts`,
running on the explicit `DomainHandlerDeps` contract (extended with
`getObjectQL` for the data-plane domains). The `/keys` legacy branch's
`'/keys?'` query-string form is reproduced with a second registry entry;
storage drops its strictly-redundant `kernel.services` index-access fallback
(dead under Map-shaped services, duplicate under object-shaped ones). Thin
`handleXxx` delegates remain for direct callers. Zero behavior change —
locked by the 41-assertion http-conformance suite and 6 new seam tests.
