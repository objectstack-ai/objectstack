---
'@objectstack/rest': patch
---

fix(rest)!: an inline import mapping entry's `transform`, `defaultValue` and `required` are applied, not dropped

`POST /api/v1/data/:object/import` (and the async import job, which parses the same body) accepts `mapping` as a `FieldMappingEntry[]`, whose entries carry `transform`, `defaultValue` and `required`. The request parser kept only the column each entry names with `sourceField` and the field it names with `targetField` and dropped the rest, so a request asking for `transform: 'uppercase'` validated, ran, and stored the cell unchanged. Each entry's rules now run on its column before the cells are coerced:

- `trim`, `uppercase` and `lowercase` rewrite a string cell. `none` and `lookup` copy it; a `lookup` cell is resolved to a record id by the import's reference resolution, as before.
- `defaultValue` fills a cell that is blank (absent, empty, whitespace or one of the request's `nullValues`).
- `required: true` refuses the request with `400 MISSING_REQUIRED_FIELD` when a row still leaves that column blank, naming the column and the rows. The refusal comes before any row is written, on the dry run and the commit alike.
- `transform: 'date_format'` refuses the request with `400 UNSUPPORTED_TRANSFORM`: an entry carries no date format for it to apply. A cell mapped to a date or datetime field is already parsed as a date, so drop the transform. A transform name outside the declared set is refused the same way.

A plain `{ sourceField, targetField }` entry, and the compact `{ column: field }` record, map columns exactly as before.

Clause-②: no (narrowing) — the import doors refuse two request shapes they used to run: an inline mapping entry declaring `transform: 'date_format'` (or a transform name outside the declared set), and an entry marked `required: true` whose column a row leaves blank. Nothing is widened.

Metadata-protocol: none (a REST import request's handling; nothing a metadata author writes changes)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object definition, stored row or stored shape is added, removed, renamed or re-shaped, and no exported declaration is removed or narrowed, so there is nothing for `objectstack migrate meta` to rewrite. What changes is how the REST import doors handle a request body's inline mapping entries: their declared per-cell rules now run, and two shapes those rules make unanswerable are refused. The remedy is a request edit (drop `date_format`, fill the required cells or give the entry a `defaultValue`), never a rewrite of a package source or a stored row. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** for a caller that relied on either request running.

- **Before.** An inline entry's `transform`, `defaultValue` and `required` were ignored; the import ran with the rename alone.
- **Now.** They are applied; `date_format` and a blank `required` cell refuse the request with `400`.
- **Fix.** Drop `transform: 'date_format'` from the entry (the date field's own parse still applies), and fill a required column or give its entry a `defaultValue`.
