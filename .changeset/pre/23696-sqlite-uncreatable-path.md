---
'@objectstack/driver-sql': patch
---

fix(driver-sql): a SQLite database file the driver cannot create or open fails `connect()` at once, naming the file and the operating system's error (#23696)

Clause-②: no

A declared SQLite datasource whose `config.filename` lay under a directory the operating system will not make (for example `/proc/x/ds.db`) never finished connecting. The driver made the directory with Node's recursive `mkdir`, which loops without end on such a path: `mkdir` of the level answers `ENOENT`, its parent answers `EEXIST`, and it retries, about 1,600 failing calls a second, all system CPU. The boot was then refused only by a plugin start timeout (30 s, or 120 s when a `datasourceMapping` rule routes to the datasource), and that message named neither the datasource, the path nor the error. The same happened to the host's own database when `OS_DATABASE_URL=file:` named such a path.

**What changes**

- The directory is made by a walk bounded by the path's depth, one non-recursive `mkdir` per missing level. The first level the operating system refuses fails `connect()` with a `SqliteDatabaseFileError` that names the file, the directory and the cause (`ENOENT`, `EACCES`, `ENOTDIR`, …).
- A file SQLite itself cannot open (`SQLITE_CANTOPEN`, for example a filename that is a directory) now fails `connect()` the same way. Before, the error was logged as a warning and `connect()` resolved, so the datasource counted as connected while it could not answer one query. A native-addon load failure keeps its warning and the step-down to wasm SQLite.

The boot's existing connect refusal (ADR-0062 D5) carries this message, so `objectstack serve` on such a config now prints, at once, `datasource 'primary': connect failed — SQLite database file '/proc/x/ds.db' cannot be created: its directory '/proc/x' could not be made: ENOENT: no such file or directory, mkdir '/proc/x'`. No configuration key or accepted value changes. A path the operating system can create still connects.
