---
"@objectstack/spec": minor
"@objectstack/service-analytics": minor
"@objectstack/verify": minor
---

feat(analytics): the executeAggregate bridge carries ExecutionContext — ADR-0021 D-C second belt

The analytics→engine bridge now forwards the request's `ExecutionContext` to
`engine.aggregate`, so the engine's own middleware chain scopes analytics reads
independently of the analytics layer's `getReadScope`.

**Why.** `BaseEngineOptions.context` has always been `.optional()`, so nothing
forced the bridge to pass it — and it did not. An authenticated aggregate
reached the engine with no principal, plugin-security's principal-less fall-open
skipped its RLS injection, and the only thing left scoping the query was the
strategy remembering to call `getReadScope`. #3597 was a strategy that did not,
and both belts were off at once.

`getReadScope` stays: the two resolve scope through different paths (engine
middleware vs `security.getReadFilter`), and a deployment without
plugin-security has only the analytics layer. This is depth, not a replacement.

- `StrategyContext` gains `context?: ExecutionContext`, bound per call by
  `AnalyticsService` from `query()` / `generateSql()` / `queryDataset()`.
- `StrategyContext.executeAggregate` and the `AnalyticsServicePlugin` /
  `AnalyticsService` `executeAggregate` config options gain `context?:
  ExecutionContext`. **Custom bridges should forward it** to their engine; the
  built-in auto-bridge does. Purely additive — an existing bridge that ignores
  it keeps working exactly as before.
- `DimensionLabelDeps.fetchRecordLabels` gains an optional trailing `context`,
  and `resolveDimensionLabels` an optional trailing `context`.
- `BootOptions.analytics` (`@objectstack/verify`) overrides the
  AnalyticsServicePlugin instance, so a gate can boot with the analytics belt
  off and assert the engine-side belt alone still scopes.

**Also fixed on the same seam:**

- `fetchRecordLabels` — the dimension display-label lookup — is row-granular
  (one row per record, real display names) and ran with neither read scope nor
  context. Its `ids` are confined to a scoped aggregate's output today, so it
  leaked nothing, but that was the caller's invariant, not the bridge's. It now
  ANDs the target object's read scope in and forwards the context.
- `ObjectQLStrategy.generateSql` emitted no `WHERE` at all, so the
  `/analytics/sql` preview read as an unscoped table scan while the real
  aggregate was scoped. It now renders the caller's filters and the read scope.
  The preview never executed, so this was misleading output rather than a leak.
