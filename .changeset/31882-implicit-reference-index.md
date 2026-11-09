---
'@objectstack/driver-sql': patch
---

fix(driver-sql): index each authored single-valued reference column without a declaration

Clause-②: no
Metadata-protocol: none

The SQL driver now gives every authored single-valued `master_detail`, `lookup` and `user` column a non-unique `(column)` index named `idx_TABLE_COLUMN`. Before, it built only the indexes metadata declared, so a read of the detail rows of one parent (a `controlled_by_parent` read, a related list, the referential-integrity read on a parent delete) walked the whole organization through the tenant index or scanned the table. Measured on PostgreSQL 16 at 1M rows: 73 ms before, 1.4 ms after; on SQLite at 200k rows: 21 ms before, 0.2 ms after. Read and write results are unchanged; only the plan is.

What is skipped:

- Multi-valued references (`multiple: true`), which are JSON columns.
- The platform's own system columns (`created_by`, `updated_by`, `owner_id`, `owning_business_unit_id`) and the tenant column, which has its own index already.
- A column that a declared index already has as its leading column. An author who later declares `{ fields: ['COLUMN'] }` gets the same name, so the two converge on one index.

Write cost, measured on a 20,000-row `bulkCreate` into a table already holding 20,000 rows, with one `master_detail`, one `lookup` and one `user` column (three new indexes): about 12% slower on PostgreSQL 16 and about 39% slower on SQLite. A table with only a `master_detail` column pays about 3% (PostgreSQL) and 6% (SQLite).

Existing deployments: the indexes are created on the next boot by the same additive schema sync that creates declared indexes, and `os migrate plan` lists each missing one as a safe `create_index` beforehand. On PostgreSQL the build is a plain `CREATE INDEX`, which blocks writes to that table while it runs: about 0.5 s at 1M rows in our measurement. A second sync creates nothing.
