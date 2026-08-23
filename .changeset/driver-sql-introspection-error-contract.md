---
"@objectstack/driver-sql": minor
---

**BREAKING**: a failed primary-key / foreign-key / unique-constraint introspection read now throws instead of silently reporting absence (#11161).

`introspectPrimaryKeys`, `introspectForeignKeys` and `introspectUniqueConstraints` wrapped their whole dialect dispatch in a bare `catch {}` and returned `[]`, so a query a live server rejected degraded to "this table has no primary key / foreign keys / unique constraints" with no diagnostic. `primaryKeys` is consumed as an addressing / upsert-conflict-target key (federated-object codegen, the persisted `external_catalog` under ADR-0015, schema-drift comparison), so the silent empty answer was a wrong answer downstream code acted on, not "we don't know".

This extends the #7332 ruling the sibling `introspectIndexes` already carries, with the identical option shape and default: `onFailure?: 'throw' | 'partial'`, defaulting to `'throw'`. A caller whose short read is self-correcting may ask for one by name with `{ onFailure: 'partial' }`. Consequently `introspectSchema` over a partially-readable database now fails loudly instead of emitting tables whose keys silently read as absent; its in-tree callers already handle a throw (the datasource health check reports `{ ok: false }`, the REST/CLI introspection seams surface the error).

The un-hiding immediately proved its worth: the Postgres arm of `introspectUniqueConstraints` had been invalid SQL all along (`SELECT c.column_name` with no alias `c` in scope — `missing FROM-clause entry`), so live Postgres never reported a unique constraint through this method. That query is repaired in the same change (alias fixed, and the lookup scoped to `current_schemas(false)` the way `introspectSchema`'s own table listing already is), so `isUnique` is now populated on Postgres for the first time.

<!-- adr-0087: not-required (no-migration-prescription) runtime error-contract change on SqlDriver's protected introspection methods; no authorable metadata key changes shape, so `objectstack migrate meta` has nothing to rewrite -->
