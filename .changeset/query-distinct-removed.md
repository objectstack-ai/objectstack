---
"@objectstack/spec": major
"@objectstack/client": major
"@objectstack/metadata-protocol": minor
---

refactor(data)!: `query.distinct` is removed, and with it the mis-wired REST count suppression (#4286 step 4)

`distinct` promised `SELECT DISTINCT` and no driver ever rendered it — but it
was **mis-wired rather than merely dead** (#4286 finding 2, the harsher
ADR-0078 class): its only observable effect platform-wide was that the REST
list path treated a distinct query as *not countable*, silently degrading
`total`/`hasMore` to a page-local estimate while still returning duplicate
rows. A caller — or a self-verifying agent — saw the response change and
concluded the flag worked. It had a shipped public producer
(`QueryBuilder.distinct()`).

**FROM → TO**

| Was | Now |
| :--- | :--- |
| `distinct: true` for unique combinations | `groupBy: ['category']` |
| `distinct: true` + count | `aggregations: [{ function: 'count_distinct', field: 'category', alias: '...' }]` |
| one column's distinct values | the SQL/memory drivers' `distinct(object, field)` door (driver-level) |

The one-line fix: **delete the key**; deduplicate with `groupBy` /
`count_distinct`.

Mechanics: `retiredKey()` tombstones on both declaration sites
(`QuerySchema.distinct` and `EngineQueryOptionsSchema.distinct`, one shared
prescription); `QueryBuilder.distinct()` is deleted; registered as the
protocol-18 semantic migration `query-distinct-retired`. **Observable REST
change (`@objectstack/metadata-protocol`):** the count-suppression branch is
deleted — a list request that used to carry `distinct` now gets a real
`total`/`hasMore` again (that restoration is the point, not a side effect).
The per-aggregation `distinct` flag (`AggregationNode.distinct`) is a
different, live member and is untouched.
