---
"@objectstack/metadata-protocol": patch
"@objectstack/rest": patch
"@objectstack/spec": patch
---

fix(metadata-protocol,rest,spec): derive `capabilities.search` from what serves `/search`, not from an empty service slot (#7541)

Every REST host advertised `capabilities.search = { enabled: false }` in
`/discovery` while `GET /api/v1/search?q=…` answered `200` with real hits. This
is Prime Directive #10 inverted: not an advertised endpoint that 404s, but a
live endpoint **no conforming client will ever call**, because the document
whose only job is to say what is available said it was not.

**Two producers, two unrelated predicates.** The capability bit came from a
registered `search` service slot (`registeredServices.has('search')`), while the
route refused on something else entirely — `registerSearchEndpoints` returns
`501 NOT_IMPLEMENTED` exactly when `typeof protocol.searchAll !== 'function'`.
Nothing in either repository registers that slot (`CORE_SERVICE_PROVIDER`
records this, verified), and the protocol implements `searchAll`
unconditionally, so the two answers were not merely capable of disagreeing —
they disagreed on every host that exists.

`search` was the last well-known capability still on bare slot presence. Its
neighbours were moved onto serveability with the rule stated in the builder —
*"the predicate is deliberately the SAME one that decides whether the route is
advertised — what we advertise and what we claim cannot disagree"* — most
recently `chunkedUpload` in #5672. This brings `search` onto that footing: **one
predicate, both ends.**

- `@objectstack/metadata-protocol` — `capabilities.search` is now
  `typeof this.searchAll === 'function'`, the route's own refusal predicate.
- `@objectstack/rest` — the `/discovery` producer ANDs that with
  `api.enableSearch`, the flag that decides whether this server mounts the route
  at all. Exactly the two-layer conjunction `transactionalBatch` already uses
  with `api.enableBatch`: the protocol states what it can serve, the server
  states what it mounted, and a deployment that opts out reports `false` rather
  than promising a 404. Nothing was added to the route itself.

**`services.search` is unchanged, and deliberately so.** The slot answers a
different question — `CoreServiceName` declares it "Search Engine
(Elastic/Meili)" and `ISearchService` is an index/query contract — so it still
reports *which engine occupies the slot*, while the capability reports *whether
the surface is served*. On an ordinary host those now differ
(`capabilities.search.enabled: true` beside `services.search.status:
'unavailable'`), and both statements are true. So that the two halves of one
document do not read as contradicting each other, `@objectstack/spec` gives the
slot a `REMEDY_DETAIL` sentence — the same treatment `ui` carries for the same
shape (#4146) — which keeps the unchanged "no implementation ships" fact and
adds which question the entry answers. The `status` itself stays
`unavailable`: no engine is registered, and saying otherwise would be the
original defect pointed the other way.

**Client impact.** A client that gated its search UI on
`capabilities.search.enabled` was hiding a working feature on every deployment;
it now sees `true` wherever the endpoint really serves, and `false` when the
protocol cannot search (route `501`) or the server did not mount it (`404`).
