---
'@objectstack/service-analytics': patch
---

fix(service-analytics): the ObjectQL strategy serves two dataset dimensions over one column

Clause-②: yes (widening)
Metadata-protocol: none

A dataset that exposes one column under two dimension names (`region`, and `zone` declared over `region`) and is queried with both is now served by the ObjectQL strategy with one group per value, keyed by both names, as the native strategy and the draft preview answer it. This holds on the strategy's direct path, beside a bucketed time dimension, and beside a cross-object dimension such as `account.name`. Before, the strategy handed the engine a `groupBy` naming the column twice and answered `INVALID_QUERY` / 400, measured on real SQLite.

The strategy now names each group key once: the same column, or the same column bucketed at the same granularity. The engine's duplicate-column refusal is unchanged, and it still answers a selection that asks for two values under one name, such as a column raw beside its own month bucket. Nothing is refused that was served, and no export, key, error code or status is added.
