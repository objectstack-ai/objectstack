---
'@objectstack/objectql': patch
'@objectstack/platform-objects': patch
'@objectstack/metadata-protocol': patch
---

fix(objectql,platform-objects,metadata-protocol): the platform's `sys_migration` primary-key lookups go through `findOne`, so an existing deployment no longer prints "Paged read of 'sys_migration' is NOT deterministic" on every boot and every `os migrate plan` (#20648)

Clause-②: no

The deployment ledger is read one row at a time, by primary key. Five readers
spelled that read as `find(sys_migration, { where: { id }, limit: 1 })`: the
engine's migration-gate read (`readMigrationFlagVerified`, behind
`haveFileColumnsMoved`, `isFileReferencesMigrationVerified` and
`isValueShapesMigrationVerified`), the engine's deviation marker and
creation-attestation revocation, `readDataMigrationFlag` in
`@objectstack/platform-objects/system`, and the seed-tenancy repair's receipt.
The SQL driver cannot tell that read from page one of a walk. The engine's gate
read runs at boot before the schema pass registers `sys_migration` with the
driver, and on a table the driver has not registered an unsorted paged read
warns that its pages may repeat or skip rows. Measured on a SQLite database
created by 17.4.0: every 17.5.0 boot and every `os migrate plan` printed that
warning once, for a lookup that cannot return two rows. All five readers now use
`findOne`, the single-row route the driver already exempts. The driver's check is
unchanged: an unsorted `limit` read on a table the driver did not create still
warns.

**Two duck-typed engine surfaces change with the read.** Each one named the
method the helper calls, and that method is now `findOne`:

| Surface | FROM | TO |
| --- | --- | --- |
| `MigrationFlagEngine` (`@objectstack/platform-objects/system`; also part of `FilesToReferencesEngine` in `@objectstack/service-storage`) | `find(object, options): Promise<Record<string, unknown>[]>` | `findOne(object, options): Promise<Record<string, unknown> \| null>` |
| `SeedTenancyLedger` (`@objectstack/metadata-protocol`) | `find(object, options): Promise<Record<string, unknown>[]>` | `findOne(object, options): Promise<Record<string, unknown> \| null>` |

The ObjectQL engine has both methods, so a host that passes the engine needs no
change. Only a hand-written stand-in is affected. It must now provide `findOne`,
which answers the row whose `where.id` matches, or `null`. On a stand-in that
still provides only `find`, the read fails and `readDataMigrationFlag` answers
`null`, the same answer as a missing row, so the gates it feeds stay closed.
`resolveSeedTenancyLedger` now resolves a ledger only on a host that has
`getObject`, `findOne`, `insert` and `update`.
