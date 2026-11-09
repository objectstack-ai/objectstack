---
'@objectstack/core': patch
'@objectstack/driver-sql': patch
'@objectstack/service-analytics': patch
---

fix(service-analytics): the `/analytics/sql` echo for a federated SQL Server object prints SQL Server's own row window, and the JSON membership and `$empty` refusals name the `mssql` dialect

Clause-②: no
Metadata-protocol: none

A dashboard over a federated SQL Server object runs the engine aggregate, so its rows were already paged by driver-sql. The SQL this package prints for the same query (`/analytics/sql`, and the statement attached to a query answer) spelled the window `LIMIT n OFFSET m`, which SQL Server does not parse. It now prints the window driver-sql's find path runs: `TOP (n)` for a limit alone, and `OFFSET m ROWS FETCH NEXT n ROWS ONLY` after an `ORDER BY`, ordered by `(SELECT NULL)` when the query states no order. `limit: 0` prints `TOP (0)`.

The rules for that window (an `OFFSET` needs an `ORDER BY`; `FETCH NEXT 0 ROWS` is an error, so `limit: 0` is `TOP (0)`) moved out of driver-sql's find path into `@objectstack/core` as `mssqlWindow` / `mssqlWindowSql`, which driver-sql and the analytics echo both use. driver-sql's statements are byte-identical.

A `$contains` / `$notContains` on a JSON-stored field, or `$empty` on a multi-value field, on SQL Server is still refused (no JSON construct is stated for that dialect). The refusal now names the dialect, `"mssql"`, where it used to say the dialect is not known. The refusal for a dialect the host cannot name keeps its words. SQLite, PostgreSQL and MySQL statements are unchanged.
