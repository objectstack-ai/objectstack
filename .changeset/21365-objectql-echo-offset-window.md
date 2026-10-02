---
"@objectstack/service-analytics": patch
---

fix(service-analytics): the ObjectQL strategy's echoed `sql` renders an offset with no limit in the dialect's own spelling, so SQLite runs the statement it prints

Clause-②: no

**Before**, the ObjectQL strategy wrote its own row window into the statement it echoes: `LIMIT n` when a limit was set, then `OFFSET n` when an offset was. An `offset` with no `limit` therefore echoed a bare `OFFSET`, which SQLite's grammar does not have. Measured through `POST /api/v1/analytics/query` and `POST /api/v1/analytics/sql` on SQLite, for a composition served by the engine aggregate, with `order: { note: 'asc' }` and `offset: 1`: the rows were right (every group after the first), but the echoed `sql` and the `/analytics/sql` body both ended `ORDER BY "note" ASC OFFSET 1`, and SQLite refuses that statement with `near "OFFSET": syntax error`.

**Now** the statement ends with the same window clause the native-SQL strategy runs, for the dialect of the driver that serves the object: `LIMIT -1 OFFSET 1` on SQLite, which runs and answers the same rows. One function renders the window for both strategies.

**Unchanged.** The rows either strategy answers. A window with a `limit` keeps its bytes (`LIMIT 2 OFFSET 1`) on every dialect, and on PostgreSQL an offset with no limit still echoes `OFFSET 1` alone. A host that wires no `sqlDialect` hook gets the native strategy's dialect-neutral spelling, `LIMIT 9223372036854775807 OFFSET 1`. A date-bucketed dimension still echoes as `date_trunc(…)`, which SQLite does not run; this change touches only the window.
