---
'@objectstack/cli': patch
'@objectstack/metadata-core': minor
---

fix(cli): `os migrate organization-ownership` reads its SQL dialect through the driver resolver it shares with metadata-core, `dialectName` first, and refuses an unresolved dialect, naming the driver, before any statement runs

Clause-②: yes (widening)

**Who this is for.** An operator who runs the organization-ownership ceremony (plan or `--apply`) on a database whose driver's knex `config.client` is not a client string the ceremony recognises: a client CLASS (knex's bring-your-own-dialect hatch, and `SqliteWasmDriver`'s own config), or an unrecognised spelling.

**FROM.** Both arms took the dialect from `String(config.client)` alone.

- A client class was stringified, so on `SqliteWasmDriver` (a `wasm-sqlite://` or `*.wasm.db` database, or the development SQLite fallback) the ceremony refused a SQLite database it can migrate, with `driver-unsupported` and the class's source text as the driver's name.
- The apply step and its template lookup carried a `'sqlite'` default for an unresolved dialect, unreachable today only because the plan, which runs first, refused before them.

**TO.** The dialect is resolved once, from the stack's driver, before either arm runs a statement. It uses the same resolver metadata-core's legacy-row reader uses: the driver's `dialectName` first, then a recognised `config.client` string.

- `SqliteWasmDriver` (`dialectName: 'sqlite'`) runs the ceremony as SQLite.
- A client class with no recognised `dialectName`, an unrecognised client string, `dialectName: 'unknown'` (what `SqlDriver` answers for either), and a driver with no dialect at all are refused: `driver-unsupported`, exit 1, no statement run, no plan file written. The refusal names the driver (its name, its `dialectName`, its client string or client class name).
- No `'sqlite'` default remains: the plan and the apply take the resolved dialect and never re-derive it.
- The plan file's `client` field records the client only when it is a string.
- `os migrate plan`'s unmanaged-table sweep reads its catalog dialect through the same resolver. On `SqliteWasmDriver` it now reads the catalog instead of reporting the sweep unreadable.

Every in-repo driver, measured, resolves as before or better: `SqlDriver` on better-sqlite3, pg and mysql2, and `TursoDriver` (remote and file), are unchanged. `SqliteWasmDriver` moves from refused to SQLite.

**metadata-core.** `dialectOfDriver(driver)` is exported. It is the one resolver behind `readLegacyOrganizationRows`: `'sqlite' | 'postgres' | 'mysql'`, `'none'` for a driver that is not a SQL driver, or `'unresolved'`. A `dialectName` string is the whole answer, recognised or not. A `config.client` is read only when there is no `dialectName`, and only as a string.
