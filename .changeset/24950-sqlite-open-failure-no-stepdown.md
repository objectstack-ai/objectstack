---
'@objectstack/service-datasource': patch
---

fix(service-datasource): in development, a SQLite datasource whose file cannot be opened or created fails its connect, as in production, instead of stepping down to an in-memory engine

Clause-②: no

`resolveSqliteDriver` probes a native `better-sqlite3` connection in development and steps down to wasm SQLite, then to an in-memory engine, when the probe fails. It used to step down on any probe failure. So a declared SQLite datasource whose file could not be opened read `connected` on a development boot (`NODE_ENV=development`, which the source-tree `bin/run-dev.js` sets). Examples: a path under a regular file, a parent directory the process cannot make, a permission refusal, a directory where the file should be. Every query on it then went to an empty in-memory store, so a maintenance command could report a store it never opened as examined and clean.

- **Now:** a probe failure that is the database file failing to open or be created is re-thrown in development, as in production. The datasource's connect fails with the driver's `SqliteDatabaseFileError`, which names the file and the operating system's answer (`EEXIST`, `ENOTDIR`, `ENOENT`, `EACCES`, … or `SQLITE_CANTOPEN`). `listConnectionStates()` reports it as `failed`. This holds for every SQLite datasource, the primary included, so a development boot whose primary database file cannot be opened now stops and names the file.
- **Unchanged:** a native addon that cannot load (an ABI mismatch, an addon that was never built, a missing `better-sqlite3`) still steps down to wasm SQLite, with the same warning. An absent file in a directory that exists, or that the driver can make, still opens natively and is created. Production behaviour is unchanged.

What to do: if a development boot now refuses a SQLite datasource, fix its `filename`. The boot names the path it could not open.
