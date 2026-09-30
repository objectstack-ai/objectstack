---
'@objectstack/objectql': patch
'@objectstack/platform-objects': minor
'@objectstack/metadata-protocol': minor
---

fix(objectql,platform-objects,metadata-protocol)!: the platform's `sys_migration` primary-key lookups go through `findOne`, so an existing deployment no longer prints "Paged read of 'sys_migration' is NOT deterministic" on every boot and every `os migrate plan` (#20648)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (runtime-interface-only packages/platform-objects/src/system/migration-flag.ts#MigrationFlagEngine, packages/metadata-protocol/src/migrations/seed-tenancy-backfill.ts#SeedTenancyLedger) two duck-typed engine interfaces, each the parameter type of a published helper, whose one read method moves from `find` to `findOne`. Neither is a Zod schema, a `packages/spec` declaration or an object definition, and no metadata surface references either, so `objectstack migrate meta` has nothing to rewrite: the affected party is the TypeScript author of a hand-written stand-in, and the channel that reaches them is the compiler at their own call site. The other categories are closed on facts: both packages publish (not `unpublished`); no ADR-0087 id covers an engine interface's method set, and this diff adds none (not `registered` / `already-registered`); the body does prescribe a rewrite, for TypeScript source rather than stored metadata, which is the shape this category was built for (not `no-migration-prescription`); and both interfaces were concretely typed at the merge base, not erased (not `type-surface-only`). The prescription detector does not flag the FROM/TO table below, and this claim does not rest on that miss: it rests on the four symbol predicates this gate verifies. -->

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

**BREAKING**: this narrows what two published engine interfaces accept. A
hand-written stand-in passed as a `MigrationFlagEngine` must now provide
`findOne(object, options)`, which answers the row whose `where.id` matches, or
`null`. That interface is the parameter type of `readDataMigrationFlag`,
`isDataMigrationVerified`, `mayActIrreversibly`, `recordDataMigrationRun`,
`recordFileColumnMove` and `attestFreshDatastore`, and part of
`FilesToReferencesEngine` in `@objectstack/service-storage`. The same holds for a
stand-in passed as the `ledger` of a `SeedTenancySeam`. A stand-in that provides
only `find` no longer satisfies either type. It ships as `minor` under the
launch-window convention for accept-set narrowings. The ObjectQL engine has both
methods, so a host that passes the engine needs no change.

| Surface | FROM | TO |
| --- | --- | --- |
| `MigrationFlagEngine` (`@objectstack/platform-objects/system`; also part of `FilesToReferencesEngine` in `@objectstack/service-storage`) | `find(object, options): Promise<Record<string, unknown>[]>` | `findOne(object, options): Promise<Record<string, unknown> \| null>` |
| `SeedTenancyLedger` (`@objectstack/metadata-protocol`, the `ledger` of `SeedTenancySeam`) | `find(object, options): Promise<Record<string, unknown>[]>` | `findOne(object, options): Promise<Record<string, unknown> \| null>` |

At run time, a stand-in that still provides only `find` fails the read.
`readDataMigrationFlag` then answers `null`, the same answer as a missing row, so
the gates it feeds stay closed. `resolveSeedTenancyLedger` now resolves a ledger
only on a host that has `getObject`, `findOne`, `insert` and `update`. A find-only
host gets no ledger, and the seed-tenancy repair says at `warn` that it could not
record its receipt.
