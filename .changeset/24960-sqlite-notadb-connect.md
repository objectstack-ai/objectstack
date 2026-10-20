---
'@objectstack/driver-sql': patch
'@objectstack/service-datasource': patch
---

fix(driver-sql): a SQLite file whose bytes are not a SQLite database fails `connect()` at once, naming the file, and a development boot no longer moves it aside and replaces it with an empty database (#24960)

`SqlDriver.connect()` runs `PRAGMA auto_vacuum` as the connection's first statement. On a file that is not a SQLite database (plain text, another format, a file encrypted by another engine) SQLite answers `SQLITE_NOTADB`, which `connect()` logged as "Failed to set PRAGMA auto_vacuum=INCREMENTAL" and swallowed. It resolved over a file it could not read. In production the first query failed later. On a development boot, `resolveSqliteDriver` (`@objectstack/service-datasource`) answered the failed probe by stepping down to wasm SQLite, whose open renamed the file to `<file>.corrupt-<timestamp>`, wrote an empty database in its place and read `connected`, under a warning that blamed the native addon.

`connect()` now refuses such a file with a `SqliteDatabaseFileError` (`code: 'SQLITE_NOTADB'`, `filename`, a message naming the file), as it already did for `SQLITE_CANTOPEN`, in every mode and before anything is written. A declared datasource's boot prints `datasource '<name>': connect failed — <reason>`. `resolveSqliteDriver` classifies `SQLITE_NOTADB` as a file failure and re-throws it instead of stepping down, so the operator's file is left exactly as it was found. A real database file, an empty file and an absent file connect as before, and a native addon that cannot load still steps down to wasm SQLite.

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object definition or stored shape is added, removed, renamed or re-shaped, and no exported declaration is removed or narrowed (`SqliteDatabaseFileError` keeps its shape; only the set of codes it is raised with grows by one), so there is nothing for `objectstack migrate meta` to rewrite. What changes is the answer `SqlDriver.connect()` gives for a SQLite file that is not a database: a rejection where it resolved. The remedy is the datasource's file, never a rewrite of a package source or a stored row. The other categories are closed on facts: both packages publish (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** (`SqlDriver.connect()`'s accept set narrows): a connect that resolved over a SQLite file that is not a database now rejects. It ships as `patch`: no public surface changes, and during the launch window breaking-ness is carried by this banner and the disposition above, not by the level.

- **Before:** `connect()` resolved; in production the first query failed with `DATABASE_ERROR`, and on a development boot the file was renamed to `<file>.corrupt-<timestamp>` and an empty database was written in its place.
- **Now:** `connect()` rejects with `SqliteDatabaseFileError`, `code: 'SQLITE_NOTADB'`, naming the file; the file is untouched.
- **Fix:** point the datasource at a SQLite database file, or move the file aside yourself (an absent file is created empty on the next connect).
