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
 * Rows are signed, never keyed: the HMAC signature is computed once at enqueue
 * and the signing secret is discarded (#7722) — see {@link HttpDelivery.signature}.
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
    /**
     * Custom headers — the ordinary place a credential (`Authorization:
     * Bearer …`) goes, whichever producer authored them (a `WebhookSchema`
     * `headers` map, or a flow `http` node's per-run interpolated values).
     *
     * [#8118] On engine-backed storage the row column (`headers_json`) is
     * declared `internal: true`, so the generic data path never returns it.
     * Consequence for THIS field: `claim()` results carry the map VERBATIM —
     * the dispatch path is fail-closed, a delivery never goes out missing an
     * authored header — while `list()` / `redeliver()` results are the
     * redacted view (`headers: undefined`) under a redacting engine. The
     * in-memory outbox stores no engine-readable row, so it has nothing to
     * redact.
     */
    headers?: Record<string, string>;
    /**
     * Pre-computed `X-Objectstack-Signature` value (`sha256=<hex>`), or absent
     * for an unsigned delivery.
     *
     * **A delivery row never holds the signing secret** (#7722). The body is
     * fixed at enqueue and never rewritten — retries and `redeliver()` replay
     * the same bytes — so the HMAC has exactly one correct value, and the outbox
     * computes it once, at enqueue, from {@link EnqueueHttpInput.signingSecret}.
     * What lands on the row is the signature: a one-way function of
     * (body, secret) that the receiver is handed on the wire anyway, so it
     * authenticates this payload without being usable to forge another. The
     * secret stays with the subscriber that owns it instead of being copied onto
     * every attempt, where it used to sit in cleartext for anyone who could read
     * `sys_http_delivery`.
     */
    signature?: string;
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
    /**
     * HMAC-SHA256 secret. **Consumed, not stored** (#7722): `enqueue()` signs the
     * body with it and persists only the resulting
     * {@link HttpDelivery.signature}. It exists on this input — and nowhere on
     * the delivery row — so a producer can keep owning its secret (a webhook
     * subscriber's, a flow node's) without every attempt taking a cleartext copy.
     */
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
     *
     * [#8118] Claim results MUST carry {@link HttpDelivery.headers} verbatim —
     * this is the dispatch path, and a delivery must never go out missing an
     * authored header. An implementation whose storage redacts the column
     * recovers it through a privileged read (see `SqlHttpOutbox`) or fails the
     * claim loudly; it must not return the row with the map silently absent.
     */
    claim(opts: HttpClaimOptions): Promise<HttpDelivery[]>;

    /** Record the outcome of an attempt. */
    ack(id: string, result: HttpAckResult): Promise<void>;

    /**
     * Snapshot accessor for tests / admin tooling. [#8118] Not a dispatch
     * path: under a redacting engine the rows come back WITHOUT
     * {@link HttpDelivery.headers} (the redacted view), and callers must not
     * expect the map here.
     */
    list(filter?: { status?: HttpDeliveryStatus; source?: string }): Promise<HttpDelivery[]>;

    /**
     * Reset a terminal row (`success` / `failed` / `dead`) back to `pending` so
     * the dispatcher re-sends it. Resets `attempts=0`; URL / payload / signature
     * are NOT touched (byte-for-byte replay — the same body carries the same
     * signature). Throws {@link HttpRedeliverError}.
     */
    redeliver(id: string): Promise<HttpDelivery>;
}
