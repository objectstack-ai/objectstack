---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol)!: a `$searchFields` entry naming a `secret` / `password` field is refused 400 `INVALID_FIELD` at the data door, even when the object's `searchableFields` declares it, instead of searching the rest of the declared set (#27829)

Clause-②: no (narrowing) — the data doors (`GET /data/:object`, `POST /data/:object/query`, and every other caller of `findData`) refuse a search-field override naming a credential field, which they answered 200 over the rest of the declared search set before. Nothing is widened.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes: a query value naming a credential field is refused where the engine silently dropped it. The fix for a caller is to search another field, which the refusal says; there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing at the query door (`@objectstack/metadata-protocol`), served by every Data API door.

- **Before.** On an object whose `searchableFields` declares a `secret` or `password` field, `?$search=TERM&$searchFields=api_key` passed the door, the engine withheld the credential column from the scan (ADR-0100), and its tolerant intersection then searched the rest of the declared set: 200 with rows matched in `name`. `$searchFields=name,api_key` silently dropped `api_key`. The credential itself was never searched.
- **Now.** `400 INVALID_FIELD` naming the field (`Field 'api_key' on object 'OBJ' is type 'secret', a credential, and cannot be searched`), before any row is read — the same answer the auto-default path already gave a credential name. It covers the standalone `searchFields` / `$searchFields` slot and the object-form `search.fields`. Judged by `isCredentialFieldType` (`@objectstack/spec/data`), the predicate the engine's withhold reads.
- **Unchanged.** A request that names no credential field is served as before; with no `$searchFields`, the declared set is searched and the declared credential entry is never scanned. The engine's withhold stays as the floor for direct engine callers.
- **Who sees it.** An API caller naming a credential field in `$searchFields`, typically a client echoing the object's `searchableFields` verbatim on an object that declares one (the linter has flagged that declaration since `validate-searchable-fields` learned the credential check).

**The remedy.** Remove the credential field from the object's `searchableFields` and from the request; search another column.
