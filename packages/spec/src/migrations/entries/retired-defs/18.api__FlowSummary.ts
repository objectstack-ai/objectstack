// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #19543 (door ④) — `api/FlowSummary` left with its only reader,
// `api/ListFlowsResponse` (above). No producer ever built one: the retired
// list route answered bare names, so the summary's `label` / `type` /
// `status` / `version` / `enabled` / `nodeCount` / `lastRunAt` were a shape
// with no emitter, and an exported schema with no consumer reads as a
// capability (#3950, the `ui/ThemeMode` rule). Measured before removal: zero
// readers in objectstack, objectui (pinned sha and main) or cloud. A flow's
// runtime enablement is served by `GET /api/v1/automation/_status`; its
// definition by `GET /api/v1/meta/flow`.
export const entry = 'api/FlowSummary';
