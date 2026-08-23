---
"@objectstack/driver-sql": patch
---

**Bug fix:** `introspectColumns` (and therefore `introspectSchema`) now reports a table's columns in declared order on every dialect, read from the catalog's own ordinal (#11163).

The column array was built from knex's `columnInfo()`, an object keyed by column name whose key-insertion order is the row order of a catalog query with no `ORDER BY`. Measured live: SQLite and PostgreSQL 16.13 happened to return declared order, MySQL 8.0.46 returned **alphabetical** order — so the same table introspected through different dialects returned different `columns` arrays, and a federated object drafted from a MySQL remote (ADR-0015) got its fields alphabetized rather than in the order the remote declares them.

The order now comes from the catalog ordinal on all three dialects — `information_schema.COLUMNS.ORDINAL_POSITION` (MySQL), `information_schema.columns.ordinal_position` (Postgres), `PRAGMA table_info`'s `cid` (SQLite) — while `columnInfo()` remains the source of the per-column facts (`type`, `nullable`, `defaultValue`, `maxLength`), which knex already normalises per dialect.
