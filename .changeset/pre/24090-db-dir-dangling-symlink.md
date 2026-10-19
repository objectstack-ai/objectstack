---
'@objectstack/cli': patch
'@objectstack/runtime': patch
---

fix(cli,runtime): a dangling symlink standing as the SQLite database's directory is refused at once by `os dev` and `os serve`, naming the database file and the directory, instead of failing the boot later in a plugin's start

Clause-②: no

**What was wrong.** `os dev` (for its default database under `OS_HOME/data`) and the standalone host behind `os serve` and `os start` (for a `file:` or `wasm-sqlite://` database URL) make the database file's directory before the driver opens it. Both accepted any `EEXIST` answer while making a missing level. A symbolic link that points nowhere answers `EEXIST` to `mkdir`, so it was taken for a directory, and the boot went on until the driver could not open the file. `os dev` then exited 1 with `Plugin com.objectstack.auth failed to start - rollback complete: The database refused to run this query for object 'sys_organization'`, and `os serve` with `Plugin package-service failed to start - rollback complete: The database refused to run a raw statement`. Neither message named the file, the directory or the link.

**What an operator sees now.** Both make the directory with the same bounded walk as the other `OS_HOME` paths, which accepts `EEXIST` only when a directory stands there. A dangling link as the directory is refused before the boot starts: `os dev` prints `The default database '…/data/objectstack.db' cannot be created: its directory '…/data' could not be made: EEXIST: …` and exits 1, and `os serve` prints `[StandaloneStack] SQLite database file '…' cannot be created: its directory '…' could not be made: EEXIST: …` and exits 1. Remove the link, or point it at a directory that exists. A dangling link higher up the path was already refused at once, with `ENOENT` at the level below the link; it is now refused with `EEXIST` at the link itself.

Nothing else changes. A directory that can be made is still made, every missing level of it; a directory that exists, or a symbolic link to one, is used as it stands; and a path the operating system refuses for any other reason (`ENOENT`, `ENOTDIR`, a regular file holding the directory's name) is refused with the same code and text as before.
