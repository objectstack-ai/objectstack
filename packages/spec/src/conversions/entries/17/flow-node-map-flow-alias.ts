// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `flow-node-map-flow-alias` conversion (`toMajor: 17`),
// moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `flowNodeMapFlowAlias` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { renameFlowConfigAliases } from '../shared.js';

/**
 * Map flow-node config key alias → canonical (protocol 17, #4045).
 *
 * `flowName` is the canonical key — it is what the descriptor's `configSchema`
 * declares, what the designer offers, and what the showcase authors. The
 * executor nonetheless accepted a bare `cfg.flowName ?? cfg.flow` fallback for
 * an undeclared `flow` spelling that no schema ever described: the
 * `notify.source` shape (PD #12), found by writing `MapConfigSchema` from the
 * executor for the #4045 reconciliation.
 *
 * A pure key rename with unchanged values, so the pair mechanism expresses it
 * directly.
 *
 * **Retired from the load path at 18** — its one-major window (protocol 17)
 * has run (#23487). The authoring funnel no longer rewrites the old
 * spelling, so an author meets the `map` contract (`MapConfigSchema`), whose refusal names the rename and
 * this release, at every door that judges a flow: `os validate` /
 * `os build` / `os lint`. Stored flows keep healing: the automation
 * engine's flow rehydration and stored-row rehydration
 * (`applyConversionsToStoredItem`) replay the full chain, this entry
 * included, and so do the artifact-ingestion door (inside its window) and
 * `os migrate meta --from 16`.
 */
const flowNodeMapFlowAlias: MetadataConversion = {
  id: 'flow-node-map-flow-alias',
  toMajor: 17,
  retiredFromLoadPath: true,
  retiredAfter: '17.7.0',
  surface: 'flow.node.map.config.flowName',
  summary: "map flow-node config key 'flow' → 'flowName' (an undeclared spelling the executor accepted through a bare fallback; it graduates into this layer)",
  apply(stack, emit) {
    return renameFlowConfigAliases(stack, new Set(['map']), [['flow', 'flowName']], emit);
  },
  fixture: {
    before: {
      flows: [
        {
          name: 'batch_signoff',
          nodes: [
            { id: 'n1', type: 'start' },
            { id: 'n2', type: 'map', config: { collection: '{tasks}', flow: 'one_task_signoff' } },
            // Both spellings naming DIFFERENT flows (#4923): which subflow runs
            // per item is the author's call, so both keys survive to the gate.
            { id: 'n3', type: 'map', config: { collection: '{rows}', flowName: 'per_row', flow: 'per_row_v2' } },
            // Both spellings naming the SAME flow: redundant, so deleted.
            { id: 'n4', type: 'map', config: { collection: '{items}', flowName: 'per_item', flow: 'per_item' } },
          ],
        },
      ],
    },
    after: {
      flows: [
        {
          name: 'batch_signoff',
          nodes: [
            { id: 'n1', type: 'start' },
            { id: 'n2', type: 'map', config: { collection: '{tasks}', flowName: 'one_task_signoff' } },
            { id: 'n3', type: 'map', config: { collection: '{rows}', flowName: 'per_row', flow: 'per_row_v2' } },
            { id: 'n4', type: 'map', config: { collection: '{items}', flowName: 'per_item' } },
          ],
        },
      ],
    },
    // n2's rename + n4's redundant-twin deletion; n3 converts nothing.
    expectedNotices: 2,
  },
};

export { flowNodeMapFlowAlias };
