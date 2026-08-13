---
"@objectstack/mcp": patch
---

`McpDataBridge.aggregate` now declares its `groupBy` / `aggregations` inputs as the engine's own `EngineAggregateOptions` slices instead of a hand-mirrored copy (#8032). The mirror had drifted in three places: `function: string` against the engine's six-name enum, `dateGranularity?: string` against the `day`/`week`/`month`/`quarter`/`year` vocabulary, and a `distinct?: boolean` the engine retired in `@objectstack/spec` 17 (#6815) — a caller passing `distinct: true` had it silently dropped, and now gets the retirement rejection at compile time instead. Delete the key; a deduplicated count is the `count_distinct` aggregation function. Runtime acceptance is unchanged on every path: the `aggregate_records` tool's zod schema already enforced exactly these shapes at the ingress, and the stdio bridge's engine call no longer needs its two casts.
