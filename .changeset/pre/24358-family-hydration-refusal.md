---
'@objectstack/objectql': minor
---

fix(objectql)!: `expand` and the master-detail `parent` root never hydrate a stored-metadata-body table

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No stored metadata moves and nothing is converted: what narrows is a served value (the expansion of a reference into a stored-metadata-body table) and a verdict (a field rule reading `parent` on a detail whose master is such a table); no spec key, export, option, object definition or stored shape is added, removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); nothing exported is removed (not runtime-export-retired) and no type changes (not type-surface-only or runtime-interface-only). -->

**BREAKING** (a served-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

The tables of the stored-metadata-body family (`STORED_METADATA_BODY_OBJECTS`) are projected or refused at every door that serves them, but only for the object a request names. Two relationship hydrations in the engine read a family row as an ordinary row, which that projection does not reach.

- **`expand`.** A reference field whose target is a family table is not expanded, at any depth and for any caller: the field keeps its stored id, the answer a reference the caller may not expand already gets. This covers `expand` / `$expand` on the data read, `findOne`, the nested query form and a hook body's `ctx.api` read. Expanding a reference into any other object is unchanged.
- **The master-detail `parent` root.** A detail whose master is a family table never reads its header. `parent` is unbound, so a `requiredWhen` or `readonlyWhen` that reads it fails closed exactly as it does for a header the caller cannot read, on insert, update and the `validate()` preview, and the verdict never depends on the row. A master outside the family is unchanged.

What to do. Read stored metadata through the metadata API (`GET /api/v1/meta/:type/:name`), where its body is projected, rather than by expanding a reference to it or reading it as a master-detail header. The stored id on the reference field is unchanged.
