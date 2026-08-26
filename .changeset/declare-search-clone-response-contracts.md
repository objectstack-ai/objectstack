---
'@objectstack/spec': minor
'@objectstack/client': minor
---

Declare the `search` and `data.clone` route response contracts, and bind the SDK to them (#11924)

Two of the four SDK routes #8140 had to leave as deliberate `Promise<any>` holes now have real
contracts. Their shapes were always stable and server-produced — they were declared inline on the
implementation (`@objectstack/metadata-protocol`'s `searchAll` / `cloneData`), reachable from no
spec export — and per the maintainer ruling on #11924 they are now declared in `@objectstack/spec`
exactly as produced, with conformance coverage on both the producer and the mounted route (#3877:
no route-ledger `responseSchema` row is filled without conformance coverage; both rows are filled
as part of this change).

**`@objectstack/spec` (additive):**

- `SearchAllResponseSchema` / `SearchAllHitSchema` (+ `SearchAllResponse` / `SearchAllHit` types,
  `@objectstack/spec/api`) — the WHOLE body of `GET /api/v1/search`, answered bare:
  `{ query, hits, totalObjects, totalHits, truncated }` with hits of
  `{ object, id, title, snippet?, record }`. ⚠️ Deliberately distinct from `SearchResult` /
  `SearchHit` in `@objectstack/spec/contracts`, which type the per-object `ISearchService.search`
  (hits of `score` / `document`) — reaching for that same-named neighbour was the near-miss trap
  #8140 left a compile-time guard against, and the guard stands unchanged.
- `CloneDataResponseSchema` (+ `CloneDataResponse`, `@objectstack/spec/api`) — the whole 201 body
  of `POST /data/:object/:id/clone`: `{ object, id, sourceId, record }`, `CreateDataResponse`'s
  structural sibling plus `sourceId` (`id` is the NEW record's, `sourceId` the copied record's).
  No `droppedFields` member — unlike `createData`, the clone producer emits none.

**`@objectstack/client` (return-type narrowing, same nature as the #8140 batch):** `search` is
now `Promise<SearchAllResponse>` and `data.clone` is `clone<T = any>(…): Promise<CloneDataResult<T>>`
(a new exported interface mirroring `CloneDataResponseSchema`, beside `CreateDataResult`). Nothing
changes at runtime — no request, response, unwrapping or error path is touched — but code that
compiled against the previous `any` returns (arbitrary property reads, assignments to unrelated
types) can stop compiling; in particular a result assigned to the per-object `SearchResult` is now
refused at compile time, which is the trap the erasure used to hide.

The `automation.create` / `automation.update` pair is explicitly NOT declared here — it returns to
the decision inbox with a consumer-survey reading per the same ruling.
