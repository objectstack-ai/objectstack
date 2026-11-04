// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `connector-connection-timeout-ms-removed` conversion
// (`toMajor: 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `connectorConnectionTimeoutMsRemoved` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapCollection } from '../../walk.js';
import { stripKeys } from '../shared.js';

/**
 * `connector.connectionTimeoutMs` removed (protocol 18, ADR-0049
 * enforce-or-remove; maintainer ruling 2026-09-22, letter A).
 *
 * A bounded (`min(1000).max(300000)`), defaulted (`30000`), `.describe()`d key
 * on `ConnectorSchema` — and, because `DeclarativeConnectorEntrySchema` wraps
 * the same private base object, on `stack.connectors[]` and the
 * `PUT /meta/connector/:name` door — that no site ever applied as a deadline.
 *
 * ⚠️ NOT a zero-mention retirement, and the distinction is the whole finding:
 * five sites outside `packages/spec` READ the key. The materialization
 * fingerprint and the provider-context build in
 * `services/service-automation/src/plugin.ts`, `ctx.connectionTimeoutMs` in the
 * `rest` and `openapi` provider factories, and the `?? 30000` fallbacks that
 * deposit it back onto the reported def. Every one of them is a pass-through:
 * the value's only termini are the def `GET /connectors` echoes and the
 * fingerprint that decides whether to re-materialize. `connectorFetchOptions()`
 * — the one mapping from authored policy onto the platform's outbound `fetch`
 * (`integration/connector-fetch-policy.ts`) — was handed
 * `{ retryConfig, requestTimeoutMs }` only. Carrying a number is not honouring
 * it, and ADR-0049 forbids the parsed-unmarked-unenforced state whether the
 * inert value travels or sits still.
 *
 * And it is not implementable where it was declared: a connector's outbound
 * call is a WHATWG `fetch`, whose only cancellation surface is one
 * `AbortSignal` over the whole operation, so nothing there observes the connect
 * phase. `requestTimeoutMs` — the lit control for every reading above, live at
 * `integration/connector-fetch-policy.ts` where it becomes `resilientFetch`'s
 * per-attempt `timeoutMs` — is the bound the platform can keep.
 *
 * A pure lossless delete: the key never had an effect to preserve, so there is
 * no value to rewrite into anything.
 *
 * `retiredFromLoadPath`: `ConnectorSchema` tombstones the key (`retiredKey`,
 * tsc `never` + the parse-time prescription — the `errorMapping` posture one
 * block over in the same schema), so a live parse refuses loudly rather than
 * absorbing a key the author believes bounds a connect. This entry exists
 * because a stored connector row CAN carry it: the write door
 * `PUT /meta/connector/:name` parses `DeclarativeConnectorEntrySchema` and its
 * output retained the authored value, and the rehydration seam
 * `applyConversionsToStoredItem('connector', row)` is live for this type — both
 * measured before the tombstone landed. So 17.x rows replay clean here, and
 * `os migrate meta --from 17` lists the mechanical edits for author sources.
 */
const connectorConnectionTimeoutMsRemoved: MetadataConversion = {
  id: 'connector-connection-timeout-ms-removed',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.4.0',
  surface: 'connector.connectionTimeoutMs',
  summary:
    "connector key 'connectionTimeoutMs' removed (ADR-0049 — the platform never applied it as a "
    + 'deadline and cannot at the site it names: a WHATWG `fetch` exposes one `AbortSignal` over '
    + 'the whole operation and never the connect phase. The value only travelled — onto the '
    + 'reported def and the materialization fingerprint. Use `requestTimeoutMs`, which '
    + "`resilientFetch` applies as each attempt's deadline, and bound the connect phase at a "
    + 'provider or gateway that can separate the phases)',
  apply(stack, emit) {
    return mapCollection(stack, 'connectors', (c, path) =>
      stripKeys(c, ['connectionTimeoutMs'], emit, path));
  },
  fixture: {
    before: {
      connectors: [
        // Minimal by the §3 disjointness contract: the retired key and nothing
        // else this major's other `connectors[]` entries also walk
        // (`errorMapping`, `health` / `status` / `webhooks` — `health` once as
        // `health.circuitBreaker.monitoringWindow` — and `triggers`, once as
        // `triggers[].interval`), so every notice here is attributable to this id.
        { name: 'ledger_api', label: 'Ledger API', type: 'api', connectionTimeoutMs: 15000 },
        // A connector that never authored the key keeps its identity — the
        // copy-on-write contract `stripKeys` / `mapCollection` are built on.
        { name: 'inventory_sync', label: 'Inventory Sync', type: 'saas' },
      ],
    },
    after: {
      connectors: [
        { name: 'ledger_api', label: 'Ledger API', type: 'api' },
        { name: 'inventory_sync', label: 'Inventory Sync', type: 'saas' },
      ],
    },
    // One notice: the one connector carrying the key.
    expectedNotices: 1,
  },
};

export { connectorConnectionTimeoutMsRemoved };
