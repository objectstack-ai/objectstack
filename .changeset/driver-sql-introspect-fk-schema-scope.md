---
"@objectstack/driver-sql": patch
---

fix(driver-sql): scope the Postgres `introspectForeignKeys` catalog read to the session's own schemas (#11201)

The Postgres arm queried `information_schema.table_constraints` with
`tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = ?` and **no `table_schema`
predicate at all**. Those views span every schema the session has privilege on,
independently of `search_path`, so a table name that exists in more than one schema had
all of their foreign keys merged into a single answer — including foreign keys from
schemas the session can never reach unqualified.

That is a wrong answer rather than a missing one, and it is consumed as fact:
`introspectSchema` hangs the result on the table it just listed, and from there it reaches
federated-object codegen, the persisted `external_catalog` (ADR-0015) and schema-drift
comparison. A phantom foreign key makes a drafted federated object reference a table it
does not reference.

The fix is the pin the rest of the family already carries —
`AND tc.table_schema = ANY (current_schemas(false))` — spelled and placed exactly as
`introspectUniqueConstraints` spells it, which in turn follows `introspectSchema`'s own
table listing. `introspectForeignKeys` was the last unscoped introspection arm; the two
`pg_index`-based arms (`introspectIndexes`, `introspectPrimaryKeys`) reach the same scoping
from the other side by resolving the name to an OID through `regclass`. No interface shape
and no accepted input changes: a same-named table in another schema simply stops
contributing foreign keys it never should have contributed.

Measured on a live PostgreSQL 16.13. The regression pin
(`sql-driver-11201-introspect-fk-schema-scope.test.ts`) builds the collision the repo's own
live-PG isolation (#9350, one schema per test file in one database) already makes routine:
two same-named tables in two schemas, each with a different foreign key. It first asserts
the pre-fix predicate really sees both constraints — so the interesting assertion, an
absence, cannot go green on a fixture that never collided — then requires the arm and
`introspectSchema` to return only the current schema's. Reverse-verified: with the
predicate reverted the pin fails with the neighbour's foreign key present in the answer.

The MySQL arm of the same method was checked and is not affected: it already pins
`TABLE_SCHEMA = DATABASE()`. SQLite has no schemas.
