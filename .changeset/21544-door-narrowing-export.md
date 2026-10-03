---
'@objectstack/metadata-protocol': minor
'@objectstack/runtime': patch
---

fix(metadata-protocol)!: the generic data door refuses a stored-metadata filter that reads the body or a content hash through a cross-field comparand or below its depth backstop, and exports its one filter-field collector and one search narrowing for the reader-context seam (#21544)

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) no metadata body, authorable key, spelling, export or stored shape moves; what changes is which read-query shapes the generic data door accepts over the two stored-metadata tables, and two module functions are added to the package surface, so `objectstack migrate meta` has nothing to rewrite. The other categories are closed on facts: both packages publish (not `unpublished`); no ADR-0087 id covers a refused query shape (not `registered` / `already-registered`); and the change is runtime behaviour plus additive exports, not a declaration (not `runtime-interface-only` / `type-surface-only`). -->

**BREAKING**: this narrows what the generic data door (`GET /api/v1/data/:object`, `POST /api/v1/data/:object/query` and the in-process `findData`) accepts when it reads `sys_metadata` or `sys_metadata_history`. Two filter shapes read the stored body column or a content-hash column (`checksum`, `previous_checksum`, or the history table's `change_note`) without the family's refusal ever seeing them, and both ran before this release:

- a cross-field comparand naming one of those columns — `{ "name": { "$ne": { "$field": "metadata" } } }`, in `where` or in an aggregation's `filter`, under `$not` included. The SQL drivers evaluate it row by row, so row presence disclosed the column's value;
- a filter on one of those columns nested more than 32 combinators deep, which the door's field collector stopped reading at. A body `$contains` of a stored credential answered the row and a wrong guess answered none.

Both now answer the door's `400 INVALID_FIELD`, naming the column, before the query runs — the answer the same filter already gets when it names the column directly. The route: filter those tables by their scalar columns (the type, the name, the state and the like), compare scalar columns with each other, and read the bodies with a plain list, which is served projected. Every other column of the two tables, and every other object, is unchanged; a dotted key into one of those columns was, and stays, refused by the door's dotted-path rule. It ships as `minor` under the launch-window convention for accept-set narrowings.

- **`@objectstack/metadata-protocol`** exports two module functions the generic data door now calls itself:
  - `collectStoredMetadataFilterFields(object, query)` — the family's one filter-field collector: every column a read query's filters read (`where`, the engine's `filter` alias and each aggregation filter): each key's head and each cross-field `{ $field }` comparand, at any depth. `[]` outside the family.
  - `narrowStoredMetadataSearch(object, query, schema, wireSpelling?)` — the family's one default-search narrowing: an explicit search-field list naming the body or a hash column is refused, a default search is narrowed to the searchable set without them (returned for the caller to run as `searchFields`), and a set that narrows to nothing is refused. The `StoredMetadataSearchSchema` type it reads is exported beside it.
- **`@objectstack/runtime`**: the stored-metadata reader-context seam (`ctx.api.object(...)` for action and hook bodies, a handler's `ctx.api`, and `ctx.engine.find`) calls those two functions instead of its own copy of the narrowing and `@objectstack/plugin-security`'s condition walk, so the seam and the door answer every family filter and search identically. A `count` through the seam now runs the query the guard returns. The seam's accept set is unchanged: every shape it refused before it still refuses, now through the door's collector.
