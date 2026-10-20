---
'@objectstack/driver-sql': patch
---

fix(driver-sql): a read-only boot refuses a SQLite datasource whose file can be neither opened nor created, instead of opening an empty in-memory database over it and reporting it connected

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object definition or stored shape is added, removed, renamed or re-shaped, and no exported declaration is removed or narrowed, so there is nothing for `objectstack migrate meta` to rewrite. What changes is the answer `resolveSqliteAbsentFileTarget` gives under `sqliteAbsentFile: 'empty-in-memory'` for a SQLite path that cannot exist: it throws the driver's `SqliteDatabaseFileError` where it answered `:memory:`. The remedy is the datasource's `filename`, never a rewrite of a package source or a stored row. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

`sqliteAbsentFile: 'empty-in-memory'` is the open mode a read-only boot uses (`os migrate plan`, and the dry runs that boot read-only): an absent SQLite file is opened as an empty in-memory database, so nothing is created on disk. Its judgement of "absent" was `existsSync(path) === false`, which is also the answer for a path that cannot exist: a path under a regular file (`ENOTDIR`), a directory the process may not search (`EACCES`). So `os migrate plan` printed `datasource '<name>': connected` for a declared datasource on such a path and planned `create_table` into it, while the boot that writes refused the same path.

**BREAKING** (the read-only boot's accept set narrows), shipped as `patch`: no exported declaration changes.

- **FROM:** under `'empty-in-memory'`, a SQLite path that can be neither opened nor created read as absent. The driver opened `:memory:`, and the datasource's connect succeeded.
- **TO:** `resolveSqliteAbsentFileTarget`, and so the `SqlDriver` constructor, throws `SqliteDatabaseFileError` naming the file and the operating system's answer: `ENOTDIR` (a path under a regular file), `EACCES` (a directory the process may not write or search), `EROFS` (a read-only mount), or `ENOENT` (a directory whose name a dangling symbolic link holds). The datasource's connect fails with it, as the boot that writes already failed, so `os migrate plan` reports the datasource failed instead of planning into it. The judgement still writes nothing: no directory and no file is created to find out.
- **Unchanged:** an absent file in a directory that exists, or that could be made, still opens as an empty in-memory database and leaves the disk untouched. An existing file opens as before. The default mode (`'create'`) is untouched, and so is every server dialect: the option is now applied to SQLite clients only, as documented (a `pg` driver given it with a connection string used to have that string rewritten to `:memory:`).
- **Fix:** if a read-only boot now refuses a SQLite datasource, correct its `filename`: the refusal names the path and the reason.
