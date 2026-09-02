---
'@objectstack/service-analytics': patch
---

Guard the analytics record-label lookup with `assertReadScopeCannotVacate` — the fourth read-scope door

`AnalyticsServicePlugin`'s `fetchRecordLabels` hook `$and`s the **referenced** object's read scope with an `id $in [...]` filter and hands the result straight to `executeAggregate`. Unlike the three faces unified previously (the ObjectQL engine merge, the `/analytics/sql` echo merge, and `NativeSQLStrategy.applyReadScope`), it met neither `compileScopedFilterToSql` nor the vacancy guard, so a read scope that lowers to a boolean constant — the `$not`-over-`$in: []` family reachable from any out-of-repo `StrategyContext.getReadScope` producer — let that per-record read run effectively unscoped for the ids in hand, surfacing the display names the referenced object's RLS exists to hide.

The hook now calls the already-exported `assertReadScopeCannotVacate` on the referenced object's scope before composing the filter, refusing in the same envelope as its siblings (`READ_SCOPE_COMPILE_FAILED` / 500). No behaviour changes for scopes that bind: an ordinary referenced-object scope still narrows the label lookup, and the `$in: []` zero-rows reduction (including the live RLS composite that pairs it with an own-rows grant) still passes through untouched. The read-scope SQL compiler is unchanged.
