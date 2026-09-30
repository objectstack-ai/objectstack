---
'@objectstack/driver-sql': patch
---

fix(driver-sql): the first boot of a new database no longer prints a `DATABASE_ERROR` for `sys_migration` (#20768)

On the first boot of a new database, the SQL driver printed this line once, on its warn channel (stderr by default):

```text
[sql-driver] DATABASE_ERROR — the backend refused a read on 'sys_migration' (SQLITE_ERROR) ... no such table: sys_migration
```

Nothing was wrong. At the start of its first schema sync, before it creates any table, the driver asks whether this deployment's file columns have moved (the ADR-0104 media-arm resolver). The resolver the engine supplies answers by reading `sys_migration`. On a new database that table does not exist yet, so the read is refused and the answer is "not moved", which is correct for an empty store.

The driver now asks that question inside an async scope. Inside it, a read refused because its own target table does not exist goes to the logger's `debug` channel instead of `warn`. The default logger has no `debug`, so the line is not printed. The logger shape gains an optional `debug`. The refusal is still thrown to the resolver, and the resolver's answer is the same as before.

What still warns:

- every other refusal inside that scope, such as a malformed statement on a table that exists, or a missing table named by another relation (a view over a dropped table);
- a missing table read anywhere else, as before.

The missing-table check is the shared `isMissingTableError` from `@objectstack/types`, which `@objectstack/metadata/errors` re-exports. There is nothing to migrate.
