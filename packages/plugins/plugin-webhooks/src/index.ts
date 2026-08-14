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

/**
 * [#7799] The signing-secret seam. Exported so a host that boots the pieces
 * itself (rather than mounting {@link WebhookOutboxPlugin}) can still run the
 * cleartext sweep, and so the column name has one spelling.
 */
export { WEBHOOK_SECRET_FIELD } from './webhook-secret.js';

/**
 * [#7986] The custom-headers seam — the sibling passenger on the same blob,
 * moved onto the same encrypted channel by the same boot sweep.
 */
export { WEBHOOK_HEADERS_FIELD } from './webhook-headers.js';

/**
 * [#8566] The write door for that map's plaintext shape. Exported so a host
 * that boots the pieces itself (rather than mounting {@link WebhookOutboxPlugin})
 * still gets the refusal, and so a consumer can branch on the ADR-0112 pair
 * rather than on message text.
 */
export {
    bindWebhookHeadersShapeGate,
    unbindWebhookHeadersShapeGate,
    assertWritableWebhookHeaders,
    WebhookHeadersShapeError,
    WEBHOOK_HEADERS_SHAPE_REFUSAL_CODE,
    WEBHOOK_HEADERS_SHAPE_REFUSAL_STATUS,
} from './webhook-headers-gate.js';
export {
    migrateLegacyWebhookSecrets,
    type MigrateWebhookSecretsResult,
} from './migrate-webhook-secrets.js';
