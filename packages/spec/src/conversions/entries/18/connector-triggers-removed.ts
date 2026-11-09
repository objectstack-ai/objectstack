// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `connector-triggers-removed` conversion (`toMajor: 18`),
// moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `connectorTriggersRemoved` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapCollection } from '../../walk.js';
import { stripKeys } from '../shared.js';

/**
 * `connector.triggers` removed (protocol 18 — ADR-0049 enforce-or-remove, by
 * ruling on the maintainer's criterion for a declared-but-unenforced family;
 * ADR-0041 keeps connector-event triggers in its third tier, as their own
 * trigger package).
 *
 * The whole `ConnectorTrigger` array — `key`, `label`, `description`,
 * `type: 'polling' | 'webhook'`, `intervalSeconds` — measured with no reader:
 * `AutomationEngine.registerConnector` walks a connector's `actions` only, the
 * engine's trigger registry holds FLOW trigger kinds that no connector trigger
 * ever entered, no polling loop read an interval and no receiver was driven by
 * a `webhook` trigger. No connector package, provider or example declared one.
 *
 * A pure lossless delete, one notice per connector carrying the key: a trigger
 * never started anything, so there is no behaviour to preserve. The array is
 * STRIPPED, never turned into flows — what replaces a trigger is an `api` flow
 * (an external event) or a `schedule` flow (a scheduled pull) calling the
 * connector's action, and which of those should exist, with what cadence and
 * which action, is the author's call (the family's D3 entry,
 * `connector-triggers-retired`, carries it). The whole array goes as one key, so
 * this entry also serves an author still holding the pre-rename
 * `triggers[].interval` spelling: that rename was absorbed here (see the
 * ABSORBED note for `connector-health-and-trigger-durations-unit-in-key` above).
 *
 * `retiredFromLoadPath`: `ConnectorSchema` tombstones the key (`retiredKey`,
 * tsc `never` + the parse-time prescription), so a live parse refuses loudly.
 * This entry exists because a stored connector row CAN carry it — the
 * `PUT /meta/connector/:name` door persisted what it parsed, and a descriptor's
 * `triggers` parsed clean there — and the rehydration seam
 * `applyConversionsToStoredItem('connector', row)` is live for this type; so
 * 17.x rows replay clean, and `os migrate meta --from 17` lists the mechanical
 * edits for author sources.
 */
const connectorTriggersRemoved: MetadataConversion = {
  id: 'connector-triggers-removed',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.5.0',
  surface: 'connector.triggers',
  summary:
    "connector key 'triggers' removed (ADR-0049 — a connector trigger never started anything: "
    + 'the automation engine registered a connector\'s actions only, no polling loop read an '
    + 'interval and no receiver was driven by a webhook trigger. The ConnectorTrigger shape went '
    + 'with it, including the `interval` spelling renamed to `intervalSeconds` earlier in this '
    + 'step. Start the work from a flow that calls the connector\'s action instead: an `api` flow '
    + 'for an external event, a `schedule` flow for a scheduled pull)',
  apply(stack, emit) {
    return mapCollection(stack, 'connectors', (c, path) =>
      stripKeys(c, ['triggers'], emit, path));
  },
  fixture: {
    before: {
      connectors: [
        // Minimal by the §3 disjointness contract: the retired key and nothing
        // else this major's other `connectors[]` entries walk. The measured
        // shape — a polling and a webhook trigger.
        {
          name: 'billing_api',
          label: 'Billing API',
          type: 'api',
          triggers: [
            { key: 'new_invoice', label: 'New invoice', type: 'polling', intervalSeconds: 60 },
            { key: 'invoice_paid', label: 'Invoice paid', type: 'webhook' },
          ],
        },
        // A stored row written before the unit rename: the absorbed
        // `interval` spelling ends with the whole array gone, in one notice.
        {
          name: 'crm_feed',
          label: 'CRM Feed',
          type: 'saas',
          triggers: [{ key: 'new_lead', label: 'New lead', type: 'polling', interval: 300 }],
        },
        // A connector that never authored the key keeps its identity — the
        // copy-on-write contract `stripKeys` / `mapCollection` are built on.
        { name: 'crm_catalog', label: 'CRM Catalog', type: 'saas' },
      ],
    },
    after: {
      connectors: [
        { name: 'billing_api', label: 'Billing API', type: 'api' },
        { name: 'crm_feed', label: 'CRM Feed', type: 'saas' },
        { name: 'crm_catalog', label: 'CRM Catalog', type: 'saas' },
      ],
    },
    // One per connector carrying the key; the triggers inside the array leave
    // with it and are not counted.
    expectedNotices: 2,
  },
};

export { connectorTriggersRemoved };
