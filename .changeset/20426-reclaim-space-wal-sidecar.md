---
'@objectstack/driver-sql': patch
---

fix(driver-sql): `reclaimSpace()` returns the freed bytes from the SQLite `-wal` sidecar too, and never waits on another connection (#20426)

Clause-②: no

On a file-backed SQLite database in WAL mode, the default, `reclaimSpace()` returned the whole freelist but left the freed bytes in the `-wal` sidecar. At 25,754 free pages the database file went from 103,149,568 to 16,384 bytes while the `-wal` file went from 4,255,992 to 94,430,432 bytes, and it kept that size until the last connection closed. The lifecycle sweep calls this method after every sweep that deleted rows, and it reported the datasource as reclaimed.

On better-sqlite3 (`SqlDriver`, and `TursoDriver` in local mode) the vacuum now runs in chunks of a quarter of the connection's page cache, 1,000 pages at the default cache size, with a `PASSIVE` checkpoint after each chunk. One `TRUNCATE` checkpoint closes the call, taken with a busy timeout of 0, so it never waits on another connection. On the same database, file plus `-wal` goes from 107,405,560 to 16,384 bytes while the driver is still open.

When another connection holds a read transaction, the call still returns without waiting (47 to 66 ms measured; a `TRUNCATE` checkpoint that waits blocked the process for the connection's 5-second busy timeout). The pages are off the freelist, and their bytes leave the files at a later checkpoint. The call no longer grows the pair either: 107,405,560 bytes before and after, where the single statement grew it to 197,580,000.

A database in rollback-journal (`delete`) mode behaves as before. The remote `TursoDriver` route and `SqliteWasmDriver` are unchanged. Nothing to migrate: `reclaimSpace()` keeps its signature.
