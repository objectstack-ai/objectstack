---
'@objectstack/driver-sql': patch
---

On MySQL, a table that declares a `Field.datetime` with `defaultValue: 'NOW()'` is now created (#21241).

Clause-②: no

On MySQL the driver builds a declared `Field.datetime` column as `DATETIME(3)`, but it gave the column's `NOW()` default a bare `CURRENT_TIMESTAMP`, which has precision 0. MySQL refuses a `CURRENT_TIMESTAMP` default whose precision differs from its column's (`Invalid default value for '…'`). The whole `CREATE TABLE` failed, and so did `ALTER TABLE … ADD` for a new field. The object's data endpoints then answered `500`. Two platform tables were affected: `sys_activity` and `sys_presence`. Record writes still succeeded, but none of them got an activity-timeline row.

The default now carries the column's precision. It is `CURRENT_TIMESTAMP(3)`, the expression the builtin `created_at` / `updated_at` columns already used, and both now read one precision setting. PostgreSQL and SQLite emit the same DDL as before.

One older case is fixed in the same place. A database created before datetime columns became `DATETIME(3)` holds them as `TIMESTAMP`. Schema sync widens those columns with `ALTER TABLE … MODIFY`, and that statement restated the default of `created_at` / `updated_at` but dropped the default of a declared `NOW()` field. After the widening, an insert that left the field out stored `NULL`. The widening now restates that default too, with the same expression.

Nothing to change in a project. On the next boot, schema sync creates any table that failed before. No other migration is needed: on MySQL, no table could have been created with the refused default. A column that an earlier widening already left without a default does not get one back.
