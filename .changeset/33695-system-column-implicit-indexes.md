---
'@objectstack/driver-sql': patch
'@objectstack/driver-turso': patch
---

feat(driver-sql, driver-turso): schema sync builds the `(created_at, id)` and `(owner_id)` indexes without a declaration

Clause-②: no
Metadata-protocol: none

Schema sync now builds two indexes on system columns that no object has to declare:

- `(created_at, id)`, named `idx_<table>_created_at_id`, on every table that has both columns. This is the default list order, `created_at desc, id desc`. Without the index, every default-ordered page sorted all of its filtered rows. On PostgreSQL 16 with 1M rows, the admin list statement takes 1.3 ms instead of 317 ms.
- `(owner_id)`, named `idx_<table>_owner_id`, on an object whose fields include a single-valued `owner_id`. This is the column a private-OWD read filters on. An object with no `owner_id` gets no such index.

Both indexes are non-unique. They follow the #31882 rule for reference columns. If a declared index's key already starts with the same columns, it serves instead, and no second index is built. If an author declares the same key, it gets the same name, so the two converge. On an existing database, `os migrate plan` lists each missing index as a `safe` `create_index`. The next sync builds it, and on PostgreSQL it is built `CONCURRENTLY`. A second sync makes no changes. An existing table that has no `created_at` column gets no default-order index and no error line.

Turso's remote face (`libsql://`) now builds the full implicit set too: these two keys and the #31882 reference-column indexes. Until now it built only declared indexes, so the drift plan on a remote database showed a `create_index` for each implicit index after every sync.

On SQLite, the index does not speed up a default-ordered page yet. While the engine adds the empty controlled-by-parent chain to the query, the SQLite planner still sorts in a temporary B-tree. When the query has no chain, the same page takes 0.16 ms instead of 1.6 s at 1M rows.

`@objectstack/driver-sql` also exports `implicitReferenceIndexes`, which takes an optional `physicalColumns`.
