---
"@objectstack/service-analytics": patch
---

fix(service-analytics): the dataset raw-SQL bridge routes by object, so datasets over non-default datasources stop reading `0` (#5033)

`AnalyticsServicePlugin`'s `executeRawSql` auto-bridge received the object name
and threw it away: `engine.execute(knexSql, { args: params })`. `ObjectQL.execute()`
picks its driver in the order `options.object` → `getDriver(object)`, then
`options.datasource`, then the default driver — so rule 1 could never fire and
**every dataset raw-SQL read landed on the default datasource**. Any object routed
elsewhere (the ADR-0057 §3.6 telemetry split for `lifecycle.class ∈ {audit,
telemetry, event}`, an explicit `object.datasource`, a `datasourceMapping` rule)
raised `no such table`, which the widget-level graceful degradation then turned
into an empty result — a confident `0` over live rows, on a green dashboard.
Measured: `sys_audit_log` returned 49 records through the object-routed read and
`{"rows":[]}` through the dataset raw-SQL read, on the same running kernel.

The bridge now passes `{ args: params, object: objectName }`, matching the
`executeAggregate` bridge beside it (`engine.aggregate(objectName, …)`), so both
dataset execution paths give **one** answer to "which datasource is this object in".
No configuration change is needed; misrouted dashboards start reading real data.

**Behaviour change worth knowing about.** A dataset whose SQL `LEFT JOIN`s (what
`NativeSQLStrategy` emits for a dotted dimension such as `account.industry`) across
two datasources previously ran against the default datasource and silently read the
wrong database. It now runs on the base object's own datasource, where the joined
table genuinely is not — and **fails loudly** instead of degrading, because the base
table resolved fine and reporting it as "unavailable" would keep the confident `0`
alive under a new cause. The error names the actual cause and the remedy:

```
[Analytics] dataset "audit_by_actor" cannot be executed as one statement:
table "account" is not on datasource "telemetry", which is where its base object
"sys_audit_log" lives — "account" is registered on the default datasource.
A dataset JOIN cannot cross datasources. Fix it by binding both objects to the
same datasource, or by dropping the cross-datasource relationship from the
dataset's `include`/dimensions.
```

Graceful degradation is unchanged for genuine absence: a dataset whose own backing
object (or a joined object that this kernel never registered) has no table still
renders as "no data" with the existing server-side `warn`, rather than failing the
widget. `AnalyticsServiceConfig` gains one optional, diagnostics-only hook —
`getObjectDatasource(objectName)` — used solely to name the datasources in that
message; it never selects a driver.
