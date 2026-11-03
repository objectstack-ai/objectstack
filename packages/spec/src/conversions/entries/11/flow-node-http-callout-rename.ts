// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `flow-node-http-callout-rename` conversion (`toMajor:
// 11`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `flowNodeHttpRename` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapFlowNodes } from '../../walk.js';
import { FLOW_RESERVED_NODE_TYPES } from '../../../automation/flow-reserved-node-types.js';

/**
 * Flow callout node type rename (protocol 11.0; retired from the load path at
 * 18, #23543 F5-http).
 *
 * The divergent `http_request` / `http_call` / `webhook` node types were
 * unified to the single canonical `http` node (see
 * `services/service-automation/src/builtin/http-nodes.ts`). A pure enum
 * re-spelling — losslessly convertible.
 *
 * ## Retired from the load path at 18 (#23543, ruling F5-http A)
 *
 * Through 17 it stayed live because `flow.node.type` is an open namespace
 * (ADR-0018) and no door refused the three names, so retired alone it would
 * have left an authored node silently carrying a type no builtin executor owns
 * (the verdict #23487 recorded). The ruling reserved the names inside the open
 * namespace: the flow parse refuses each one as a node `type` with the
 * prescription naming `http`, and the automation engine refuses to register a
 * node executor under one (`FLOW_RESERVED_NODE_TYPES`,
 * `automation/flow-reserved-node-types.ts`, the table this entry reads too). So
 * the authoring funnel (`defineStack`, `os validate` / `os build`) no longer
 * replays this entry, and an author is taught the canonical type instead of
 * being rewritten. Stored flows are the `includeRetired` seams: the automation
 * engine's flow rehydration and stored-row rehydration
 * (`applyConversionsToStoredItem`) still rewrite a `sys_metadata` flow row
 * written with an old name before anything parses it, and so does the
 * artifact-ingestion door inside its window. `os migrate meta` does not reach
 * it: protocol 11 is below `MIGRATION_SUPPORT_FLOOR`. The family's D3 entry,
 * `flow-node-http-callout-types-reserved`, states the edit for authored sources.
 *
 * The rewrite is unconditional. Until 18 it skipped a node whose old name a
 * live executor owned and reported a conflict instead (ADR-0078's guard); the
 * engine now refuses that registration, so no live executor can own a reserved
 * name and the guard had no case left to judge. Protocol 18 removed the
 * conflict channel itself with it (#24001, D3 entry
 * `conversion-conflict-channel-removed`).
 */
const flowNodeHttpRename: MetadataConversion = {
  id: 'flow-node-http-callout-rename',
  toMajor: 11,
  retiredFromLoadPath: true,
  retiredAfter: '17.7.0',
  surface: 'flow.node.type',
  summary: "flow callout node types 'http_request' / 'http_call' / 'webhook' → 'http'",
  apply(stack, emit) {
    return mapFlowNodes(stack, (node, path) => {
      const type = node.type;
      if (typeof type !== 'string' || !Object.prototype.hasOwnProperty.call(FLOW_RESERVED_NODE_TYPES, type)) return node;
      const canonical = FLOW_RESERVED_NODE_TYPES[type]!;
      emit({ from: type, to: canonical, path: `${path}.type` });
      return { ...node, type: canonical };
    });
  },
  fixture: {
    before: {
      flows: [
        {
          name: 'notify_flow',
          nodes: [
            { id: 'n1', type: 'start' },
            { id: 'n2', type: 'http_request', config: { url: 'https://example.com' } },
            { id: 'n3', type: 'webhook', config: { url: 'https://hooks.example.com' } },
          ],
        },
      ],
    },
    after: {
      flows: [
        {
          name: 'notify_flow',
          nodes: [
            { id: 'n1', type: 'start' },
            { id: 'n2', type: 'http', config: { url: 'https://example.com' } },
            { id: 'n3', type: 'http', config: { url: 'https://hooks.example.com' } },
          ],
        },
      ],
    },
    expectedNotices: 2,
  },
};

export { flowNodeHttpRename };
