// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `connector-resilience-keys-removed` conversion
// (`toMajor: 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `connectorResilienceKeysRemoved` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapCollection } from '../../walk.js';
import { stripKeys } from '../shared.js';

/*
 * ABSORBED — `connector-health-and-trigger-durations-unit-in-key` (protocol 18,
 * #15680 for #14478). It renamed the two connector durations whose names carried
 * no unit: `health.circuitBreaker.monitoringWindow` → `monitoringWindowMs` and
 * `triggers[].interval` → `intervalSeconds` (the bare token `interval` means
 * MILLISECONDS elsewhere in this spec, while a trigger interval meant SECONDS).
 * Both halves were then removed with the block each key lived in, inside the
 * same unreleased protocol step: the breaker half by
 * `connector-resilience-keys-removed` (the whole `health` block), and the trigger
 * half by `connector-triggers-removed` below (the whole `triggers` array).
 * Composed, a rename followed by a strip of its container is unobservable — any
 * pre-18 `health` or `triggers` ends deleted regardless of its inner spelling —
 * and the table's disjoint-fixture contract cannot hold a fixture whose
 * container another entry deletes (`spec-property-retirement` §0, the
 * `agent-knowledge-topics-to-sources` precedent above). So the entry left the
 * table. Each removal's prescription names the pre-rename spelling it absorbed;
 * the retired-key rows `integration/CircuitBreakerConfig:monitoringWindow` and
 * `integration/ConnectorTrigger:interval` stay as the record that the bare
 * spellings were retired.
 *
 * ⚠️ The id was PUBLISHED: the 17.4.0 and 17.5.0 tarballs carry it retired
 * (`retired-after.census.json`), and the 17.4.0 changelog names it. Measured
 * before it left: no code outside this package named the id, and the chain
 * replays only the ids a step lists — so an upgrading reader who greps it finds
 * this note and the two removals it points at, and a stored row or artifact
 * holding either old spelling meets the removal that deletes its container.
 */

/**
 * `connector.health`, `connector.status` and `connector.webhooks` removed
 * (protocol 18 — ADR-0049 enforce-or-remove, one batch for the family: the
 * mainstream connector surface offers none of the three as author metadata, and
 * what it does offer is already delivered here by other keys).
 *
 * Sixteen authorable keys, measured with zero reads outside `packages/spec`:
 * the `health.healthCheck` probe (eight keys) and `health.circuitBreaker` (six)
 * had no engine — nothing polled, counted consecutive failures or tripped a
 * breaker; `status` was read by nothing (the runtime publishes a COMPUTED
 * `state`, and participation is `enabled`); and a webhook nested in a
 * connector was never registered as a `webhook` item, so the webhook
 * dispatcher never read it or delivered it.
 *
 * A pure lossless delete, one notice per stripped key: none of the three ever
 * had an effect to preserve. In particular the nested `webhooks` are STRIPPED,
 * never MOVED to the top-level `webhooks:` collection — moving them would start
 * deliveries this connector never made, which is an author's decision, not a
 * mechanical repair (the family's D3 entry, `connector-resilience-keys-retired`,
 * carries that judgement). The whole `health` block goes as one key, so this
 * entry also serves an author still holding the pre-rename
 * `circuitBreaker.monitoringWindow` spelling — the rename's breaker half was
 * absorbed here (see the ABSORBED note for
 * `connector-health-and-trigger-durations-unit-in-key` above, whose trigger half
 * `connector-triggers-removed` absorbed in turn).
 *
 * `retiredFromLoadPath`: `ConnectorSchema` tombstones all three keys
 * (`retiredKey`, tsc `never` + the parse-time prescription), so a live parse
 * refuses loudly. This entry exists because a stored connector row CAN carry
 * them — the `PUT /meta/connector/:name` door persisted what it parsed,
 * including the materialized `status: 'inactive'` default — and the
 * rehydration seam `applyConversionsToStoredItem('connector', row)` is live for
 * this type; so 17.x rows replay clean, and `os migrate meta --from 17` lists
 * the mechanical edits for author sources.
 */
const connectorResilienceKeysRemoved: MetadataConversion = {
  id: 'connector-resilience-keys-removed',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.4.0',
  surface: 'connector.health / connector.status / connector.webhooks',
  summary:
    "connector keys 'health', 'status' and 'webhooks' removed (ADR-0049 — no connector health "
    + 'probe or circuit breaker ever ran, nothing read an authored status (the runtime reports a '
    + 'computed `state`), and a webhook nested in a connector was never registered or delivered. '
    + 'The ConnectorHealth / HealthCheckConfig / CircuitBreakerConfig, ConnectorStatus and '
    + 'WebhookConfig / WebhookEvent / WebhookSignatureAlgorithm shapes went with them)',
  apply(stack, emit) {
    return mapCollection(stack, 'connectors', (c, path) =>
      stripKeys(c, ['health', 'status', 'webhooks'], emit, path));
  },
  fixture: {
    before: {
      connectors: [
        {
          name: 'erp_gateway',
          label: 'ERP Gateway',
          type: 'api',
          // The measured shape: both resilience blocks, including the
          // pre-rename `monitoringWindow` spelling this removal absorbed.
          health: {
            healthCheck: { enabled: true, intervalMs: 30000, endpoint: '/health', method: 'GET' },
            circuitBreaker: { enabled: true, failureThreshold: 5, monitoringWindow: 120000, fallbackStrategy: 'cache' },
          },
          status: 'active',
          webhooks: [{
            name: 'erp_order_created',
            url: 'https://example.invalid/erp/orders',
            object: 'order',
            triggers: ['create'],
            events: ['sync.completed'],
            signatureAlgorithm: 'hmac_sha512',
          }],
        },
        // A stored 17.x row: the parse that wrote it materialized the
        // `'inactive'` default, and nothing else of this family.
        { name: 'hr_feed', label: 'HR Feed', type: 'saas', status: 'inactive' },
        // A connector that never authored any of the three keeps its identity —
        // the copy-on-write contract `stripKeys` / `mapCollection` are built on.
        { name: 'crm_directory', label: 'CRM Directory', type: 'saas' },
      ],
    },
    after: {
      connectors: [
        { name: 'erp_gateway', label: 'ERP Gateway', type: 'api' },
        { name: 'hr_feed', label: 'HR Feed', type: 'saas' },
        { name: 'crm_directory', label: 'CRM Directory', type: 'saas' },
      ],
    },
    // Three from `erp_gateway` (health, status, webhooks — the nested keys
    // leave with their block and are not counted), one from `hr_feed`.
    expectedNotices: 4,
  },
};

export { connectorResilienceKeysRemoved };
