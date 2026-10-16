---
'@objectstack/runtime': minor
---

fix(runtime): an upper-case `FILE:` database URL opens the file its lower-case spelling opens, and the URL-to-filename rule is exported as `sqliteFilenameFromUrl`

Clause-②: yes (widening)

- **`FILE:` is stripped case-insensitively.** The standalone host classified `FILE:./app.db` as SQLite case-insensitively but stripped the prefix case-sensitively, so the prefix stayed in the file name: `OS_DATABASE_URL=FILE:./app.db` created a directory literally named `FILE:.` and put the database inside it, and `File:///tmp/app.db` was refused as an unsupported `File://` scheme. Both now open the file the lower-case spelling opens (`./app.db`, `/tmp/app.db`), as the `sqlite-wasm` path already did. Lower-case `file:` URLs and bare paths are unchanged.
- **New export: `sqliteFilenameFromUrl(url, kind)`** from `@objectstack/runtime`, `kind` being `'sqlite'` or `'sqlite-wasm'`. It is the one rule that turns a SQLite database URL (after `normalizeDatabaseUrl`) into a file name: `file:` / `file://` stripped case-insensitively, plus `wasm-sqlite:` for the WASM kind. For `'sqlite'` it throws a plain `Error` on a URL that is not a file path, naming the URL's scheme and never the URL. Nothing is removed.
