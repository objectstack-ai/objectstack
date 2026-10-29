---
'@objectstack/service-datasource': patch
---

fix(service-datasource): testing a datasource draft no longer creates its SQLite database file

Clause-②: no
Metadata-protocol: none

"Test connection" on a datasource draft (`POST /api/v1/datasources/test`) saves nothing, yet for a file-backed SQLite draft it opened the database the way a server boot does, so the file, and every missing directory above it, was created on disk although no datasource was saved. A mistyped path left a stray database wherever the server process could write. Measured on every file-backed driver the default factory builds: `sqlite` / `sqlite3`, `sqlite-wasm`, and `turso` / `libsql` with a `file:` url.

- **What the probe answers now.** A draft whose database file does not exist is refused: the probe answers `ok: false` with an error that names the file and says it does not exist. Nothing is created: neither the file nor its directory.
- **What still works.** A draft naming an existing database file, or `:memory:`, probes as before. Saving a datasource still creates its file on connect, as do the boot restore and every hot pool: only the probe asks for an existing file.
- **Whichever factory builds.** The check is the probe's own and runs before the driver factory is asked for anything, so it holds for a host-registered factory too. Nothing a host or an author can write changes: no exported type or function signature moves.
