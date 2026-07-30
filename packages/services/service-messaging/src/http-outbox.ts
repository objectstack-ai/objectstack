// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Generic outbound-HTTP delivery outbox (ADR-0018 M3).
 *
 * This is the *raw HTTP callout* counterpart to the notification outbox
 * (`outbox.ts`, which is recipient/channel-centric). It stores rows that must
 * be POSTed (or any method) exactly once — modulo at-least-once + receiver-side
 * idempotency — with retry / backoff / dead-letter handled by the shared
 * {@link HttpDispatcher}.
 *
 * It generalises the original `plugin-webhooks` outbox so two callers share one
 * reliable substrate:
 *   - the Flow `http` node executor (`@objectstack/service-automation`), and
 *   - webhook fan-out (`@objectstack/plugin-webhooks`),
 *
 * which is exactly the "build the reliability machinery once, reuse it
 * everywhere" decision in ADR-0018 §4. Webhook-specific concepts collapse onto
 * generic fields: `webhookId`→`refId`, `eventId`→`dedupKey`, `eventType`→`label`,
 * `secret`→`signingSecret`.
 */

export type HttpDeliveryStatus =
    | 'pending'
    | 'in_flight'
    | 'success'
    | 'failed'
    | 'dead';

export interface HttpDelivery {
    /** UUID — also doubles as the receiver-side idempotency key (`X-Objectstack-Delivery`). */
    id: string;
    /**
     * Provenance domain — e.g. `'webhook'` | `'flow'`. Combined with `dedupKey`
     * for the uniqueness constraint, and used (with `refId`) for partition
     * affinity so rows from one source/anchor stay in-order.
     */
    source: string;
    /**
     * Partition / ordering anchor within `source` — the webhook id, the flow id,
     * etc. `hash(refId) mod partitionCount` picks the partition.
     */
    refId: string;
    /** UNIQUE(source, dedup_key) prevents double-enqueue. */
    dedupKey: string;
    /**
     * Human/diagnostic label, e.g. an event type (`data.record.created`) or a
     * `flow:node` id. Surfaced on the `X-Objectstack-Event` header when present.
     */
    label?: string;
    /** Destination URL (snapshotted on enqueue — config edits don't rewrite live rows). */
    url: string;
    /** HTTP method — defaults to POST. */
    method?: string;
    /** Custom headers. */
    headers?: Record<string, string>;
    /** HMAC-SHA256 secret. If present, an `X-Objectstack-Signature` header is added. */
    signingSecret?: string;
    /** Per-request timeout in ms. */
    timeoutMs?: number;
    /** JSON-serialisable body. */
    payload: unknown;

    /** Lifecycle state. */
    status: HttpDeliveryStatus;
    /** Number of attempts made so far (0 before first attempt). */
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

export interface EnqueueHttpInput {
    source: string;
    refId: string;
    dedupKey: string;
    label?: string;
    url: string;
    method?: string;
    headers?: Record<string, string>;
    signingSecret?: string;
    timeoutMs?: number;
    payload: unknown;
}

export interface HttpClaimOptions {
    /** Identifier of the node doing the claim (for `claimedBy`). */
    nodeId: string;
    /** Max rows to claim per call. */
    limit: number;
    /**
     * Partition assignment for this worker. Only rows whose
     * `hash(refId) mod count === index` are claimed. Omit to claim across all
     * partitions (single-node mode).
     */
    partition?: { index: number; count: number };
    /** Visibility timeout — claimed rows revert to pending after this many ms. */
    claimTtlMs: number;
    /** "Now" reference, ms since epoch. Defaults to Date.now(). */
    now?: number;
}

export interface HttpAckSuccess {
    success: true;
    httpStatus: number;
    responseBody?: string;
    durationMs: number;
}

export interface HttpAckFailure {
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

export type HttpAckResult = HttpAckSuccess | HttpAckFailure;

/**
 * Error raised by `IHttpOutbox.redeliver` when the requested row is either
 * missing or in a non-terminal state.
 */
export class HttpRedeliverError extends Error {
    constructor(
        message: string,
        readonly code: 'RESOURCE_NOT_FOUND' | 'DELIVERY_NOT_ELIGIBLE',
    ) {
        super(message);
        this.name = 'HttpRedeliverError';
    }
}

/**
 * Pluggable storage backend for outbound-HTTP delivery rows. Implementations
 * MUST make `claim()` atomic across concurrent callers — that property is the
 * exactly-once guarantee.
 */
export interface IHttpOutbox {
    /**
     * Insert a new delivery row. Implementations MUST treat `(source, dedupKey)`
     * as unique and silently converge duplicates. Returns the row id (existing
     * or new).
     */
    enqueue(input: EnqueueHttpInput): Promise<string>;

    /**
     * Atomically claim up to `limit` rows whose `nextRetryAt <= now` (or null)
     * and matching the partition predicate. Claimed rows MUST be marked
     * `in_flight` so concurrent claimers don't see them.
     */
    claim(opts: HttpClaimOptions): Promise<HttpDelivery[]>;

    /** Record the outcome of an attempt. */
    ack(id: string, result: HttpAckResult): Promise<void>;

    /** Snapshot accessor for tests / admin tooling. */
    list(filter?: { status?: HttpDeliveryStatus; source?: string }): Promise<HttpDelivery[]>;

    /**
     * Reset a terminal row (`success` / `failed` / `dead`) back to `pending` so
     * the dispatcher re-sends it. Resets `attempts=0`; URL / payload / secret are
     * NOT touched (byte-for-byte replay). Throws {@link HttpRedeliverError}.
     */
    redeliver(id: string): Promise<HttpDelivery>;
}
