// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// `integration/WebhookConfig` — the canonical `webhook` shape `.extend()`ed with
// `events` and `signatureAlgorithm` — leaves with its only carrier,
// `ConnectorSchema.webhooks`, tombstoned in this same major under ADR-0049
// enforce-or-remove. A webhook nested in a connector was never registered,
// materialized or delivered; the delivered shape is `automation/Webhook`, which
// is unaffected. See `retired-keys/18.integration__Connector__webhooks.ts` for
// the retirement record.
export const entry = 'integration/WebhookConfig';
