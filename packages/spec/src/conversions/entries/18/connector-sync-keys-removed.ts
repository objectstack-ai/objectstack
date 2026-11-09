// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `connector-sync-keys-removed` conversion (`toMajor:
// 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `connectorSyncKeysRemoved` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapCollection } from '../../walk.js';
import { stripKeys } from '../shared.js';

/**
 * `connector.syncConfig` and `connector.fieldMappings` removed (protocol 18 —
 * ADR-0049, the ENFORCE route by ruling: connector-attached sync is a
 * mainstream capability, so it is built once, on the mainstream shape, and
 * that shape binds a sync to its TARGET — a `mapping` whose `connectorSource`
 * names the connector, with a `job` for the cadence — never to the
 * connection).
 *
 * Fourteen authorable keys measured with no reader: the eight `DataSyncConfig`
 * keys (`strategy`, `direction`, `realtimeSync`, `timestampField`,
 * `conflictResolution`, `batchSize`, `deleteMode`, `filters`) and the six live
 * `ConnectorFieldMapping` keys (`source`, `target`, `defaultValue`,
 * `dataType`, `required`, `syncMode`). The automation service's
 * declared-connector item and its re-materialization fingerprint carry neither
 * key, the registered def is the provider's own, and no engine ran a sync.
 *
 * A pure lossless delete, one notice per stripped key: neither key ever had an
 * effect to preserve. Both are STRIPPED, never MOVED into a `mapping` — a
 * mapping that is pulled STARTS writes into a table that never received them,
 * and its target object, match key and cadence are the author's (the family's
 * D3 entry, `connector-sync-keys-retired`, carries that judgement).
 *
 * `retiredFromLoadPath`: `ConnectorSchema` tombstones both keys (`retiredKey`,
 * tsc `never` + the parse-time prescription), so a live parse refuses loudly.
 * This entry exists because a stored connector row CAN carry them — the
 * `PUT /meta/connector/:name` door persisted what it parsed — and the
 * rehydration seam `applyConversionsToStoredItem('connector', row)` is live for
 * this type; so 17.x rows replay clean, and `os migrate meta --from 17` lists
 * the mechanical edits for author sources.
 */
const connectorSyncKeysRemoved: MetadataConversion = {
  id: 'connector-sync-keys-removed',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.5.0',
  surface: 'connector.syncConfig / connector.fieldMappings',
  summary:
    "connector keys 'syncConfig' and 'fieldMappings' removed (ADR-0049 — no engine ever ran a "
    + 'connector-attached sync or moved a value through a connector field mapping, so the '
    + '`latest_wins` and `soft_delete` defaults resolved and deleted nothing. The DataSyncConfig, '
    + 'SyncStrategy, ConnectorConflictResolution and ConnectorFieldMapping shapes went with them. '
    + 'A sync is defined on its target instead: a `mapping` whose `connectorSource` names the '
    + 'connector it pulls from, with a `job` for the cadence)',
  apply(stack, emit) {
    return mapCollection(stack, 'connectors', (c, path) =>
      stripKeys(c, ['syncConfig', 'fieldMappings'], emit, path));
  },
  fixture: {
    before: {
      connectors: [
        // Minimal by the §3 disjointness contract: the two retired keys and
        // nothing else this major's other `connectors[]` entries walk. The
        // documented shape, with the two defaults that read as policy.
        {
          name: 'erp_orders',
          label: 'ERP Orders',
          type: 'api',
          syncConfig: {
            strategy: 'incremental',
            direction: 'import',
            timestampField: 'updated_at',
            conflictResolution: 'latest_wins',
            deleteMode: 'soft_delete',
          },
          fieldMappings: [
            { source: 'order_no', target: 'order_number', dataType: 'string', required: true, syncMode: 'read_only' },
          ],
        },
        // A stored 17.x row carrying only the field map.
        {
          name: 'hr_feed',
          label: 'HR Feed',
          type: 'saas',
          fieldMappings: [{ source: 'emp_id', target: 'employee_id' }],
        },
        // A connector that never authored either key keeps its identity — the
        // copy-on-write contract `stripKeys` / `mapCollection` are built on.
        { name: 'crm_catalog', label: 'CRM Catalog', type: 'saas' },
      ],
    },
    after: {
      connectors: [
        { name: 'erp_orders', label: 'ERP Orders', type: 'api' },
        { name: 'hr_feed', label: 'HR Feed', type: 'saas' },
        { name: 'crm_catalog', label: 'CRM Catalog', type: 'saas' },
      ],
    },
    // Two from `erp_orders` (the nested keys leave with their block and are
    // not counted), one from `hr_feed`.
    expectedNotices: 3,
  },
};

export { connectorSyncKeysRemoved };
