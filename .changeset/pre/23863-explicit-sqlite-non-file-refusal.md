---
'@objectstack/runtime': patch
---

fix(runtime): an explicit `sqlite` or `sqlite-wasm` driver selection refuses a database URL that is not a file path, instead of opening a SQLite file at a path made of the URL

Clause-②: no

An explicit selection (`OS_DATABASE_DRIVER`, `--database-driver`, or the `databaseDriver` option) skips the URL classification, so the only check its URL meets is the SQLite file-name rule, `sqliteFilenameFromUrl`. Both hosts call that rule: the runtime's standalone host (`os dev`, `os start` and `os serve` over a plain config or an artifact, every `os migrate` subcommand, every embedder of `createStandaloneStack`) and the CLI's legacy `os serve` path, which re-raises its refusal as the fatal `UnsupportedDriverError`.

- **Before, an opaque scheme (two or more characters and a `:` with no `//`).** `OS_DATABASE_DRIVER=sqlite OS_DATABASE_URL=jdbc:postgresql://127.0.0.1:5999/db os serve --dev` printed `✓ Server is ready` and created the directories `./jdbc:postgresql:/127.0.0.1:5999/`. `redis:h` opened a file named `redis:h`. This happened under both kinds.
- **Before, a server URL under `sqlite-wasm`.** The WASM kind refused nothing: `OS_DATABASE_DRIVER=sqlite-wasm` beside `OS_DATABASE_URL=postgres://USER:PASSWORD@127.0.0.1:5999/db` booted ready and created `./postgres:/USER:PASSWORD@127.0.0.1:5999/`, which put the credentials in a directory name. `redis://h/x.db` opened a file too.
- **After.** Under either kind, all of these get the refusal the `sqlite` kind already gave a `postgres://` URL. The kind is named in the sentence: `[StandaloneStack] sqlite-wasm driver was selected but the URL does not look like a file path (its scheme is "postgres://"). Use file:/path/to/db.sqlite, or set OS_DATABASE_DRIVER explicitly.` The message names the scheme only, never the URL, so credentials in the URL are not printed. The boot stops before it creates anything on disk.
- **One file name changes answer.** Under an explicit selection a first path segment that holds a colon now reads as a scheme, as it already does when the URL selects the driver: `backup:2026.db` was a SQLite file and is now refused as the scheme `backup:`. Write `./backup:2026.db` or `file:backup:2026.db` for that file. A one-letter drive is a path, not a scheme (`C:\data\app.db`, `C:/data/app.db`).
- **A `sqlite:` alias on a rung that does not normalize it.** `sqlite:` and `sqlite://` are aliases of `file:` in `OS_DATABASE_URL`, `--database` and the `databaseUrl` option. A declared default datasource's `url` and `TURSO_DATABASE_URL` reach the rule as written. There, under an explicit selection, `sqlite:./x.db` is now refused as the scheme `sqlite:`, where it used to open a file named `sqlite:./x.db`. `sqlite:///…` was already refused there under `sqlite` and is now refused under `sqlite-wasm` as well.

`file:./x.db`, `./x.db`, `:memory:`, `wasm-sqlite:///path` (under `sqlite-wasm`), `sqlite:./x.db` in `OS_DATABASE_URL`, and paths with no scheme resolve to the same file as before. An empty name under `sqlite-wasm` is still `:memory:`.
