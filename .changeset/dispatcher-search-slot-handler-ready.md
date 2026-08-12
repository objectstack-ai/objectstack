---
"@objectstack/runtime": patch
---

fix(runtime): discovery no longer claims a bound handler for the `search` slot (#7939)

`getDiscoveryInfo()`'s `services.search` entry reported `handlerReady: true` for
any registered search-service occupant that carries no `__serviceInfo`
self-description — even though the dispatcher has no `/search` route or handler
at all (no `route-ledger.ts` entry, no branch in `http-dispatcher.ts`). That
contradicted the map's own stated contract: `handlerReady: true` means "the
dispatcher has a real, bound handler for this route."

This is the same contradiction #4318 closed for `cache`/`queue`/`job`, applied
to the one slot of that shape it did not reach. `search` now uses the same
`svcInProcess()` remedy, reporting `handlerReady: false` for a filled slot —
with its own message rather than the shared "Kernel-internal service" wording,
since a registered search service is an external engine (Elasticsearch/
Meilisearch), not a kernel-managed in-process contract.

`capabilities.search` (the host's `/search` HTTP surface, fixed separately in
#7602 / PR #7937) is untouched — this only corrects `services.search`, which
describes what is *registered*, not what is served.

Latent until now: nothing registers an `ISearchService` in either repository
(`CORE_SERVICE_PROVIDER['search']` is `null`), so the wrong branch was never
reachable in practice. Covered by two new fixture-filled tests that register a
search occupant before asserting `handlerReady`, since an empty-slot test would
pass regardless of what the line says.
