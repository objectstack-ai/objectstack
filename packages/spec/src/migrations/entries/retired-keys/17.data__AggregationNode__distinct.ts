// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #6815 — the per-aggregation DISTINCT flag, retired under ADR-0049 by
// maintainer ruling 2026-08-09. ONE key, and one entry, because
// `AggregationNodeSchema` is reused BY REFERENCE rather than `.extend()`ed:
// `QuerySchema.aggregations` and `EngineAggregateOptionsSchema.
// aggregations` are both `z.array(AggregationNodeSchema)`, so the walked
// shape has a single `data/AggregationNode` def and the baseline marks one
// line `[RETIRED]`. Contrast the `shared/FieldMapping:transform` trio at
// the top of this list, where two `.extend()`s copied the property into
// three walked shapes and each needed its own registration.
//
// Registered here but NOT in `src/conversions/registry.ts`, for the same
// reason as the notification pair above: `QueryAST` is a REQUEST surface —
// the client SDK builder's output and the `POST /data/:object/query` body
// — never stored in stack metadata, so there is no authored source or
// `sys_metadata` row for a D2 conversion to rewrite. The prescription
// reaches consumers as the D3 semantic entry
// `aggregation-node-distinct-retired` plus this tombstone, which is the
// disposition every other `data.query.*` retirement in this major already
// takes (`query-joins-retired` / `query-cursor-retired` /
// `query-distinct-retired` / `query-window-functions-retired`, #4286).
export const entry = 'data/AggregationNode:distinct';
