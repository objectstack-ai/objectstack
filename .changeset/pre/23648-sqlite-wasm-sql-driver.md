---
'@objectstack/cli': patch
---

fix(cli): `os migrate` finds the SQL driver on a SQLite database served by `SqliteWasmDriver` (`wasm-sqlite://`, `*.wasm.db`, and the dev boot's step-down from better-sqlite3), so the organization-ownership ceremony and every `os migrate` command run on it instead of answering that no SQL driver is active

Clause-②: no

**Who this is for.** An operator whose database is served by `SqliteWasmDriver`, and in particular one who must run `os migrate organization-ownership` to bring a 17.x database through 18's boot refusal (ADR-0131 D10).

**FROM.** The schema boot behind every `os migrate` command looked its SQL driver up by a list of kernel service names that did not include the one `SqliteWasmDriver` is published under (`driver.com.objectstack.driver.sqlite-wasm`). On such a database:

- `os migrate organization-ownership` refused both the plan and `--apply` with `driver-unsupported` ("no SQL driver with a raw-SQL seam is active"), exit 1, while its own text said the ceremony supports SQLite.
- `os migrate plan` answered `{"error":"no_sql_driver","changes":[]}` and `os migrate apply` answered `{"error":"no_sql_driver"}`, both exit 0, and `apply` created nothing.
- `os migrate multi-value-columns` and `os migrate unmapped-columns` answered `no_sql_driver`, and the other commands in the family named the database `unknown`.

**TO.** The lookup lists that key, so these commands find the driver and run on the database. The ceremony resolves its dialect to `sqlite` through the driver's `dialectName`. A driver without the schema-migration seam is still not found under any key, and a driver under a key the list does not name is still not found: the ceremony refuses both with `driver-unsupported`, as before.

`os migrate plan`'s unmanaged-table section on such a database reads the table catalog. It now resolves the dialect from the driver's `dialectName` first; reading `config.client` as a string only, it had reported the section unreadable for this driver, whose client is a knex client class.

An `os serve` boot pinned to an artifact by `OS_ARTIFACT_URL` uses the same lookup for its boot-time migration gate. On such a database that gate used to find no driver and let the boot go ahead with the artifact's schema changes unapplied, a destructive one included. It now runs as on every other SQL database: safe changes are applied at boot, and a destructive change refuses the boot and names the change and `os migrate apply --allow-destructive`.
