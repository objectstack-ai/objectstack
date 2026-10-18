---
'@objectstack/runtime': minor
'@objectstack/cli': patch
---

fix(runtime,cli): an upper-case `FILE:` database URL opens the file its lower-case spelling opens, `file://NAME` opens `NAME` on both hosts, and the URL-to-filename rule is exported as `sqliteFilenameFromUrl`

Clause-②: yes (widening)

- **`FILE:` is stripped case-insensitively.** The standalone host classified `FILE:./app.db` as SQLite case-insensitively but stripped the prefix case-sensitively, so the prefix stayed in the file name: `OS_DATABASE_URL=FILE:./app.db` created a directory literally named `FILE:.` and put the database inside it, and `File:///tmp/app.db` was refused as an unsupported `File://` scheme. Both now open the file the lower-case spelling opens (`./app.db`, `/tmp/app.db`), as the `sqlite-wasm` path already did. Lower-case `file:` URLs and bare paths are unchanged.
- **New export: `sqliteFilenameFromUrl(url, kind)`** from `@objectstack/runtime`, `kind` being `'sqlite'` or `'sqlite-wasm'`. It is the one rule that turns a SQLite database URL (after `normalizeDatabaseUrl`) into a file name: `file:` / `file://` stripped case-insensitively, plus `wasm-sqlite:` for the WASM kind. For `'sqlite'` it throws a plain `Error` on a URL that is not a file path, naming the URL's scheme and never the URL. Nothing is removed.
- **`os serve`'s legacy storage path (`OS_MODE=off`, `bootMode: 'off'`, or a host config) turns a SQLite URL into a file by that same rule**, so both hosts open one file per URL. It used to strip only a lower-case `file:`: `OS_DATABASE_URL=file://NAME` opened `//NAME` at the filesystem root, where the standalone host opens `./NAME`, and `FILE:./app.db` made a `FILE:.` directory there too. `file:///abs/app.db` opens `/abs/app.db`; `sqlite:` / `sqlite://` URLs are unchanged.
- **What that rule refuses, the legacy path now refuses too, and fatally**, with the standalone host's own sentence (it names the URL's scheme, never the URL): an explicit `OS_DATABASE_DRIVER=sqlite` over a server URL such as `postgres://user:password@host/db`, which used to create directories named after the URL, credentials included, and a `file:` URL that names no file, which used to declare a database with an empty file name. Fix: point `OS_DATABASE_URL` at a file (`file:./app.db`), or select the driver the URL is for. The undocumented `sql://` prefix that path also stripped under an explicit `sqlite` selection is refused the same way; write `file:` instead. A blank `OS_DATABASE_URL` under an explicit `sqlite` selection is read as absent (`:memory:`), as an absent one always was.
