---
"@objectstack/service-analytics": minor
---

fix(service-analytics): the analytics read scope binds a temporal comparand in the column's storage form, through the driver's own coercion pair (ADR-0053 D-A1 / D-A2) (#21505)

Clause-②: yes (widening)

`compileScopedFilterToSql` takes two new optional members in its options, `coerceTemporalFilterValue(field, value)` and `coerceTemporalFilterColumn(field, columnSql)`. Together they are the driver's `temporalFilterValue` / `temporalFilterColumnSql` pair, bound to the object the scope reads. After the shared lowering, every value comparison binds its comparand through the first and reads its column through the second: equality, `$ne`, the four orderings, `$in`, `$nin` and `$between`. Null tests, `$empty` and the text operators read the column as stored. An absent member is identity: the comparand and the column stay as written, which is what a host that passes neither got before.

`NativeSQLStrategy` (the read scope merged into the native statement) and the `ObjectQLStrategy` echo (`/analytics/sql`) pass the context's `coerceTemporalFilterValue` / `coerceTemporalFilterColumn`, which `AnalyticsServicePlugin` wires to the driver. On those faces, a read scope that compares a `datetime` column with a temporal comparand now admits the rows `engine.find` admits for the same filter, on SQLite and on PostgreSQL whatever the server's time zone. Before, the comparand was bound as written and the database read it by its own rules, so the two disagreed: on some such scopes the native face admitted fewer rows than the engine, and on others more. A `date` column answered the engine's rows before and still does.

No export is added or removed, no `@objectstack/spec` contract changes, and no dependency edge is added. A host that calls `compileScopedFilterToSql` directly gets the coercion by passing the pair from its driver.
