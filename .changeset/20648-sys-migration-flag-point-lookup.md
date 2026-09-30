---
'@objectstack/objectql': patch
'@objectstack/platform-objects': minor
'@objectstack/metadata-protocol': minor
---

fix(objectql,platform-objects,metadata-protocol)!: the platform's `sys_migration` primary-key lookups go through `findOne`, so an existing deployment no longer prints "Paged read of 'sys_migration' is NOT deterministic" on every boot and every `os migrate plan` (#20648)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (runtime-interface-only packages/platform-objects/src/system/migration-flag.ts#MigrationFlagEngine, packages/metadata-protocol/src/migrations/seed-tenancy-backfill.ts#SeedTenancyLedger) two duck-typed engine interfaces, each the parameter type of a published helper, whose one read method moves from `find` to `findOne`. Neither is a Zod schema, a `packages/spec` declaration or an object definition, neither is a projection of a schema, and no metadata surface references either, so `objectstack migrate meta` has nothing to rewrite. The body carries no migration prescription. The only party affected is the TypeScript author of a hand-written stand-in, and that author's fix is carried by the compiler at their own call site, which names the missing `findOne`. The other categories are closed on facts: both packages publish (not `unpublished`); no ADR-0087 id covers an engine interface's method set, and this diff adds none (not `registered` / `already-registered`); and both interfaces were concretely typed at the merge base, not erased (not `type-surface-only`). This category, not the broader `no-migration-prescription`, because the positive reading it verifies is available here: the named symbols have no metadata surface. -->

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

**BREAKING**: this narrows what two published engine interfaces accept. The
first is `MigrationFlagEngine` in `@objectstack/platform-objects/system`. It is
the parameter type of `readDataMigrationFlag`, `isDataMigrationVerified`,
`mayActIrreversibly`, `recordDataMigrationRun`, `recordFileColumnMove` and
`attestFreshDatastore`, and part of `FilesToReferencesEngine` in
`@objectstack/service-storage`. The second is `SeedTenancyLedger` in
`@objectstack/metadata-protocol`, the type of a `SeedTenancySeam`'s `ledger`.
Each now requires `findOne` where it required `find`, so a hand-written stand-in
that provides only `find` no longer satisfies either type. It ships as `minor`
under the launch-window convention for accept-set narrowings. The ObjectQL engine
has both methods, so a host that passes the engine needs no change.

**Your fix:** a stand-in that implemented `find` for these helpers implements
`findOne(object, options)` instead, answering the row whose `where.id` matches,
or `null`.

At run time, a stand-in that still provides only `find` fails the read.
`readDataMigrationFlag` then answers `null`, the same answer as a missing row, so
the gates it feeds stay closed. `resolveSeedTenancySeam` now attaches a `ledger`
only for a host that has `getObject`, `findOne`, `insert` and `update`. For a
find-only host the seam's `ledger` is `undefined`, and when the seed-tenancy
repair applies, it says at `warn` that it could not record its receipt.
