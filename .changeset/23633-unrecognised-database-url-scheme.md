---
'@objectstack/cli': patch
---

fix(cli): `os serve` refuses an `OS_DATABASE_URL` whose scheme no driver recognises, and reads `pg://` and a scheme-less path as the runtime host does

Clause-②: no

This is the `os serve` path a host config takes (one whose `plugins` hold plugin instances), and the one `OS_MODE=off|none|legacy` takes. `os dev` and `os start` reach it through their `serve` child.

- **Before, an unrecognised scheme (`OS_DATABASE_URL=redis://127.0.0.1:6399/0`).** `os serve --dev` and `os dev` printed `✓ Server is ready` and the banner `Driver: SqlDriver(better-sqlite3) → :memory:`. The database the operator named was dropped without a word, and every write was lost at restart. In production (`os serve`, `os start`) the boot met the no-storage refusal, which tells the operator to set `OS_DATABASE_URL` even though they had set it.
- **After.** Both postures exit 1 before any plugin starts with `✗ Unsupported database URL scheme "redis://" (OS_DATABASE_URL / --database). Supported: …`. The message lists the recognised spellings and names only the scheme, never the URL, so credentials in the URL are not printed. The standalone runtime host (`os dev` / `os start` over a plain config, `os migrate`) already refused these schemes, so the two hosts now agree. A `.db` ending no longer rescues an unrecognised scheme: `redis://h/app.db` used to be handed to SQLite as a file path, and it is now refused too.
- **`pg://…` and a path with no scheme (`./data/app`, `/var/lib/objectstack/app`).** The runtime host already reads these as postgres and as a SQLite file. Before, this path booted `--dev` on `:memory:` for them and production met the no-storage refusal. Now `pg://` is a postgres datasource and a scheme-less path is that SQLite file, in dev and production.

`postgres://`, `postgresql://`, `mysql://`, `mongodb://`, `libsql://`, `wasm-sqlite://`, `file:`, `sqlite:`, `:memory:` and `*.db` paths resolve as before. An unset or blank `OS_DATABASE_URL` keeps the dev SQLite default. An explicit `OS_DATABASE_DRIVER` still wins over the URL, which is then not classified.
