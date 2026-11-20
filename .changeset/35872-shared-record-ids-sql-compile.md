---
'@objectstack/driver-sql': patch
'@objectstack/driver-turso': patch
'@objectstack/spec': patch
---

feat(driver-sql, driver-turso): the SQL drivers compile the `SharedRecordIds` fixed-read leaf to a subquery (ADR-0155, step 3 of 6)

Clause-②: yes
Metadata-protocol: none

No visible change on its own: nothing on main writes a `SharedRecordIds` leaf yet. The sharing plugin starts writing it at ADR-0155's last step.

- **The compile** (`@objectstack/driver-sql`). A `SharedRecordIds` leaf in a field's `$in` compiles to one subquery in the list's own position: `id IN (SELECT record_id FROM sys_record_share WHERE object_name = ? AND recipient_type = 'user' AND recipient_id = ? AND record_id IS NOT NULL AND record_id <> '')`. The write form adds `AND access_level IN (…)` inside the subquery. Every value is bound. The subquery carries no tenant scope (ADR-0155 ① ruled A), and the outer statement's tenant wall is unchanged. It covers every read verb and `updateMany`, on SQLite, PostgreSQL, MySQL, SQL Server and Oracle. On Oracle the `<> ''` half is left out, because Oracle stores `''` as NULL. `SqliteWasmDriver` and Turso's local mode inherit the compile.
- **The remote transport** (`@objectstack/driver-turso`). Turso's remote mode compiles the same subquery with its own compiler, from the same predicates.
- **The declaration.** `SqlDriver.supports.fixedReadLeaves` is `['SharedRecordIds']`, and `TursoDriver` inherits it in every mode. The engine's seam now hands the leaf to these drivers instead of refusing it.
- **The refusal.** A leaf anywhere other than a field's `$in` comparand is refused before any statement runs, with `INTERNAL_ERROR` / 500, and logged at `error` once per driver.
- **New exports** (`@objectstack/driver-sql`). `findMisplacedFixedReadLeaf`, `fixedInnerReadPredicates` and `misplacedFixedReadLeafMessage` are the walk, the predicates and the refusal text the two compilers share.
- **The shared case-set** (`@objectstack/spec`). `SHARED_RECORD_IDS_CASE_SET` gains a note (`n5`) on a doc whose only grant is stamped in another organization, and a nested case read under a tenant. Together they witness, in the nested position, that the inner read carries no tenant scope.
