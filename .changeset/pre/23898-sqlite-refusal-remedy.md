---
'@objectstack/runtime': patch
---

fix(runtime): the SQLite "does not look like a file path" refusal names what the operator can change, instead of telling an operator who set `OS_DATABASE_DRIVER` to set it explicitly

Clause-②: no

`sqliteFilenameFromUrl` raises this refusal, and both hosts print it: the runtime's standalone host with its `[StandaloneStack]` tag, and the CLI's legacy `os serve` path, untagged, as the fatal `UnsupportedDriverError`. The first clause is unchanged and only the advice after it changes. The same URLs are refused, with the same error class and the same exit, and the message still names the URL's scheme and never the URL. Nothing that resolved before resolves differently.

- **A URL with a scheme.** This is how an explicit `sqlite` or `sqlite-wasm` selection (`OS_DATABASE_DRIVER`, `--database-driver`, or the `databaseDriver` option) meets a server URL, an opaque scheme such as `jdbc:`, or a `<scheme>://` nothing recognises.
  - FROM: `… (its scheme is "jdbc:"). Use file:/path/to/db.sqlite, or set OS_DATABASE_DRIVER explicitly.` The operator who reads this has already set the driver explicitly: that selection is what led here.
  - TO: `… (its scheme is "jdbc:"). Use file:/path/to/db.sqlite to keep the sqlite driver, or use a driver that matches the URL: unset the driver selection (OS_DATABASE_DRIVER, --database-driver or the databaseDriver option) so the URL selects it, or set the selection to the URL's driver.` With the selection unset, a scheme no driver claims, such as `jdbc:`, gets the unsupported-scheme refusal, which lists the supported schemes.
- **A `file:` that names no file** (`OS_DATABASE_URL=file:`, whether the URL or an explicit `sqlite` selection chose the driver).
  - FROM: `… (it names no file after "file:"). Use file:/path/to/db.sqlite, or set OS_DATABASE_DRIVER explicitly.`
  - TO: `… (it names no file after "file:"). Name the file after "file:", as in file:/path/to/db.sqlite.` A `file:` URL is a SQLite URL whichever way the driver was chosen, so changing the driver never fixed it.
