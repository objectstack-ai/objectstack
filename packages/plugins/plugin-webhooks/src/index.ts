// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @objectstack/plugin-webhooks
 *
 * Webhook fan-out on top of the shared outbound-HTTP delivery substrate
 * (ADR-0018 M3). The durable outbox, cluster-coordinated dispatcher, retry /
 * backoff / dead-letter, and retention all live in
 * `@objectstack/service-messaging` (`sys_http_delivery` + `HttpDispatcher`).
 *
 * This package ships only the webhook-specific concerns:
 *   - the `sys_webhook` configuration object,
 *   - the {@link AutoEnqueuer} that turns `data.record.*` events into outbox
 *     rows (`source: 'webhook'`),
 *   - the redeliver admin endpoint.
 *
 * **Requires** `MessagingServicePlugin` (a foundational, always-on capability).
 *
 * ## Subpath exports
 * - `@objectstack/plugin-webhooks/schema` — `SysWebhook` object schema.
 */

export {
    WebhookOutboxPlugin,
    type WebhookOutboxPluginOptions,
} from './webhook-outbox-plugin.js';

export { AutoEnqueuer, type AutoEnqueuerOptions, type HttpEnqueueFn } from './auto-enqueuer.js';
export { SysWebhook } from './sys-webhook.object.js';
