---
'@objectstack/mcp': patch
'@objectstack/objectql': patch
'@objectstack/driver-sql': patch
'@objectstack/driver-turso': patch
'@objectstack/runtime': patch
---

feat(mcp): `aggregate_records` orders, cuts and counts its groups in the database

Clause-②: yes (widening: `orderBy` and `limit` arguments on `aggregate_records`)
Metadata-protocol: none

A ranking question ("the top five customers by revenue") over more groups than the tool's row cap used to come back as every group, or the first page of them, in no stated order, and the client ranked what it happened to get. `aggregate_records` now takes `orderBy` — a list of `{ field, order }` naming an aggregation alias or a group key (its alias when it has one) — and `limit` (at most the row cap). The database orders the groups, cuts them, and counts how many groups it formed before the cut, in one statement; the result carries the groups, `totalGroups` (the key the tool already answers, now the database's count of the groups before the cut), and `truncated: true` when more groups existed than came back.

- An order key that names no column of the aggregated row is refused `INVALID_SORT` / 400, naming the columns the query projects.
- Only a driver that runs the cut in its own SQL statement serves it: `driver-sql` (every dialect it speaks; the window `count(*) over ()` needs MySQL 8 or later), the WASM SQLite driver, and the Turso driver's local and replica faces. Every other driver (the in-memory driver, MongoDB, OData, Turso's remote face), an aggregate the engine computes in memory (a date bucket, a reference timezone or a measure filter the driver does not run), and an aggregate with `having` are refused `INVALID_QUERY` / 400 before anything is read. Groups are never ordered or cut in the application.
- On an order key without a `rank`, a NULL ranks last in either direction, except a `sum` or a count with no value, which ranks as the `0` it is served as. Group keys the order does not name, and a group key it names only by a `rank`, break ties, ascending, NULL last, so two runs of one call answer the same groups in the same order.
- An order key may carry a `rank`, a list of the column's values: the statement ranks each listed value by its position and every other value (a NULL among them) on one rank past them, before the cut, so the unlisted values come after the listed ones ascending and before them descending; among themselves they follow the column's own ascending order, NULL last. It is the tool's own, never an `aggregate_records` argument.
- A `limit` with no `orderBy` keeps the declared option order the uncut answer already follows: groups keyed by a leading select or radio field come back in the order the field declares its options, a value no option declares last, and the database takes that order before the cut, so the cut keeps the first declared groups. An `orderBy` the caller sends overrides it.
- The cut answer carries what the uncut one does: a fixed-currency amount's currency in `currencies`, and `KEY__label` beside each lookup or master-detail group key, the record's name read with the caller's own permissions.
- An amount whose records each carry their own currency is ranked by its bare numbers across currencies: the tool description says to rank it inside one currency by filtering `where` on its currency code field.
- Without `orderBy` and `limit` the tool answers as before.

`@objectstack/objectql` exports `AGGREGATE_ORDER_CUT`, the engine-internal read option of `aggregate` that carries the request (a symbol, so no wire request can set it), with the `AggregateOrderCutRequest`, `AggregateOrderKey` and `AggregateOrderCutOutcome` types. `McpDataBridge` gains the optional member `aggregateGroups`; a bridge without it refuses `orderBy` / `limit` with `NOT_IMPLEMENTED` / 501 and keeps serving the rest of the tool. Nothing that was accepted before is refused.
