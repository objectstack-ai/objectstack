---
"@objectstack/driver-sql": patch
---

fix(driver-sql): judge unique violations with the shared predicate, so a Postgres index build over dirty data no longer takes the boot down (#6543)

`syncDeclaredIndexes` has a branch whose whole job is to keep a database
BOOTING when existing rows violate a NULL-safe unique it was asked to create
(the #5030 defect made data): the constraint is logged at `error` as not
enforced, and the ADR-0120 D4 drift pre-flight reports the exact conflicting
rows. Taking the process down instead would brick the deployment.

It decided whether it was looking at that case with a private inline regex over
the stringified message — `unique constraint failed|duplicate entry|duplicate
key value`, the fourth hand-written spelling of this question #6250
inventoried. That read one of the two channels drivers use, and on the DDL path
the missing channel is the whole answer for one shipped dialect:

| dialect | `CREATE UNIQUE INDEX` over duplicate rows says | old regex |
|:---|:---|:---|
| SQLite   | `UNIQUE constraint failed: product.code`                | matched |
| MySQL    | `ER_DUP_ENTRY: Duplicate entry 'DUP' for key 'uniq_…'`  | matched |
| Postgres | `could not create unique index "uniq_…"`, SQLSTATE 23505 | **missed** |

Postgres does not reuse its DML phrasing for an index build: `duplicate key
value violates unique constraint` is what a conflicting INSERT says, while a
conflicting index BUILD says `could not create unique index "…"` and puts the
verdict on `error.code` (SQLSTATE `23505`) with the offending tuple on
`error.detail`. None of the three message limbs appear in it — so on Postgres
the branch never fired, and a database with legacy duplicates failed to start
rather than booting with the constraint reported as unenforced.

Both discriminators in this file now call `isUniqueViolationError` from
`@objectstack/types`, passing the **error object** rather than a pre-stringified
message, so `code`, `errno` and the `cause` chain are read alongside `message`:

- the #5030 boot-survival branch above;
- the negative limb of the MySQL functional-key-part fallback in
  `createNullSafeUniqueIndex`, which used a bare `/duplicate/i` to avoid
  degrading a conflict into a "this server rejects functional key parts"
  verdict — a message-only exclusion that did not fire on the `errno`-only
  shape mysql2 can hand back.

`patch` rather than `minor`: no API changes, and the message spellings that
were recognised before are a strict subset of what the predicate recognises, so
nothing that was absorbed before is absorbed differently now. The site's own
business logic — the `nullSafe.size > 0` guard that keeps this absorption
scoped to the NULL-safe case, and the "already exists" race arm that runs ahead
of it — is unchanged.
