// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #19543 (door ④) — `api/ListFlowsResponse`, the answer of the retired
// `GET /api/v1/automation` flow list. It declared `FlowSummary[]`, `total`,
// `nextCursor` and `hasMore`, while the route answered bare flow NAMES with a
// literal `hasMore: false` and never a `nextCursor` — a declaration no build
// ever served. Retired whole with the route; the list is `GET /api/v1/meta/flow`.
// See `18.api__ListFlowsRequest.ts` and the D3 semantic entry
// `automation-flow-list-route-retired` for the record.
export const entry = 'api/ListFlowsResponse';
