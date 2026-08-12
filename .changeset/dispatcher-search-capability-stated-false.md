---
"@objectstack/runtime": patch
---

fix(runtime): the dispatcher's `capabilities.search` answers a stated `false` instead of bare slot presence (#7602)

`getDiscoveryInfo()` — the runtime dispatcher's discovery face — derived
`capabilities.search.enabled` from `!!searchSvc`, i.e. whether the `search`
service slot happened to be filled. That answer is `false` on every host that
exists today, but only by coincidence: nothing in the platform registers the
slot (`CORE_SERVICE_PROVIDER` records `'search': null`).

The dispatcher mounts **no `/search` route** — no `route-ledger.ts` entry, no
handler, no `routes.search` — so slot presence was never the right predicate
for it. Register any `ISearchService`, which is exactly what the slot exists
for (`CoreServiceName`: "Search Engine (Elastic/Meili)"), and the discovery
document flipped `search.enabled` to `true` while the host still 404s the
endpoint — an advertised endpoint that cannot be called, the same
`declared ≠ enforced` defect #7541 closed on the `getDiscovery()` producer.

`capabilities.search` is now a hardcoded `false` carrying its reasoning inline,
the way `websockets` immediately below it already is (ADR-0076 D12, #2462).
The dispatcher's own doctrine at that site says a service whose HTTP surface is
a *dispatcher domain* mirrors that domain's guard — "same predicate ⇒ same
answer" (#4000 / #4058) — and `search` is not a dispatcher domain, so it has no
guard to mirror. Should a `/search` domain ever be mounted, the guard applies
and the key is re-derived from it.

No wire change on any existing host: the emitted value is `false` before and
after. What changes is that it stays `false` when the slot is filled. The
`services.search` entry is unaffected — it reports what is *registered*, not
what is served, and already advertised no route.
