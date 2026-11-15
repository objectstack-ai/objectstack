---
'@objectstack/plugin-audit': patch
'@objectstack/objectql': patch
'@objectstack/cli': patch
---

feat(plugin-audit, cli)!: an `os migrate audit-* --apply` run holds the audit seal lock for its whole run, each sealer pass skips while it is held, and where the database offers no session lock a run on a sealed object needs `--sealer-stopped`

Clause-②: yes (narrowing) — narrowed: `os migrate audit-key-material`, `os migrate audit-mail-bodies` and `os migrate audit-metadata-bodies` with `--apply` now refuse a run that rewrites an object declaring `lifecycle.seal` when that object's database offers no session lock (SQLite, Turso) unless `--sealer-stopped` is passed, and on Postgres or MySQL refuse when a sealer pass or another run still holds the audit seal lock after ten minutes; 18.4.0 ran both. Widened: the `--sealer-stopped` flag, and new exports — `@objectstack/objectql` `acquireDatabaseSessionLock`, `tryDatabaseSessionLock`, `databaseSessionLockPgKey` and the types `DatabaseSessionLock`, `DatabaseSessionLockWait`; `@objectstack/plugin-audit` `holdAuditSealLock`, `AUDIT_SEAL_LOCK_NAME`, `AUDIT_SEAL_LOCK_WAIT_MS`, `STORED_METADATA_BODY_REWRITTEN_OBJECTS` and the types `AuditSealLockEngine`, `AuditSealLockFinish`, `AuditSealLockHold`.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value or metadata type is added, removed or renamed, and nothing stored is rewritten: the moved answer is whether an os migrate audit-* --apply run may proceed while a sealer could be sealing the rows it rewrites. The one-line fix for a refused run is in the body: stop the servers that seal the database and pass --sealer-stopped, or let the sealer pass finish. -->

**BREAKING** for an `os migrate audit-* --apply` run on a deployment where an app declared `lifecycle.seal`. On SQLite or Turso the run now stops before writing anything and names the flag: stop every server that seals the database, then re-run with `--sealer-stopped`. On Postgres or MySQL the run waits up to ten minutes for a sealer pass in flight, then refuses, having changed nothing: run it again once that pass has finished. A run that rewrites no sealed object is unchanged on every database, and so is every dry run. No object declares `lifecycle.seal` by default, so a deployment that did not opt in sees no change.

**The audit seal lock (ADR-0154 D3, as amended 2026-11-14).** A sealer pass and an `os migrate audit-*` rewrite no longer work on a sealed object at the same time. That race let a pass seal a row's old value while the rewrite redacted it, and `os audit verify` then reported the sanctioned redaction as a modified row. The lock is a database session lock named `objectstack:audit-seal`, a Postgres advisory lock or a MySQL `GET_LOCK` on a connection of its own, taken on the database that holds each sealed object's rows (its hot store, where that differs from the primary database).

- Each sealer pass takes it beside the cluster lock `audit.sealer`. While another session holds it, the pass seals nothing and says so at `info`, once an hour while it lasts; the next pass tries again. A checkpoint is written only while both locks still stand: a lock whose database session ended fails the object's pass, and the seed it had sealed is dropped.
- An `--apply` rewrite holds it from before its first write to after its last, archive runs included. A run whose lock's database session ended before it finished says so, names `os audit verify`, and exits non-zero.
- Two replicas with no cluster service now also keep their passes apart through this lock on Postgres and MySQL.
- On MySQL, lock names are server-wide: a rewrite on one database of a server makes the sealer of another database on that server skip its passes while it runs.

**`@objectstack/objectql`.** The schema-migration lock and the audit seal lock share one implementation of a named database session lock, now exported: `acquireDatabaseSessionLock` (wait, then refuse), `tryDatabaseSessionLock` (once, never waiting: the lock, `'held'`, or `null` where the database offers none) and `databaseSessionLockPgKey`. A held lock's `isHeld()` asks its own session whether it still stands. `acquireSchemaMigrationLock` takes the same statements, prints the same lines and refuses with the same message as before.
