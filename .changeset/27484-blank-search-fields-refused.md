---
'@objectstack/metadata-protocol': patch
'@objectstack/rest': patch
---

fix(metadata-protocol)!: a `searchFields` override naming no field (`$searchFields=`, `$searchFields=,`, `[]`) is refused 400, not read as absent, so a narrowed search no longer runs over the default search fields (#27484)

Clause-②: no (narrowing) — the data doors (`GET /data/:object`, `POST /data/:object/query`, `GET /data/:object/export`, and every other caller of `findData`) refuse a `searchFields` value that names no field, which they answered 200 over the default search set before. Nothing is widened.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes: a query value that names no field is refused where it was read as absent. The fix for a caller is to send a field name or leave the parameter out, which the refusal says; there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing at the query door (`@objectstack/metadata-protocol`), served by every Data API door.

- **Before.** A blank or comma-only `$searchFields` (or `searchFields`), an empty array, or an empty object-form `search.fields` was read as no override, and the search scanned the object's whole default search set: `?$search=initech&$searchFields=` answered the rows `?$search=initech&$searchFields=industry` excludes, under a 200. The export route dropped a blank `searchFields` itself before the query ran.
- **Now.** `400 VALIDATION_ERROR`, naming the parameter the caller wrote (`Query parameter '$searchFields' names no field`), the envelope `$select` answers for a projection naming no field (#26644). No row is read. On the list and query doors this holds with or without a `search` term: `?$searchFields=` alone is refused too, as a non-empty override naming an unknown field already is.
- **Unchanged.** An absent `searchFields` searches the default set; a named one narrows it; a name outside the searchable set is still `400 INVALID_FIELD`. The engine (`find` / `count` called directly) still reads an empty override as absent. The export route still ignores `searchFields` sent without `search`.
- **Not yet narrowed.** The published declarations (`QueryTransportParamsSchema.$searchFields`, `EngineQueryOptionsSchema.searchFields`, `QuerySchema.searchFields`, `FullTextSearchSchema.fields`) still admit `''` and `[]`; the refusal is the door's. So on `POST /data/:object/query` the sibling `select: []` is the body schema's `400 VALIDATION_FAILED` while `searchFields: []` is this `400 VALIDATION_ERROR`. Narrowing the declarations is follow-up #27683.
- **Who sees it.** An API caller that sends `searchFields` with no field in it. The Console and the bundled view plugins send the parameter only when it holds at least one field.

**The remedy.** Leave the parameter out to search the default fields, or name the fields to search.
