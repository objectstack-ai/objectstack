// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'automation-flow-list-route-retired',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a
  // code span AND a table cell.
  surface:
    'GET /api/v1/automation — the flow-list route of the automation door, together with '
    + 'its request and response schemas ListFlowsRequestSchema and ListFlowsResponseSchema '
    + '(and their ListFlowsRequest, ListFlowsRequestParsed, ListFlowsResponse and '
    + 'ListFlowsResponseParsed types), FlowSummarySchema and its FlowSummary type, the '
    + 'listFlows entry of AutomationApiContracts, and the automation.list method of '
    + '@objectstack/client. Every other automation route is unchanged, including '
    + 'POST /api/v1/automation (create a flow) at the same path',
  replacement:
    'GET /api/v1/meta/flow — flows are metadata (ADR-0106), and this is the governed read of '
    + 'them; from the SDK it is `client.meta.getItems` with the type `flow`. It answers the '
    + 'full flow definitions rather than bare names, so a caller that only needs the names '
    + 'maps each item to its `name`. The runtime enablement and trigger binding of every flow '
    + '— the one piece of engine state a definition does not carry — is '
    + '`GET /api/v1/automation/_status` (`client.automation.getRuntimeStatus`), which is '
    + 'unchanged',
  reason:
    'Maintainer ruling on #19543 (door ④, verbatim 「退役，统一走 /meta/flow」, recorded in '
    + 'that card\'s re-derivation comment of 2026-09-25), under ADR-0049 enforce-or-remove. The '
    + 'route\'s contract described a capability nobody built: ListFlowsRequestSchema declared '
    + '`status`, `type`, `limit` (default 50) and `cursor`, and the handler read none of them — '
    + 'it asked the automation service for its flow names with no arguments at all. '
    + 'ListFlowsResponseSchema declared a page of FlowSummary rows with `total`, `nextCursor` '
    + 'and `hasMore`, and the handler answered a bare array of names beside a literal '
    + '`hasMore: false`. So a caller filtering by status received every flow, a caller paging '
    + 'with a cursor re-read the only page forever, and a caller reading FlowSummary fields read '
    + 'undefined — each with a 200 and no error. '
    + 'Measured before removal, on the main branch of this repository and cloud and on objectui at '
    + 'both its pinned commit and main: zero callers of the route or of the SDK method outside '
    + 'their own tests, while both real flow lists in the product — the Console flow-runs page '
    + 'and the Setup packaged-automation page — already read GET /api/v1/meta/flow. '
    + 'Implementing the declared contract instead would have built a second, weaker metadata list '
    + 'beside the governed one; retiring it leaves one read. '
    + 'There is no alias and no transition window: the path simply stops being mounted. There is '
    + 'no D2 conversion and no tombstone, because the shape is HTTP-only — nobody authors a '
    + 'ListFlowsRequest and nothing persists one — so the three schemas are whole-def removals in '
    + 'RETIRED_DEFS_BY_MAJOR and this entry carries the record. ADR-0049 / ADR-0087 / ADR-0106, '
    + '#19543.',
  acceptanceCriteria:
    'On the composition `objectstack serve` builds, GET /api/v1/automation (and its '
    + 'environment-scoped twin) is no longer mounted and answers the standard unmatched-route '
    + '404, with no residual refusal text — the same answer a path that never existed gets. A '
    + 'transport that forwards every automation path to the dispatcher answers the dispatcher\'s '
    + 'own route-not-found 404 for it, and the domain\'s anonymous floor still answers an '
    + 'unidentified caller 401 first, as it does for every automation path. The automation '
    + 'service\'s flow-name enumeration is never called by any HTTP request. The route-ledger row '
    + 'for the route is gone, AutomationApiContracts has eight entries and none of them is a GET '
    + 'at the bare path, and a TypeScript import of any of the removed schemas or types is a '
    + 'compile error (TS2305). @objectstack/client no longer declares automation.list, so a call '
    + 'to it is a compile error rather than a request to a path that no longer answers. '
    + 'POST /api/v1/automation still creates a flow, and every other automation route — the '
    + 'single-flow reads and writes, trigger, toggle, clone, runs, resume, cancel, '
    + 'restore-suspension, screen, _status and the actions and connectors catalogs — answers '
    + 'exactly as before.',
};
