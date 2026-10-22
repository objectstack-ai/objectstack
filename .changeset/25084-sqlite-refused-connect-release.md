---
'@objectstack/driver-sql': patch
---

fix(driver-sql): a SQLite `connect()` that refuses its file closes the connection it opened before it rejects

Clause-②: no (resource release only: no response, status, error, outcome or export moves)
Metadata-protocol: none

- **What it was.** `SqlDriver.connect()` refuses a declared SQLite file its first statement cannot use (`SqliteDatabaseFileError`: `SQLITE_CANTOPEN`, `SQLITE_NOTADB`, `SQLITE_CORRUPT`). The file was opened to give that answer, and the pool kept the better-sqlite3 connection after the rejection. For a damaged file whose header says WAL, SQLite kept its `-shm` and an empty `-wal` beside the file until something called `disconnect()`. A datasource left unconnected on the degraded path is never disconnected, so it kept them for the life of the process.
- **What changed.** When a SQLite `connect()` rejects, it destroys its pool and puts a fresh, empty one in its place, then rethrows the same error: same class, code, message and `cause`. Nothing is left open, and the `-shm` / `-wal` siblings are gone when the rejection arrives. A later `connect()` on the same instance opens the file again: it gives the same refusal while the file is bad, and connects once the file is repaired. A release that itself fails is logged at `warn`, and the original refusal is still the error thrown.
- **Unchanged.** Which files are refused, the codes and the messages. Server dialects (`pg`, `mysql`) are untouched: their `connect()` rejects only when no connection could be made, so there is nothing to release. `SqliteWasmDriver` and the local mode of `TursoDriver` inherit the release through `super.connect()`.
- **What to do.** Nothing.
