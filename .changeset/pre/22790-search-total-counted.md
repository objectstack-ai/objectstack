---
"@objectstack/spec": minor
"@objectstack/objectql": minor
"@objectstack/metadata-protocol": patch
---

A paged list under a search now reports the real number of matching records as `total`, and `hasMore` agrees with it on every page.

Clause-②: yes (widening) — `EngineCountOptionsSchema` gains two OPTIONAL keys, `search` and `searchFields`, so the accept set of the count options grows. Nothing previously admitted is refused, no key is renamed or retired, and no producer is required to write them.

Until now `GET /api/v1/data/:object?$top=25&$search=Line` over 75 matching records answered `total: 26` (offset + page + 1, a page-local estimate), and the last page claimed `hasMore: true`; `POST /api/v1/data/:object/query` with a `search` did the same. Nothing on the response marked the number as an estimate, so the Console rendered it as the record count and offered the wrong number of pages.

- **`@objectstack/spec`** — `EngineCountOptionsSchema` declares `search` (the bare string, or the structured `FullTextSearchSchema` form) and `searchFields`, identically to `EngineQueryOptionsSchema`. FROM `count(object, { where })` only → TO `count(object, { where, search, searchFields })`. The structured `search` form carries flag defaults, so the parsed state is named `EngineCountOptionsParsed` (ADR-0122). `HookCountQuery` (`ctx.api.object(name).count()`) derives from it and gains the same two keys.
- **`@objectstack/objectql`** — `engine.count()` (and `ctx.api.object(name).count()`) accepts the two keys it used to refuse as unknown options, and expands them through the same ADR-0061 expansion `find()` and `aggregate()` use: the same server-resolved searchable fields, the same `internal: true` exclusion, the same `searchFields` narrowing, AND-ed with `where` before the security middlewares run. There is one expander, not two, so a count under a search is the number of rows `find()` returns for the same bag.
- **`@objectstack/metadata-protocol`** — `findData`'s paged branch passes `search` / `searchFields` to `engine.count()`, and the page-local estimate branch is gone. `$count=false` still skips the count and omits `total`.

Nothing to migrate. A client that worked around the estimate, for example by labelling the count as page-local under a search, can read `total` as the match count again.
