// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @objectstack/plugin-webhook-outbox
 *
 * Persistent, cluster-aware webhook outbox + dispatcher.
 *
 * Implements stages 3–5 of the pipeline in
 * `content/docs/concepts/webhook-delivery.mdx` (Persist · Dispatch ·
 * Retry). Stages 1–2 (Event capture · Match) integrate via the
 * `webhook.outbox.enqueue()` service consumers call after persistence.
 *
 * The first real cross-node consumer of `cluster.lock`.
 */

export {
    WebhookOutboxPlugin,
    type WebhookOutboxPluginOptions,
} from './webhook-outbox-plugin.js';

export { WebhookDispatcher, type DispatcherOptions } from './dispatcher.js';
export { MemoryWebhookOutbox } from './memory-outbox.js';
export { hashPartition } from './partition.js';
export {
    sendOnce,
    classifyAttempt,
    nextRetryDelayMs,
    DEFAULT_TIMEOUT_MS,
    type AttemptOutcome,
    type FetchImpl,
} from './http-sender.js';
export type {
    AckFailure,
    AckResult,
    AckSuccess,
    ClaimOptions,
    DeliveryStatus,
    EnqueueInput,
    IWebhookOutbox,
    WebhookDelivery,
} from './outbox.js';
