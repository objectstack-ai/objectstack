---
'@objectstack/rest': patch
'@objectstack/core': patch
---

fix(rest, core)!: an update or upsert import whose match key names a multi-value or structured field is refused with `400 INVALID_REQUEST` naming the field, instead of failing every row on a raw SQL-binding error (#27465)

Clause-②: no (narrowing) — an update / upsert import request whose `matchFields`, or whose named mapping's `upsertKey`, names a field stored as a JSON column was accepted and then failed every row; it is now refused at the door before any row. Nothing is widened.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export is removed or retyped: a request the import door accepted and could never serve is now refused up front, with a refusal that names the field and the remedy. A request that worked before works the same, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing at the import door (`POST /data/:object/import`, `POST /data/:object/import/jobs`), and the same rule in the shared import runner (`runImport`, `@objectstack/core`).

- **Before.** In update or upsert mode, a `matchFields` entry naming a `multiple: true` lookup was accepted. Each row's lookup cell coerced to an id array, the matcher queried `{ field: [ids] }` as an implicit equality, and the SQL driver refused to bind it, so every row of the dry run and of the import failed with `Operator "=" … received an array`.
- **Now.** The door refuses the request with `400 INVALID_REQUEST`, before any row is read, matched or written, on the dry run and the import alike. The message names each offending field and its kind (`"work_object" (lookup, multiple: true)`) and says to match on single-value fields. A named mapping's `upsertKey` used as the key is judged the same way, and the message names the mapping.
- **Which fields.** Every field stored as a JSON column, as the spec defines it: a multi-capable type flagged `multiple: true` (`lookup`, `user`, `select`, `radio`, `file`, `image`), an inherently multi option type (`multiselect`, `checkboxes`, `tags`), and a structured JSON type (`json`, `composite`, `repeater`, `record`, `location`, `address`, `vector`). A single-value lookup or file field, and any scalar field, stays a legal key.
- **The runner.** A caller that reaches `runImport` without the door (the connector pull, which writes a mapping's `upsertKey` straight through) gets every row failed with `VALIDATION_ERROR` and the same message, naming the field, before any row is coerced, read or written. `multiValueMatchKeyRefusal(matchFields, metaMap)` is the one rule both use, exported from `@objectstack/core`.
- **Unchanged.** An insert import matches nothing, so a `matchFields` it carries is not judged. Writing a multi-value field as an ordinary column of an update or upsert keyed on scalar fields works as before.

**The remedy.** Match on single-value fields (a code, a name, an email). Measured through the SQL driver, a key naming any of these kinds already failed every row (the array kinds on the engine's implicit-equality refusal, a `json` field on a filter-token refusal), so an import that worked there before works the same now.
