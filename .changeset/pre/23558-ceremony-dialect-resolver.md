---
'@objectstack/cli': patch
'@objectstack/metadata-core': minor
---

fix(cli): `os migrate organization-ownership` reads its SQL dialect once, through the driver resolver it shares with metadata-core, and refuses an unresolved dialect before any statement, naming the driver, with no SQLite default left

Clause-②: yes (widening)

**Who this is for.** An operator who runs the organization-ownership ceremony (plan or `--apply`) on a PostgreSQL or MySQL database whose driver's knex `config.client` is a client CLASS (knex's bring-your-own-dialect hatch) or a client string the ceremony does not recognise.

**FROM.** Both arms took the dialect from `String(config.client)` alone, with a reader of their own.

- Such a run was refused (`driver-unsupported`, exit 1) by the plan step, which runs first. A client class was stringified, so the refusal printed the class's source text in place of the driver's name.
- The apply step and its template lookup each carried a `'sqlite'` default for an unresolved dialect. Neither was reachable, only because the plan step had already refused.

**TO.** The dialect is resolved once, from the stack's driver, before either arm runs a statement. The resolver is the one metadata-core's legacy-row reader uses: the driver's `dialectName` first, then a recognised `config.client` string.

- Refused: a client class with no recognised `dialectName`, an unrecognised client string, `dialectName: 'unknown'` (what `SqlDriver` answers for either), and a driver with no dialect at all. Each gets `driver-unsupported`, exit 1, with no statement run and no plan file written. The refusal names the driver: its name, its `dialectName`, and its client string or client class name.
- No `'sqlite'` default remains. The plan and the apply take the resolved dialect and never re-derive it.
- The plan file's `client` field records the client only when it is a string.

Measured on each in-repo SQL driver: `SqlDriver` on better-sqlite3, pg and mysql2, and `TursoDriver`, resolve to the dialect they did before.

**metadata-core.** `dialectOfDriver(driver)` is exported. It is the one resolver behind `readLegacyOrganizationRows`, and answers:

- `'sqlite' | 'postgres' | 'mysql'`;
- `'none'` for a driver that is not a SQL driver;
- `'unresolved'` otherwise.

A `dialectName` string is the whole answer, recognised or not. A `config.client` is read only when there is no `dialectName`, and only as a string.
