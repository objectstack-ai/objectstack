---
'@objectstack/driver-sqlite-wasm': patch
---

fix(driver-sqlite-wasm): a database-file write that fails in the background is reported once, at `error` with the file named, instead of reaching the process as an unhandled rejection

`WasmSqliteConnection` writes the in-memory image to disk without anyone awaiting it in three places: after each write under `persist: 'on-write'`, when the `debounced:N` timer fires, and when a transaction closes with a flush deferred. A write that failed there (the disk full, the data directory removed under a live driver) had no caller to throw to, so its rejection reached the host process as an `unhandledRejection`: a failed run under Vitest, and a terminated process under Node's default.

Those three flushes now go through one helper. A failed one is logged once per failure episode, at `error` where the logger has one and at `warn` where it does not, naming the database file and saying that writes since the last good flush are not on disk. The file stays marked dirty, so the next write's flush (or `close()`) retries it and lands once the cause is gone. Further failures stay quiet until a flush has succeeded.

An awaited `flush()` and `close()` are unchanged and still throw to their caller. The `logger` option's type is unchanged; a logger that only has `warn` still hears the report, at `warn`.
