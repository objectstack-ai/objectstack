---
"@objectstack/driver-sql": patch
---

**Bug fix:** on Postgres, index and schema introspection now resolve tables the way the session does, instead of assuming the `public` schema (#9350).

`introspectIndexes` pinned `n.nspname = 'public'` and `introspectSchema` pinned `table_schema = 'public'`. For a driver whose connection carries a `searchPath` pointing anywhere else, both returned **empty** — not an error, an empty result. Measured on a live Postgres 16: for a table carrying a primary key *and* a declared unique index, `introspectIndexes` returned `[]` and `introspectSchema` listed no tables at all.

Empty does not read as "I could not see" downstream; it reads as "there are no indexes". `assertConflictTargetHonoured` turns that into a refusal, so an `upsert` against a perfectly well-indexed table would be rejected with *no PRIMARY KEY or UNIQUE index backs them* — and index-drift detection would propose creating indexes that already exist.

- `introspectIndexes` now resolves the table with `to_regclass(?)` and reads `pg_index` by OID. That is the same resolution every other statement in the session performs — first match along `search_path` — and it removes an ambiguity a schema list would introduce, since two schemas on the path can hold the same table name and only one of them is the one a query reaches.
- `introspectSchema` now lists `table_schema = ANY (current_schemas(false))`.

**No change for a default deployment.** With the default `search_path`, `current_schemas(false)` is exactly `{public}` and `to_regclass` resolves into `public`, so both queries return what they returned before. The behaviour only differs where the old queries returned nothing.
