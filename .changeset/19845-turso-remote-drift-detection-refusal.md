---
'@objectstack/driver-turso': minor
---

fix(driver-turso): a REMOTE `TursoDriver` refuses to detect schema drift instead of answering that there is none (#19845)

Clause-②: no (narrowing)

**BREAKING for callers that read schema drift from a remote Turso datasource** — `TursoDriver.detectManagedDrift()` in `remote` transport mode (a `libsql://`, `https://`, `http://`, `wss://` or `ws://` URL with no `syncUrl`) now throws a `NOT_IMPLEMENTED` / `501` error, with or without an explicit object list, where it used to answer `[]`. The `local` and `replica` modes detect drift exactly as before.

What the refusal replaces, measured on the transport's SQLite-backed test double: the inherited detector reads the physical schema through Knex, and a remote driver's Knex connection is a placeholder in-memory database holding none of the datasource's tables. A synced table carrying an extra physical column the declaration omits therefore read `unmapped_column` / `drop_column` on the local face and `[]` on the remote one. The artifact-pinned boot gate of `os serve` (`OS_ARTIFACT_URL`), which refuses a boot on destructive drift, read that `[]` as "never drifted" and let every remote-Turso boot through.

- **The boot gate now says it could not check.** It already treats a failed drift detection as "the check did not run": it prints a warning carrying the driver's message and the boot continues. A remote-Turso boot is therefore not refused by this change; it is told the schema was not checked, where before it was told nothing.
- **No other caller in this repository reaches it.** The `os migrate` commands that read drift (`plan`, `apply`, `multi-value-columns`) arm deferred schema DDL first, which the remote face already refuses.
- **No new error code.** `NOT_IMPLEMENTED` / `501` is a standard code, the envelope this transport already uses for its remote transaction, auto-number and deferred-DDL refusals.

**If you are refused:** to check a remote Turso database for drift, run `os migrate plan` against a local SQLite copy of it (a `file:` URL), where the physical schema is introspected.

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable is removed, renamed or reshaped: no spec key, no export, no stored row and no config key — `detectManagedDrift` keeps its name and its signature. There is no old spelling that maps to a new one: the refused call asked the remote transport for a capability it never delivered, and the refusal itself carries the remedy. -->
