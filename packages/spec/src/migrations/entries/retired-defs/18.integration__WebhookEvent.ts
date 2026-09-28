// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// `integration/WebhookEvent` (`record.created` / `record.updated` /
// `record.deleted` / `sync.started` / `sync.completed` / `sync.failed` /
// `auth.expired` / `rate_limit.exceeded`) leaves with `integration/WebhookConfig`,
// whose `events` was its only carrier. No code path emits any of the connector
// lifecycle events it names. See
// `retired-keys/18.integration__Connector__webhooks.ts` for the retirement record.
export const entry = 'integration/WebhookEvent';
