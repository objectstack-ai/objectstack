---
"@objectstack/spec": minor
"@objectstack/objectql": minor
"@objectstack/metadata-protocol": patch
---

A grouped or aggregated query now honours `search`: the groups and every aggregated number are computed over the searched rows, exactly the rows the same query without `groupBy` / `aggregations` returns.

Clause-②: yes (widening) — `EngineAggregateOptionsSchema` gains two OPTIONAL keys, `search` and `searchFields`, so the accept set of the aggregate options grows. Nothing previously admitted is refused, no key is renamed or retired, and no producer is required to write them.

`QuerySchema.search` (ADR-0061) is declared on the query beside `groupBy` and `aggregations`, with no carve-out. Until now, `POST /data/:object/query` accepted a body such as `{ groupBy: ["business_unit"], aggregations: [{ function: "count", alias: "count" }], search: "harbour" }` and answered it with the UNSEARCHED groups — no error and no warning — while the same body without `groupBy` / `aggregations` returned only the searched rows. A grouped list view under a toolbar search would therefore show group headers that ignore what the user typed.

- **`@objectstack/spec`** — `EngineAggregateOptionsSchema` declares `search` (the bare string, or the structured `FullTextSearchSchema` form) and `searchFields`, identically to `EngineQueryOptionsSchema`. A parse used to strip them.
- **`@objectstack/objectql`** — `engine.aggregate()` (and `ctx.api.object(name).aggregate()`) accepts the two keys it used to refuse as unknown options, and expands them through the same ADR-0061 expansion `find()` uses: the same server-resolved searchable fields, the same `searchFields` narrowing, AND-ed with `where` before the security middlewares run. There is one expander, not two. It applies on both aggregate paths, native `driver.aggregate()` and the in-memory lowering. A key the verb still does not execute, such as `$search`, is refused as before.
- **`@objectstack/metadata-protocol`** — `findData`'s grouped branch passes `search` / `searchFields` to `engine.aggregate()`. `searchFields` is validated on that branch exactly as on the flat one: a column search cannot scan is `400 INVALID_FIELD`.

Nothing to migrate. A caller that worked around the gap, for example by grouping a page of searched rows on the client, can send the grouped query with its `search` instead.
