// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Webhook outbox contracts.
 *
 * The outbox stores webhook delivery rows that must be POSTed exactly once
 * (modulo at-least-once + receiver-side idempotency). Implementations are
 * pluggable so the same dispatcher can run against an in-memory test store
 * or a SQL-backed production table.
 *
 * See `content/docs/concepts/webhook-delivery.mdx` §3.2 for the full schema.
 */

export type DeliveryStatus =
    | 'pending'
    | 'in_flight'
    | 'success'
    | 'failed'
    | 'dead';

export interface WebhookDelivery {
    /** UUID — also doubles as the receiver-side idempotency key. */
    id: string;
    /** FK to sys_webhook.id — opaque to the dispatcher; only used for hashing. */
    webhookId: string;
    /** Origin event id. UNIQUE(event_id, webhook_id) prevents double-enqueue. */
    eventId: string;
    /** Origin event type, e.g. `data.record.created`. */
    eventType: string;
    /** Destination URL (snapshotted on enqueue — config edits don't rewrite live rows). */
    url: string;
    /** HTTP method — defaults to POST. */
    method?: string;
    /** Custom headers configured on the sink. */
    headers?: Record<string, string>;
    /** HMAC-SHA256 secret. If present, signature is added. */
    secret?: string;
    /** Per-request timeout in ms. */
    timeoutMs?: number;
    /** JSON-serialisable body. */
    payload: unknown;

    /** Lifecycle state. */
    status: DeliveryStatus;
    /** Number of POST attempts made so far (0 before first attempt). */
    attempts: number;
    /** Node id currently working on this row, when `status = in_flight`. */
    claimedBy?: string;
    /** Wall-clock ms when the row was claimed. */
    claimedAt?: number;
    /** Earliest ms at which this row becomes eligible for the next attempt. */
    nextRetryAt?: number;
    /** Wall-clock ms of the last attempt (success or fail). */
    lastAttemptedAt?: number;
    /** HTTP status code from the most recent attempt. */
    responseCode?: number;
    /** Truncated response body for diagnostics. */
    responseBody?: string;
    /** Last transport / timeout error message. */
    error?: string;

    createdAt: number;
    updatedAt: number;
}

export interface EnqueueInput {
    webhookId: string;
    eventId: string;
    eventType: string;
    url: string;
    method?: string;
    headers?: Record<string, string>;
    secret?: string;
    timeoutMs?: number;
    payload: unknown;
}

export interface ClaimOptions {
    /** Identifier of the node doing the claim (for `claimedBy`). */
    nodeId: string;
    /** Max rows to claim per call. */
    limit: number;
    /**
     * Partition assignment for this worker. Only rows whose
     * `hash(webhookId) mod count === index` are claimed. Omit to claim
     * across all partitions (single-node mode).
     */
    partition?: { index: number; count: number };
    /** Visibility timeout — claimed rows revert to pending after this many ms. */
    claimTtlMs: number;
    /** "Now" reference, ms since epoch. Defaults to Date.now(). */
    now?: number;
}

export interface AckSuccess {
    success: true;
    httpStatus: number;
    responseBody?: string;
    durationMs: number;
}

export interface AckFailure {
    success: false;
    httpStatus?: number;
    responseBody?: string;
    error?: string;
    durationMs: number;
    /** Computed by the dispatcher per the retry schedule, or undefined for dead. */
    nextRetryAt?: number;
    /** Marks the row terminal — no more attempts. */
    dead?: boolean;
}

export type AckResult = AckSuccess | AckFailure;

/**
 * Pluggable storage backend for delivery rows. Implementations MUST make
 * `claim()` atomic across concurrent callers — that property is the
 * exactly-once guarantee.
 */
export interface IWebhookOutbox {
    /**
     * Insert a new delivery row. Implementations MUST treat
     * `(eventId, webhookId)` as unique and silently drop duplicates.
     * Returns the row id (existing or new).
     */
    enqueue(input: EnqueueInput): Promise<string>;

    /**
     * Atomically claim up to `limit` rows whose `nextRetryAt <= now` (or
     * null) and matching the partition predicate. Claimed rows MUST be
     * marked `in_flight` so concurrent claimers don't see them.
     */
    claim(opts: ClaimOptions): Promise<WebhookDelivery[]>;

    /** Record the outcome of an attempt. */
    ack(id: string, result: AckResult): Promise<void>;

    /** Snapshot accessor for tests / admin tooling. */
    list(filter?: { status?: DeliveryStatus }): Promise<WebhookDelivery[]>;
}
