// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `flow-node-script-config-aliases` conversion (`toMajor:
// 17`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `flowNodeScriptConfigAliases` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { renameFlowConfigAliases } from '../shared.js';

/**
 * Script flow-node config key aliases → canonical (protocol 17, #3796).
 *
 * `function` is the canonical callable reference (#1870); `functionName` was
 * the AI/template-emitted alias. `inputs` is the canonical input map; the
 * `input` alias almost certainly leaked from `connector_action`, whose
 * `connectorConfig.input` (singular) is a *different, canonical* surface and is
 * deliberately not touched here. Both are pure key renames with unchanged
 * values.
 *
 * **Retired from the load path at 18** — its one-major window (protocol 17)
 * has run (#23487). The authoring funnel no longer rewrites the old
 * spelling, so an author meets the `script` contract (`SCRIPT_KEY_GUIDANCE`), whose refusal names the rename and
 * this release, at every door that judges a flow: `os validate` /
 * `os build` / `os lint`. Stored flows keep healing: the automation
 * engine's flow rehydration and stored-row rehydration
 * (`applyConversionsToStoredItem`) replay the full chain, this entry
 * included, and so do the artifact-ingestion door (inside its window) and
 * `os migrate meta --from 16`.
 *
 * The fixture below carried `actionType: 'invoke_function'` through both sides
 * until #4343 retired that key — an end state protocol 17 no longer reaches, so
 * it is gone from both. The rename itself is untouched.
 */
const flowNodeScriptConfigAliases: MetadataConversion = {
  id: 'flow-node-script-config-aliases',
  toMajor: 17,
  retiredFromLoadPath: true,
  retiredAfter: '17.7.0',
  surface: 'flow.node.script.config',
  summary: "script flow-node config keys 'functionName' → 'function', 'input' → 'inputs' (executor `??` fallbacks, graduated into this layer)",
  apply(stack, emit) {
    return renameFlowConfigAliases(
      stack,
      new Set(['script']),
      [
        ['functionName', 'function'],
        ['input', 'inputs'],
      ],
      emit,
    );
  },
  fixture: {
    before: {
      flows: [
        {
          name: 'score_lead',
          nodes: [
            { id: 'n1', type: 'start' },
            {
              id: 'n2',
              type: 'script',
              config: {
                functionName: 'score_lead',
                input: { leadId: '{record.id}' },
                outputVariable: 'score',
              },
            },
          ],
        },
      ],
    },
    after: {
      flows: [
        {
          name: 'score_lead',
          nodes: [
            { id: 'n1', type: 'start' },
            {
              id: 'n2',
              type: 'script',
              config: {
                function: 'score_lead',
                inputs: { leadId: '{record.id}' },
                outputVariable: 'score',
              },
            },
          ],
        },
      ],
    },
    expectedNotices: 2,
  },
};

export { flowNodeScriptConfigAliases };
