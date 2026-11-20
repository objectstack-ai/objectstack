---
'@objectstack/driver-sql': patch
---

feat(driver-sql): on PostgreSQL the share-grant subquery compares `record_id` as the outer key's own type (ADR-0155 O2)

Clause-②: yes
Metadata-protocol: none

No visible change on its own: nothing writes a `SharedRecordIds` leaf yet. The sharing plugin starts writing it at ADR-0155's last step, and this makes that step safe on PostgreSQL tables whose key is not text.

- **PostgreSQL, a key that is not text.** The compiled subquery `id IN (SELECT record_id FROM sys_record_share WHERE …)` now projects `record_id` cast to the base type of the column it is compared with: `CAST(NULLIF(record_id, '') AS <type>)`. A federated table keyed by `integer`, `bigint`, `smallint`, `numeric`, `uuid`, `character(n)` or a domain over one of them answers the same rows as the id list of the same grants: `07` names 7, an upper-case or braced uuid names its lower-case twin, and a padded grant names a `character(n)` key. Before, an integer or uuid key failed the statement with `DATABASE_ERROR` (42883), and a `character(n)` key silently missed a padded grant.
- **A malformed grant id** (`abc` against an integer key) fails the statement with `DATABASE_ERROR` / 500, the same answer the id list gives for it.
- **How the type is known.** The driver reads the column types of the compared table from `pg_catalog` once, the first time a statement holding the leaf reaches that table, and keeps the answer for the life of the driver. A statement with no leaf reads nothing. A failed catalog read records nothing and is asked again by the next statement.
- **Unchanged.** A `text` or `varchar` key, which is every table the platform creates, compiles exactly as before. SQLite, MySQL, SQL Server and Oracle compile exactly as before; SQLite answers the list's rows by column affinity. MySQL, SQL Server and Oracle `RAW(16)` keys are not measured against a live server yet.
