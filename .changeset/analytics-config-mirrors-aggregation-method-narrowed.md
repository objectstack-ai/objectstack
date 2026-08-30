---
"@objectstack/service-analytics": patch
---

fix(service-analytics): the consumer-local `executeAggregate` config mirrors narrow `aggregations[].method` to `AggregationFunction` (#12940)

#12776 narrowed the contract — `StrategyContext.executeAggregate`'s
`aggregations[].method` went from `string` to the six-value
`AggregationFunction` — but this package's two CONSUMER-LOCAL config mirrors
of that same slot kept declaring `string`, so the compile-time vocabulary the
narrowing bought for strategy authors stopped at the package boundary and
never reached the people who write a custom bridge.

FROM → TO, at all three sites the tree carries (the card enumerated two):

- `AnalyticsServicePluginOptions.executeAggregate` (`plugin.ts`) —
  `aggregations[].method: string` → `AggregationFunction`. This is the
  declaration an app author's own `executeAggregate` bridge is typed against.
- `AnalyticsServiceConfig.executeAggregate` (`analytics-service.ts`) — the
  same narrowing on the config twin whose own comment says it is kept in
  lockstep with `StrategyContext.executeAggregate`; that claim is true again,
  and now names the member so the next drift is visible.
- `parseEngineAggregateFunction`'s `method` parameter (`plugin.ts`), the
  auto-bridge's runtime parse — narrowed for the same reason: it was the
  third place a reader was told this vocabulary is open.

Who breaks at compile time on upgrade: CALLERS that fill `method` with a
value typed `string` (or a literal outside the six) when invoking one of
these bridges — the values the bridge already refused at runtime (#11833).
IMPLEMENTORS are source-compatible: a handler that accepts `method: string`
accepts a superset and stays assignable to the narrowed member (parameter
contravariance), which is why the ~nine test doubles in this package that
declare their own `{ field, method: string, alias }` mirrors still compile
untouched.

No runtime change. The auto-bridge's runtime parse-and-refuse (#11833) stays
exactly where it was — with both ends of the `method` → `function` rename now
declaring the same enum, it is defence in depth behind a compile-time check
rather than the only check, and the two comments that explained it by
pointing at the old `method: string` declaration say so instead.
