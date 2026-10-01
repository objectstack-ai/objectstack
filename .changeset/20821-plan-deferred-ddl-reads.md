---
'@objectstack/driver-sql': patch
---

fix(driver-sql): `os migrate plan` on a database that does not exist yet no longer prints `DATABASE_ERROR` for the tables whose DDL it deferred (#20821)

`os migrate plan` (and the boot of `os migrate apply`) runs with the SQL driver's DDL deferred: the driver records every table as pending `create_table` and creates none of them. The same boot then reads `sys_metadata`, `sys_metadata_activation` and `sys_migration`. On a new database those tables do not exist yet, so each read was refused, and each refusal printed a line like this on the driver's warn channel (stderr by default):

```text
[sql-driver] DATABASE_ERROR — the backend refused a read on 'sys_metadata' (SQLITE_ERROR) ... no such table: sys_metadata
```

Nothing was wrong: every reader already answers from the refusal, and the plan lists the same tables as pending creates. A dry run on a new database printed six of these lines.

The driver now sends such a refusal to the logger's `debug` channel instead of `warn`, when all three hold:

- this driver has DDL deferred;
- the refused statement targets a table whose DDL this driver deferred;
- the shared `isMissingTableError` predicate from `@objectstack/types` recognises the refusal as that table being missing.

The default logger has no `debug`, so the line is not printed. The refusal is still thrown to the caller with the same envelope (`DATABASE_ERROR`, status 500), and the plan's output is unchanged.

What still warns:

- every other refusal on a deferred driver, such as a malformed statement on a table that exists;
- a missing table that the driver did not defer, such as a table nothing in the boot declares;
- every refusal once the deferred DDL has been applied, or on a driver that never deferred any.

There is nothing to migrate.
