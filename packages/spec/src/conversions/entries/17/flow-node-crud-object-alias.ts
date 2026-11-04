// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `flow-node-crud-object-alias` conversion (`toMajor:
// 17`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `flowNodeCrudObjectAlias` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { renameFlowConfigAliases } from '../shared.js';

/**
 * CRUD flow-node `config.object` → `config.objectName` (protocol 17, #3796).
 *
 * The last tenant of the `readAliasedConfig` executor shim
 * (`service-automation/src/builtin/config-aliases.ts`) graduates into the
 * conversion layer, completing the PD #12 retirement path that
 * {@link flowNodeFilterAlias} pioneered: the alias is rewritten to the
 * canonical key at load — including the `AutomationEngine.registerFlow`
 * rehydration seam — so the CRUD executors read `cfg.objectName` directly and
 * the shim is deleted.
 *
 * **Retired from the load path at 18** — its one-major window (protocol 17)
 * has run (#23487). The authoring funnel no longer rewrites the old
 * spelling, so an author meets the CRUD node's strict config contract (`CRUD_ALIAS_GUIDANCE`), whose refusal names the rename and
 * this release, at every door that judges a flow: `os validate` /
 * `os build` / `os lint`. Stored flows keep healing: the automation
 * engine's flow rehydration and stored-row rehydration
 * (`applyConversionsToStoredItem`) replay the full chain, this entry
 * included, and so do the artifact-ingestion door (inside its window) and
 * `os migrate meta --from 16`.
 */
const flowNodeCrudObjectAlias: MetadataConversion = {
  id: 'flow-node-crud-object-alias',
  toMajor: 17,
  retiredFromLoadPath: true,
  retiredAfter: '17.7.0',
  surface: 'flow.node.config.objectName',
  summary: "CRUD flow-node config key 'object' → 'objectName' (the last alias in the executors' `readAliasedConfig` shim graduates into this layer, and the shim is deleted)",
  apply(stack, emit) {
    const crudTypes = new Set(['get_record', 'create_record', 'update_record', 'delete_record']);
    return renameFlowConfigAliases(stack, crudTypes, [['object', 'objectName']], emit);
  },
  fixture: {
    before: {
      flows: [
        {
          name: 'lead_lookup',
          nodes: [
            { id: 'n1', type: 'start' },
            { id: 'n2', type: 'get_record', config: { object: 'lead', recordId: '{leadId}' } },
            // Both spellings, DIFFERENT objects (#4923): real author ambiguity,
            // so both keys survive and the strict gate refuses naming both.
            { id: 'n3', type: 'create_record', config: { objectName: 'task', object: 'ticket' } },
            // Both spellings, SAME object: the alias carries nothing the
            // canonical key does not, so it is deleted (with a notice).
            { id: 'n4', type: 'update_record', config: { objectName: 'lead', object: 'lead' } },
          ],
        },
      ],
    },
    after: {
      flows: [
        {
          name: 'lead_lookup',
          nodes: [
            { id: 'n1', type: 'start' },
            { id: 'n2', type: 'get_record', config: { objectName: 'lead', recordId: '{leadId}' } },
            { id: 'n3', type: 'create_record', config: { objectName: 'task', object: 'ticket' } },
            { id: 'n4', type: 'update_record', config: { objectName: 'lead' } },
          ],
        },
      ],
    },
    // n2's rename + n4's redundant-twin deletion. n3 is the ambiguous pair: no
    // rewrite, no notice — the refusal is the strict gate's to make.
    expectedNotices: 2,
  },
};

export { flowNodeCrudObjectAlias };
