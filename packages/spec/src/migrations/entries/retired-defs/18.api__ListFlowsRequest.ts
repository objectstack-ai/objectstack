// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #19543 (door ④) — `api/ListFlowsRequest`, the query of the retired
// `GET /api/v1/automation` flow list (maintainer ruling on #19543:
// 「退役，统一走 /meta/flow」). It declared `status` / `type` / `limit`
// (default 50) / `cursor`, and the route read none of them: it called
// `listFlows()` with no arguments. Retired whole with the route and its
// `AutomationApiContracts.listFlows` entry; flows are metadata (ADR-0106) and
// the list is `GET /api/v1/meta/flow`. Zero readers measured before removal in
// objectstack, objectui (pinned sha and main) and cloud. No carrier key and no
// authored document, so no tombstone and no D2 conversion — this table plus
// the D3 semantic entry `automation-flow-list-route-retired` ARE the
// declaration (the #8715 route-3 shape).
export const entry = 'api/ListFlowsRequest';
