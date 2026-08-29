---
"@objectstack/driver-sql": patch
"@objectstack/cli": patch
---

`os migrate plan` / `apply` examine the object set the composed host DECLARED, and report the boundary when they cannot

A composed host stack (#12938) registers its plugins for their DECLARATIONS: `init()` runs, `start()` is suppressed. The pass that hands every registered object to its driver — the one that fills the `managedObjectFields` map `detectManagedDrift()` diffs — lives in `ObjectQLPlugin.start()`, and a host that brings its own `ObjectQLPlugin` (under the framework's own plugin name, so the CLI's capability injector de-dups against it) DISPLACES the standalone one, since duplicate registration overwrites by name. The result was a boot where no `ObjectQLPlugin.start()` ran at all: every host plugin declared its objects, and not one reached a driver.

Measured on ObjectStack Cloud's staging control plane: 36 host plugins composed, ~80 `sys_*` tables declared, **8** examined — all eight belonging to the single service that provisions its own tables from a `kernel:ready` hook rather than relying on that pass. Every consumer-visible signal was green, and `Physical schema is in sync with metadata` was one composed plugin away from printing over seventy unexamined tables.

Two changes:

- **The composed boot now drives that pass itself**, over the deferral it already armed: `engine.syncObjectSchema(name)` per declared object, which reaches `SqlDriver.initObjects` exactly as the suppressed `start()` would have. A plan still writes nothing — the deferral records the create-table work instead of running it.
- **`plan` / `apply` report what they could NOT examine.** `--json` payloads gain `composition.coverage` (`registeredObjects`, `examinedObjects`, `unexaminedObjects`, and per-reason counts: federated, unbound, on another datasource, on a driver without schema registration, refused). When `unexaminedObjects > 0`, the human output refuses the unqualified "in sync" line and says the plan is PARTIAL instead. A consumer gate asserting coverage should read `composition.coverage.unexaminedObjects` — `managedTables` alone cannot tell a small deployment apart from a mostly unexamined one.

`@objectstack/driver-sql`: `initObjects` no longer calls `ensureDatabaseExists()` while DDL is deferred. It is the one line there that can write — `mkdir -p` for a sqlite parent directory, and on Postgres/MySQL a `SELECT 1` that CREATEs the database on `3D000` / `ER_BAD_DB_ERROR` — and under the deferral there is no DDL for a database to exist for. `flushDeferredSchemaDdl` clears the flag before re-entering, so the confirmed `os migrate apply` still ensures the database ahead of the first `CREATE TABLE`.

A project with neither an `objectstack.config.*` nor a compiled artifact is unchanged: it composes nothing, carries no `composition` key, and diffs the same five data-stack tables it always did.
