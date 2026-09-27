---
'@objectstack/driver-turso': minor
---

fix(driver-turso): a REMOTE `TursoDriver` refuses to arm deferred schema DDL instead of accepting it and running the DDL anyway (#19823)

Clause-②: no (narrowing)

**BREAKING for callers that arm DDL deferral on a remote Turso datasource** — `TursoDriver.setDeferredDdl(true)` in `remote` transport mode (a `libsql://`, `https://`, `http://`, `wss://` or `ws://` URL with no `syncUrl`) now throws a `NOT_IMPLEMENTED` / `501` error, where it used to be accepted and then ignored. The five `os migrate` commands that arm it — `plan`, `apply`, `duplicates`, `account-issuer` and `multi-value-columns` — therefore exit non-zero against a remote Turso database, where they used to exit 0 after changing it. Disarming (`setDeferredDdl(false)`) is accepted, and the `local` and `replica` modes defer exactly as before.

What the refusal replaces, measured on the transport's SQLite-backed test double: arming was accepted, but none of the remote schema doors reads the flag. The engine's boot sync (`syncSchemasBatch`) ran `CREATE TABLE` and `ALTER TABLE … ADD COLUMN` through `RemoteTransport`; the `syncSchema` / `initObjects` doors ran the same DDL plus the canonical temporal backfill, rewriting stored `datetime` / `time` values in place; and `previewDeferredSchemaWork()` and `flushDeferredSchemaDdl()` both answered `[]`. So `os migrate plan` changed the database and then reported no pending work, and `os migrate apply` asked for confirmation after the schema work had already run.

- **Refused at the setter.** Every deferring caller passes through `setDeferredDdl`, and it runs before any schema work: a refused arm sends nothing to the database and leaves the driver un-armed.
- **The driver's message is what the operator reads.** The CLI prints it verbatim. It names the `remote` transport mode, says why the promise cannot be kept, and says what to do instead.
- **No new error code.** `NOT_IMPLEMENTED` / `501` is a standard code, the envelope this transport already uses for its remote transaction and auto-number refusals.
- **Ordinary boots are unchanged.** A boot that does not arm the deferral (`os serve`, `os start`, `os dev`) syncs a remote schema exactly as before.

**If you are refused:** to preview schema work, run the command against a local SQLite copy of the database (a `file:` URL); the local and embedded-replica faces defer DDL. To perform the additive schema work, let an ordinary boot against the remote datasource (`os serve` / `os start`) run it directly.

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable is removed, renamed or reshaped: no spec key, no export, no stored row and no config key — `setDeferredDdl` keeps its name and its signature. There is no old spelling that maps to a new one: the refused call asked the remote transport for a capability it never delivered, and the refusal itself carries the remedy. -->
