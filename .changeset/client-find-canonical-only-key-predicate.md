---
"@objectstack/client": patch
---

fix(client): `data.find({ limit })` reached the server as an empty query, and `QueryOptionsV2.expand` reached it as nothing at all (#6322)

`data.find()` accepts two vocabularies — the canonical `QueryOptionsV2`
(`where` / `fields` / `orderBy` / `limit` / `offset` / `expand`) and the legacy
`QueryOptions` (`filter` / `select` / `sort` / `top` / `skip`) — and picked the
branch with a hand-written condition that named four keys:
`'where' in options || 'fields' in options || 'orderBy' in options || 'offset' in options`.
That condition was a second, independent statement of what `QueryOptionsV2`
declares, and it had fallen behind the interface twice.

**`limit` was missing from it.** `client.data.find('task', { limit: 20 })` — a
canonical key as the only key, and the most natural spelling of "first 20" —
was not recognised as canonical, fell to the legacy branch, and that branch
reads only `top` / `skip` / `sort` / `select` / `filter` / `filters` /
`aggregations` / `groupBy`. Nothing there reads `limit`, so the value was
dropped between the call and the wire: the request went out with an **empty
query string**, the caller got the server's default page size, HTTP 200, no
warning. Its pagination twin `{ offset: 5 }` worked correctly, because `offset`
happened to be one of the four listed keys — one interface, two pagination
keys, opposite behaviour.

**`expand` was missing too, and had no mapping either.** It is declared on
`QueryOptionsV2`, documented as the replacement for a legacy `populate` that
`QueryOptions` never had, and was carried by neither branch — not one character
of it reached the wire, on either of the two `find` implementations.

**What changed.** The branch predicate is now derived from the interface rather
than restated beside it: the canonical-only key set is
`Exclude<keyof QueryOptionsV2, keyof QueryOptions>`, held as a
`Record<…, true>` that TypeScript rejects when a key is missing or extra. A key
added to `QueryOptionsV2` from now on is a compile error until it is listed, so
the next canonical key is covered on the day it is declared. Appending `limit`
to the old list would have been the third round of the same mistake.

`expand` now maps onto the spelling the server actually accepts:
`?expand=<comma-separated relation names>`, which
`HttpFindQueryParamsSchema` declares for the GET list route and the protocol
normalizer splits on commas before folding each name into the engine's expand
map. The `Record` form contributes its keys — the same relation names the
server derives from the comma list. A **nested** per-relation query inside
`expand` has no spelling on a GET, so it is now refused with an error naming
the relation and the keys it could not carry, rather than trimmed away
silently; `data.query()` carries a QueryAST body and is where nested expand
detail belongs.

Both `find` implementations — `ObjectStackClient.data.find` and
`ScopedProjectClient.data.find`, which were byte-identical copies of the same
defect — read the one shared predicate and the one shared `expand` mapping.

No change to the five paired keys: canonical and legacy spellings of the same
query still produce byte-identical transport parameters, and that parity is now
pinned by a test table both implementations are driven through.
