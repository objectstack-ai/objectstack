---
'@objectstack/objectql': patch
'@objectstack/metadata-protocol': patch
'@objectstack/spec': patch
---

fix(objectql,metadata-protocol)!: an in-process search-field override that names no searchable field is refused, never widened to a default set (#28120)

Clause-②: no (narrowing) — two in-process tolerances the Data API doors already refuse are closed. The stored-metadata reader seam (`narrowStoredMetadataSearch`) no longer narrows an override that names no field (an empty list, a comma string with no name, a list with no string entry): it passes it to the engine, which refuses it. And the engine (`find`, `findOne`, `count`, `aggregate`) refuses a `searchFields` or object-form `search.fields` that names none of the fields the search scans, where `resolveSearchFields` used to drop the names and scan the whole default set. No export, answer member, status or error code is added: the refusals are the doors' `VALIDATION_ERROR` / 400 and `INVALID_FIELD` / 400. Folds #28121.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes: an engine option value the doors already refuse is now refused in process too, with the doors' codes. There is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing at the in-process search override (`@objectstack/objectql`, `@objectstack/metadata-protocol`).

- **Before.** A host handler, hook or flow reading `sys_metadata` / `sys_metadata_history` through the reader seam with `searchFields: []` was served: the seam read the empty list as "names none" and wrote the narrowed default set over it. On any object, a search whose override named no searchable field (every name unknown, unsearchable or withheld) was resolved to the object's default search set.
- **Now.** The empty override reaches the engine's refusal through the seam: `400 VALIDATION_ERROR`, before any driver read. An override naming no searchable field is refused `400 INVALID_FIELD` (`param: 'searchFields'` or `'search.fields'`, `field` / `fields` naming what the caller wrote) before any driver read, the code the REST door answers for the same value. `mapDataError` serves both with the door's status and code.
- **Unchanged.** An absent (or `null`) override searches the default set. An override naming no searchable field sent without a `search` is still not judged in process, since nothing is scanned (the door refuses it with or without a search term). A named override narrows as before. An override naming SOME searchable field still has its other names dropped in process (the doors refuse them). An object with no searchable field at all keeps its own refusal (#24284).

**The remedy.** Name at least one field the object searches (its `searchableFields`, or the default set), or leave the key out to search the default fields.
