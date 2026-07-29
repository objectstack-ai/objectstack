---
'@objectstack/driver-sql': minor
'@objectstack/runtime': minor
'@objectstack/cli': minor
---

`os migrate` no longer touches the database before you confirm, and refuses a
SQLite database another process is using (#3917).

**Nothing is written before the prompt.** `plan` called itself a dry run and
`apply` gated on `[y/N]`, but both booted the full plugin set first — and boot
schema-sync issued create-table/add-column DDL (plus the artifact's inline seed
wrote rows) against the target database before either promise was kept.
`SqlDriver` gains `setDeferredDdl` / `previewDeferredSchemaWork` /
`flushDeferredSchemaDdl`: while armed, `initObjects` still registers every
in-memory map drift detection depends on but records the physical work instead
of performing it. Both commands boot with it armed, render the held-back work
as a `New (additive)` section of the plan, and `apply` performs it only after
confirmation. `os meta resync` / `os migrate files-to-references` keep the old
behaviour — they need the tables to exist.

**Occupancy check.** A live `os dev`/`os serve` holding the same SQLite file is
the usual way a migration goes wrong: the migration is transactional and swaps
tables inside the file, but the running server keeps prepared statements and a
schema cookie the migration invalidates. `os migrate` now probes the target
before booting — `PRAGMA locking_mode = EXCLUSIVE` + `BEGIN IMMEDIATE` under
`busy_timeout = 0`, which reports `SQLITE_BUSY` when another connection is
*attached*, not merely writing. (`wal_checkpoint(TRUNCATE)` only sees an active
writer, and `-wal`/`-shm` presence cannot tell a live server from a crashed one;
both are encoded as tests.) `apply` refuses with exit 1 — `error: database_busy`
under `--json` — unless the new `--force` flag is passed; `plan` warns and
continues, since it writes nothing either way. SQLite only: Postgres and MySQL
take their own server-side locks.

`@objectstack/runtime` also exports `resolveStandaloneDatabase()`, so a caller
can resolve the database target with the same precedence the boot uses without
building the stack, and `createStandaloneStack` accepts `skipSeedData`.
