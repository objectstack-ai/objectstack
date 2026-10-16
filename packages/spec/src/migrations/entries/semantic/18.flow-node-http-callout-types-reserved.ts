// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #23543 F5-http — the reservation's one D3 entry. The D2 half is
// `flow-node-http-callout-rename` (protocol 11), now retired from the load
// path. It carries no `conversionIds`: protocol 11 is below
// MIGRATION_SUPPORT_FLOOR, so no step of the chain replays that conversion,
// and `os migrate meta` lists this entry as the hand edit it is. No
// `relevantWhen` either, so it is always listed (the F5-jsx shape).
export const entry: SemanticMigration = {
  id: 'flow-node-http-callout-types-reserved',
  // No backticks and no pipes in `surface` — build-upgrade-guide.ts renders it
  // inside a code span AND a table cell.
  surface: "flow node type authored as 'http_request', 'http_call' or 'webhook' (FlowNodeSchema.type, automation/flow.zod.ts)",
  replacement:
    "`type: 'http'` — the one outbound callout node since ADR-0018 unified the three; the node's `id`, `label` "
    + 'and `config` stay as they are',
  reason:
    'A maintainer ruling reserved the three retired callout node names inside the open flow-node namespace at '
    + '18. ADR-0018 unified `http_request`, `http_call` and `webhook` into the one `http` node, and through 17 '
    + 'the loader rewrote an authored node typed with one of them to `http` with a notice. At 18 the flow parse '
    + "refuses each as a node's `type`, with the prescription naming `http`: at `objectstack validate`, "
    + '`objectstack build`, `objectstack lint` and `defineStack`, for a node in a loop, parallel or try_catch '
    + 'region too. The automation engine also refuses to register a node executor under one of the three '
    + 'names, so a plugin that registered its own executor under one fails at registration and needs a type of '
    + 'its own. No tool makes the rename for an authored source: the D2 conversion '
    + '`flow-node-http-callout-rename` belongs to protocol 11, below the migration floor, so '
    + '`os migrate meta --from 17` applies no edit for it and prints each such node among the refusals left '
    + 'after the chain, at `flows.N.nodes.M.type`; change the value by hand. Stored flows need no edit: the '
    + "automation engine's flow rehydration and every stored-row rehydration seam replay the retired "
    + 'conversion, so a `sys_metadata` flow row written with an old name keeps loading as an `http` node. A '
    + "wait node's `waitEventConfig.eventType: 'webhook'` is a different field and is not affected.",
  acceptanceCriteria:
    "`objectstack validate` reports no refusal at any flow node's `type` path, no flow source in the project "
    + "types a node `http_request`, `http_call` or `webhook`, no plugin registers a node executor under one of "
    + 'those names, and each former callout node sends the same request as an `http` node.',
};
