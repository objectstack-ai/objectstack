// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `flow-node-subflow-flow-alias` conversion (`toMajor:
// 17`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `flowNodeSubflowFlowAlias` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { renameFlowConfigAliases } from '../shared.js';

/**
 * Subflow flow-node config key alias → canonical (protocol 17, #4278).
 *
 * The same undeclared `flow` spelling {@link flowNodeMapFlowAlias} retired for
 * `map`, found on `subflow` by writing `SubflowConfigSchema` from its executor
 * for the #4278 schemaless-node reconciliation: the executor carried a bare
 * `cfg.flowName ?? cfg.flow` fallback no schema or form ever described (PD
 * #12). The fallback is deleted in the same change; this conversion is what
 * keeps a stored `flow` spelling loading — rewritten to the canonical key,
 * including the `AutomationEngine.registerFlow` rehydration seam, so the
 * executor reads `cfg.flowName` only.
 *
 * A pure key rename with unchanged values.
 *
 * **Retired from the load path at 18** — its one-major window (protocol 17)
 * has run (#23487). The authoring funnel no longer rewrites the old
 * spelling, so an author meets the `subflow` contract (`SUBFLOW_KEY_GUIDANCE`), whose refusal names the rename and
 * this release, at every door that judges a flow: `os validate` /
 * `os build` / `os lint`. Stored flows keep healing: the automation
 * engine's flow rehydration and stored-row rehydration
 * (`applyConversionsToStoredItem`) replay the full chain, this entry
 * included, and so do the artifact-ingestion door (inside its window) and
 * `os migrate meta --from 16`.
 */
const flowNodeSubflowFlowAlias: MetadataConversion = {
  id: 'flow-node-subflow-flow-alias',
  toMajor: 17,
  retiredFromLoadPath: true,
  retiredAfter: '17.7.0',
  surface: 'flow.node.subflow.config.flowName',
  summary: "subflow flow-node config key 'flow' → 'flowName' (an undeclared spelling the executor accepted through a bare fallback, found when the schemaless nodes were reconciled with their executors; it graduates into this layer)",
  apply(stack, emit) {
    return renameFlowConfigAliases(stack, new Set(['subflow']), [['flow', 'flowName']], emit);
  },
  fixture: {
    before: {
      flows: [
        {
          name: 'escalate_case',
          nodes: [
            { id: 'n1', type: 'start' },
            { id: 'n2', type: 'subflow', config: { flow: 'escalation_flow', input: { caseId: '{record.id}' } } },
            // Both spellings naming DIFFERENT flows (#4923): both survive, and
            // the strict `subflow` contract refuses naming both.
            { id: 'n3', type: 'subflow', config: { flowName: 'audit_flow', flow: 'audit_flow_v2' } },
            // Both spellings naming the SAME flow: redundant, so deleted.
            { id: 'n4', type: 'subflow', config: { flowName: 'notify_flow', flow: 'notify_flow' } },
          ],
        },
      ],
    },
    after: {
      flows: [
        {
          name: 'escalate_case',
          nodes: [
            { id: 'n1', type: 'start' },
            { id: 'n2', type: 'subflow', config: { flowName: 'escalation_flow', input: { caseId: '{record.id}' } } },
            { id: 'n3', type: 'subflow', config: { flowName: 'audit_flow', flow: 'audit_flow_v2' } },
            { id: 'n4', type: 'subflow', config: { flowName: 'notify_flow' } },
          ],
        },
      ],
    },
    // n2's rename + n4's redundant-twin deletion; n3 converts nothing.
    expectedNotices: 2,
  },
};

export { flowNodeSubflowFlowAlias };
