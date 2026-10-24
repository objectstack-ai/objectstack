---
'@objectstack/cli': minor
---

fix(cli): `os migrate apply` on an empty database writes the organization-ownership birth marker, so the fresh install's first `os serve` starts

Clause-②: yes

`os serve` (and so `os dev` and `os start`) serves a database this release created itself, recognised by the birth marker in `sys_migration` (row `adr-0131-organization-ownership`), or one the ownership ceremony certified. `os migrate apply` holds its schema DDL back until the operator confirms, so its boot saw no table created and wrote no marker, and the tables it then created carried none. A deploy script that ran `os migrate apply` before the first `os serve` was refused as a database "17.x or an 18.0 pre-release created", and sent through the upgrade ceremony.

- **Now.** When `os migrate apply` creates the database from empty, it writes the birth marker right after it creates the tables, and the first `os serve` starts. The log line is the one a serving boot prints: `[organization-ownership] a datastore created from empty: birth marker written (shape generation 1, …)`.
- **Never on a database that was not empty.** The decision is the serving boot's own: the database counts as created from empty only when none of the tables this release declares existed before the apply. A database an earlier release created gains no marker from `os migrate apply`, even when the apply creates a table in it, and is still refused until the ceremony runs: `os migrate organization-ownership --out PLAN`, then `--apply --plan-file PLAN --backup-taken`.
- **A failed write fails the command.** If the tables are created and the marker cannot be written, `os migrate apply` exits `1` and names the ceremony, which certifies such a database.
- **Unchanged.** A database that already carries a marker keeps it as it is. `os migrate plan` writes nothing. On a Turso remote (`libsql://`) primary, `os migrate apply` creates no tables (its schema sync is skipped there), so the first serving boot creates them and writes the marker, as before.
