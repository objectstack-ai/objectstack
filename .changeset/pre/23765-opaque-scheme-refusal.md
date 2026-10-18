---
'@objectstack/runtime': patch
---

fix(runtime): the standalone host refuses an `OS_DATABASE_URL` with an opaque scheme (`jdbc:postgresql://…`, `redis:h`), and a `.wasm.db` ending no longer turns an unrecognised scheme into a SQLite file

Clause-②: no

This is the runtime's standalone host: `os dev`, `os start` and `os serve` over a plain config or an artifact, every `os migrate` subcommand, and every embedder of `createStandaloneStack`.

- **Before, an opaque scheme (two or more characters and a `:` with no `//`).** `OS_DATABASE_URL=jdbc:postgresql://127.0.0.1:5999/db os serve --dev` printed `✓ Server is ready` and opened a SQLite file at a path made of the URL, creating the directories `./jdbc:postgresql:/127.0.0.1:5999/`. An operator who believed they were on Postgres wrote to that local file. This broke the host's own rule that an unknown URL scheme is refused and never falls back to SQLite.
- **Before, a `.wasm.db` ending.** It was tested ahead of every scheme check, so `OS_DATABASE_URL=redis://h/x.wasm.db` booted on a WASM SQLite file written under `./redis:/h/`.
- **After.** Both shapes get the refusal an unrecognised `<scheme>://` already got, unchanged: `[StandaloneStack] Unsupported database URL scheme "jdbc:". Supported schemes: …`. The boot stops before any plugin starts and creates nothing on disk. The message names only the scheme, never the URL, so credentials in the URL are not printed. A `*.wasm.db` name still selects the WASM engine for a `file:` URL or a path with no scheme. The CLI's legacy `os serve` path already refuses these values, so the two hosts now give the same answer.
- **A one-letter drive is a path, not a scheme** (`C:\data\app.db`, `C:/data/app.db`). A file name whose first segment contains a colon now reads as a scheme, as it does on the CLI path: `backup:2026.db` was a SQLite file and is now refused. Write `./backup:2026.db` or `file:backup:2026.db` for that file.

`postgres://`, `pg://`, `mysql://`, `mongodb://`, `libsql://`, `wasm-sqlite://`, `file:`, `sqlite:`, `:memory:` and paths with no scheme resolve as before. An explicit `OS_DATABASE_DRIVER` still wins over the URL, which is then not classified.
