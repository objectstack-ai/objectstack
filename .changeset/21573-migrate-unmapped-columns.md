---
'@objectstack/cli': minor
---

feat(cli): `os migrate unmapped-columns --object NAME` reads the values of a retired field's columns, keyed by record id, for a conversion before `os migrate apply --allow-destructive` drops them (#21573)

Clause-②: yes (widening)

- **What it reads.** The columns `os migrate plan` reports as `unmapped_column` for one object's table: a column that is still in the table and that no metadata declares, typically one a retired field left behind. The column set is the plan's own findings, from the same differ on the same read-only boot, so the command never reads a column the plan does not report. Each record is emitted as `{ id, values }`. `--json` prints one document, `{ database, object, table, columns, count, records, duration }`. The text face lists the columns and each record's values.
- **Why it exists.** A read or a write through the engine now serves an object's declared fields only, and naming an undeclared column is refused. An app that moves a retired field's values into the field that replaced it reads them once with this command, writes them with its own script, and then drops the columns with `os migrate apply --allow-destructive`. That is the route the read and write narrowing in `@objectstack/objectql` names for this case.
- **Operator-only and read-only.** It runs under the database credentials you pass (`--database-url`, else `OS_DATABASE_URL`, else the project database), and it reads every organization's rows. No REST route, API flag or per-request option serves these values, and the runtime doors are unchanged. It boots the way `os migrate plan` does: no schema DDL, no seed data, and no database file created.
- **Values as stored.** An unmapped column has no declared type, so each value is emitted as the database client returns it, with no field-type decoding; a PostgreSQL `timestamp` arrives as a date and is emitted as its ISO 8601 text. A value JSON cannot carry as stored (binary bytes, a `bigint`, or a non-finite number) is refused in both faces with exit 1, naming the column and the record id, and no record is emitted: read that column with the database's own client. No column the platform creates for a field type answers with one of these, on SQLite or on PostgreSQL.
- **Answers.** An object with no unmapped column, or with no table yet: empty work, exit 0. No SQL driver: `os migrate plan`'s own `no_sql_driver` answer, exit 0. An undeclared object name: `OBJECT_NOT_FOUND`, exit 1. An object the plan does not diff (federated, or bound to another datasource): refused, exit 1. A read that cannot be complete, such as one stopped by `--max-records`: refused, exit 1, and no partial set is emitted. A value JSON cannot carry as stored: refused, exit 1, as above.
- `MigrateUnmappedColumnsCommand` is exported from `@objectstack/cli` beside the other `os migrate` commands.

Nothing that ran before changes. This is a new command.
