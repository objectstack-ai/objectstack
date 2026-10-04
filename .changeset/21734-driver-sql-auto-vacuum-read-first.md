---
"@objectstack/driver-sql": patch
---

A connect to a SQLite file that is already `auto_vacuum=INCREMENTAL` no longer writes to it. `SqlDriver.connect()` now reads `PRAGMA auto_vacuum` first and runs `PRAGMA auto_vacuum = INCREMENTAL` only when the file answers something else.

Clause-②: no

- **What changed on disk.** On a file that already answered INCREMENTAL, the setter changed no mode, but it still stamped two header counters: the file change counter (bytes 24–27) and the version-valid-for number (bytes 92–95). So a read-only command such as `os migrate duplicates`, which the CLI docs say writes nothing at all, changed the file's md5 on every run. Reading the pragma changes no bytes, so such a file now comes through a connect, and a whole `os migrate duplicates` run, byte-identical.
- **Unchanged.** A fresh file and `:memory:` still come out INCREMENTAL. A legacy NONE file that already holds tables still gets the setter, which leaves it NONE until a `VACUUM` (`os db clean`), exactly as before. The journal-mode step already read first and set only on a difference, and it is untouched. Postgres and MySQL issue no PRAGMA.
- **The WASM SQLite driver** inherits the rule. A connect and disconnect no longer rewrites an already-INCREMENTAL image file, because the setter was what marked the image dirty.
- ⛔ No config key, export, error code or accepted input changes.
