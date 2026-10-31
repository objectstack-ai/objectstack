---
'@objectstack/objectql': patch
---

fix(objectql)!: the in-process engine refuses a search-field override that names no field, as the Data API doors and the shared declarations do (#27732)

Clause-②: no (narrowing) — the in-process engine (`find`, `findOne`, `count`, `aggregate`) refuses a `searchFields` or object-form `search.fields` that names no field (an empty list, or a comma string with no name in it), which it read as absent before. The doors already refuse it (#27484) and `QuerySchema.searchFields` / `FullTextSearchSchema.fields` declare the refusal (#27683). Nothing is widened.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes: an engine option value the shared declarations already refuse is now refused in process too. The refusal is the doors' VALIDATION_ERROR / 400, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing at the engine's search override (`@objectstack/objectql`).

- **Before.** `engine.find(obj, { search: 'acme', searchFields: [] })`, the same on `findOne` / `count` / `aggregate`, and `search: { query: 'acme', fields: [] }` scanned the object's whole default search set: an empty override read as no override. The caller wrote the key to narrow and was not told.
- **Now.** Each is refused `400 VALIDATION_ERROR` (`param: 'searchFields'` or `'search.fields'`) before any driver read, whether or not a search term rides along, and for a system-context caller too. The message carries the declaration's own words ("Name at least one field, or leave the key out to search the default search fields"), and `mapDataError` serves it the status and code the REST door serves.
- **Unchanged.** An absent (or `null`) override searches the default set. A named override narrows as before, and a name outside the searchable set is still intersected away in process (refused at the doors).

**The remedy.** Leave the key out to search the default fields, or name at least one field.
