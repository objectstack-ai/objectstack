// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `flow-node-crud-filter-alias` conversion (`toMajor:
// 11`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `flowNodeFilterAlias` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapFlowNodes, renameConfigKey } from '../../walk.js';

/**
 * CRUD flow-node `config.filters` → `config.filter` (protocol 11.0).
 *
 * This entry demonstrates ADR-0087's **PD #12 retirement path** (issue #2645):
 * the `get_record` / `update_record` / `delete_record` executors historically
 * tolerated the `filters` alias via a consumer-side
 * `readAliasedConfig(cfg, …, 'filter', ['filters'], …)` fallback. That scattered
 * dialect tolerance is promoted here into one declared, expiring conversion and
 * the executor fallback is deleted: the load path now hands the executor the
 * canonical `filter` key, so the executor reads `cfg.filter` directly.
 *
 * **Retired from the load path at 18** — its window (protocol 11) ran long
 * ago, and the entry stayed live only because nothing marked it (#23487). The
 * authoring funnel no longer rewrites `filters`, so an author meets the CRUD
 * node's strict config contract, whose refusal names `filter` and this release
 * (`CRUD_ALIAS_GUIDANCE`), at every door that judges a flow: `os validate` /
 * `os build` / `os lint`. Stored flows keep healing: the automation engine's
 * flow rehydration and stored-row rehydration (`applyConversionsToStoredItem`)
 * replay the full chain, this entry included, and so does the
 * artifact-ingestion door inside its window. `os migrate meta` does not reach
 * it: protocol 11 is below `MIGRATION_SUPPORT_FLOOR`.
 */
const flowNodeFilterAlias: MetadataConversion = {
  id: 'flow-node-crud-filter-alias',
  toMajor: 11,
  retiredFromLoadPath: true,
  retiredAfter: '17.7.0',
  surface: 'flow.node.config.filter',
  summary: "CRUD flow-node config key 'filters' → 'filter'",
  apply(stack, emit) {
    const crudTypes = new Set(['get_record', 'update_record', 'delete_record']);
    return mapFlowNodes(stack, (node, path) => {
      if (typeof node.type !== 'string' || !crudTypes.has(node.type)) return node;
      const renamed = renameConfigKey(node, 'filters', 'filter');
      if (!renamed) return node;
      emit({ from: 'filters', to: 'filter', path: `${path}.config.filter` });
      return renamed;
    });
  },
  fixture: {
    before: {
      flows: [
        {
          name: 'purge_flow',
          nodes: [
            { id: 'n1', type: 'start' },
            {
              id: 'n2',
              type: 'delete_record',
              config: { objectName: 'lead', filters: { status: 'stale' } },
            },
          ],
        },
      ],
    },
    after: {
      flows: [
        {
          name: 'purge_flow',
          nodes: [
            { id: 'n1', type: 'start' },
            {
              id: 'n2',
              type: 'delete_record',
              config: { objectName: 'lead', filter: { status: 'stale' } },
            },
          ],
        },
      ],
    },
    expectedNotices: 1,
  },
};

export { flowNodeFilterAlias };
