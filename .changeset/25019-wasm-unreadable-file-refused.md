---
'@objectstack/driver-sqlite-wasm': patch
'@objectstack/service-datasource': patch
---

fix(driver-sqlite-wasm)!: a file wasm SQLite cannot read is refused at connect, naming the file, and left as it was found, instead of being renamed and replaced with an empty database (#25019)

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object definition or stored shape is added, removed, renamed or re-shaped, and no exported declaration is removed or narrowed (`WasmSqliteConnection` and `SqliteWasmDriver` keep their shapes; the private quarantine method is gone), so there is nothing for `objectstack migrate meta` to rewrite. What changes is the answer wasm SQLite's connect gives for a database file it cannot read: a rejection naming the file where it renamed the file and resolved over an empty database. The remedy is the datasource's file, never a rewrite of a package source or a stored row. -->

**BREAKING** (wasm SQLite's connect accept set narrows). `WasmSqliteConnection.open()` used to answer a file sql.js could not read by renaming it to `<file>.corrupt-<timestamp>` and starting an empty database in its place, with one warning. That self-heal was written for wasm SQLite's own torn writes, which the atomic flush has since closed; what still reached it was an operator's file on a declared datasource. A datasource declared `driver: 'sqlite-wasm'` over such a file read `available` over the empty replacement, in development and production alike, and a declared `sqlite` datasource on a development boot whose native addon cannot load stepped down to wasm SQLite and met the same rename. The native driver already refuses the same files at connect.

- **FROM:** a file sql.js cannot read (plain text, another format, a database truncated inside its header or short of the pages its schema names) was moved to `<file>.corrupt-<timestamp>`; `connect()` resolved over an empty database, and the datasource read `available`. On a development boot whose native addon cannot load, `resolveSqliteDriver` (`@objectstack/service-datasource`) returned that wasm driver, and when wasm SQLite failed for any reason it went on to the in-memory driver.
- **TO:** `SqliteWasmDriver.connect()` rejects with the native driver's `SqliteDatabaseFileError`: `code: 'SQLITE_NOTADB'` for bytes that are not a database, `code: 'SQLITE_CORRUPT'` for a database it cannot read, `filename`, and a message naming the file and how to move it aside. Nothing is renamed, nothing is written beside it, and a stale write-ahead log beside a refused file stays where it is. `WasmSqliteConnection.open()` rejects with the same code and `filename`. `resolveSqliteDriver` re-throws that refusal at the wasm rung instead of trying the in-memory driver, so the datasource's connect fails and its connection state says so. Any other wasm failure, sql.js itself not loading first among them, still goes on to the in-memory driver.
- **Unchanged:** a real database opens and answers; an absent file is created; an empty file opens as an empty database; a native addon that cannot load over a real or absent file still steps down to wasm SQLite.
- **The fix for an operator:** restore the database from a backup, or move the unreadable file aside yourself (`mv '<file>' '<file>.unreadable'`) and start again: an absent file is created empty on the next connect. A development server whose own wasm image is damaged no longer starts itself clean; this is that step, done by hand.
