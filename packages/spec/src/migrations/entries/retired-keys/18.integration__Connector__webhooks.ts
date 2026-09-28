// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// ADR-0049 enforce-or-remove on `ConnectorSchema.webhooks` — part of the
// connector resilience family batch (see `18.integration__Connector__health.ts`).
// A connector's NESTED webhook array is not the collection anything delivers:
// the stack decomposition registers a `connectors:` entry WHOLE, so a webhook
// nested in it never becomes a `webhook` metadata item, and
// `@objectstack/plugin-webhooks` materializes `sys_webhook` rows only from those
// items (the top-level `webhooks:` collection). Measured on `origin/main`: zero
// reads of a connector's own `webhooks` outside `packages/spec`, while
// `stack.webhooks` — the lit control, same scan — is read five times; the one
// test that authors a nested array
// (`bootstrap-declared-webhooks.connector-nested.test.ts`) exists to pin that it
// is NOT hoisted. And no code path emits a connector lifecycle event
// (`sync.completed`, `auth.expired`, …) for its `events` to subscribe to.
//
// Tombstoned with `retiredKey()` (non-strict schema, ADR-0104). The nested shape
// leaves whole — `integration/WebhookConfig`, `integration/WebhookEvent`,
// `integration/WebhookSignatureAlgorithm` in `RETIRED_DEFS_BY_MAJOR[18]`. The key
// carried no default, so no residue window. The D2 conversion
// `connector-resilience-keys-removed` STRIPS the array and never moves it to the
// top-level collection: that would start deliveries the connector never made —
// the author's decision, carried by the D3 entry `connector-resilience-keys-retired`.
export const entry = 'integration/Connector:webhooks';
