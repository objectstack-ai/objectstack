---
"@objectstack/service-analytics": patch
---

refactor(service-analytics): derive the analytics auto-bridge's engine view from the declared contracts (#11833)

`plugin.ts` named the data engine through a consumer-local structural
`DataEngineLike` — the second of the two sites #11833 records, after the
datasource half that landed as PR #12011. It is now derived from the declared
contracts: `IDataEngine.aggregate` / `execute?` /
`resolveEffectiveDatasource?` / `getDriverForObject?` and
`IObjectQLEngine.getObject`. Optionality is preserved exactly — `aggregate`
required, everything else `Partial<>` — because these probes are the plugin's
graceful-degradation seam.

**Why this is `patch` and not a type-only no-op.** Four of the five members
substitute with no behaviour change. The fifth does not: the deleted structural
type declared `aggregations[].function` as `string`, while the contract
declares the six-value `AggregationFunction`. The bridge therefore forwarded
whatever method string reached it. That forward is now parsed with the spec's
own enum, so a method the engine contract does not declare is refused at the
bridge — loudly, naming the aggregation and the legal vocabulary — instead of
reaching the engine, where `driver-sql` blamed a `function` key the author
never wrote and the in-memory evaluator answered `null` for every bucket under
the author's own measure name.

No authored analytics can trigger the new refusal: the one reachable producer
of a non-aggregate method — a custom-SQL measure (`AggregationMetricType`
`number` / `string` / `boolean`) — is already refused earlier, caller-facing,
by `ObjectQLStrategy.resolveMeasureAggregation` (#12209). What is left is host
drift (a cube object registered without meeting `CubeSchema`), which is why
the new refusal is a bare `Error` in the undeclared-500 tier rather than an
ADR-0112 400 that would blame the caller for something they did not write.
