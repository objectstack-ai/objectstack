// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Notification delivery outbox contracts (ADR-0030 Layer 4).
 *
 * The outbox stores `(event × recipient × channel)` delivery rows that must be
 * sent reliably (at-least-once + receiver-side idempotency on the materialized
 * artifact). Implementations are pluggable so the same dispatcher runs against
 * an in-memory test store or the SQL-backed `sys_notification_delivery` table.
 * Mirrors the proven `plugin-webhooks` outbox.
 */

export type DeliveryStatus =
    | 'pending'
    | 'in_flight'
    | 'success'
    | 'failed'
    | 'dead'
    | 'suppressed';

/** Rendered content snapshot carried on the delivery row for dispatch. */
export interface DeliveryPayload {
    title?: string;
    body?: string;
    severity?: 'info' | 'warning' | 'critical';
    actionUrl?: string;
    [k: string]: unknown;
}

export interface NotificationDeliveryRecord {
    id: string;
    notificationId: string;
    recipientId: string;
    channel: string;
    topic?: string;
    payload: DeliveryPayload;
    organizationId?: string;
    partitionKey: number;
    status: DeliveryStatus;
    attempts: number;
    claimedBy?: string;
    claimedAt?: number;
    nextAttemptAt?: number;
    lastAttemptedAt?: number;
    error?: string;
    createdAt: number;
    updatedAt: number;
    /**
     * P3b-2 digest grouping key (`${recipient}|${channel}|${window}`). When set,
     * the row is batched: the normal {@link INotificationOutbox.claim} path skips
     * it, and {@link INotificationOutbox.claimDigest} collapses all same-key rows
     * into one rendered message at window time.
     */
    digestKey?: string;
}

export interface EnqueueDeliveryInput {
    notificationId: string;
    recipientId: string;
    channel: string;
    topic?: string;
    payload: DeliveryPayload;
    organizationId?: string;
    /**
     * Earliest dispatch time (epoch ms). When set, the row enqueues with
     * `nextAttemptAt = notBefore`, so the dispatcher (which skips pending rows
     * whose `nextAttemptAt` is in the future) defers the send until then. Used
     * by the ADR-0030 P3 quiet-hours scheduler; absent ⇒ immediate.
     */
    notBefore?: number;
    /**
     * P3b-2 digest grouping key. When set, the row partitions by this key (so a
     * window's rows share a partition and one node collapses them) and is drained
     * via {@link INotificationOutbox.claimDigest} rather than the normal claim.
     */
    digestKey?: string;
}

export interface ClaimOptions {
    nodeId: string;
    limit: number;
    /** Only claim rows whose `hash(notificationId) mod count === index`. */
    partition?: { index: number; count: number };
    /** Visibility timeout — claimed rows revert to pending after this many ms. */
    claimTtlMs: number;
    /** "Now" reference, ms. Defaults to Date.now(). */
    now?: number;
}

export interface AckSuccess {
    success: true;
    durationMs?: number;
}

export interface AckFailure {
    success: false;
    error?: string;
    durationMs?: number;
    /** Computed by the dispatcher per the retry schedule, or undefined for dead. */
    nextAttemptAt?: number;
    /** Marks the row terminal `dead` — retry budget exhausted / permanent error. */
    dead?: boolean;
    /** Marks the row terminal `suppressed` — intentionally not delivered. */
    suppressed?: boolean;
}

export type AckResult = AckSuccess | AckFailure;

/**
 * [#11453] Error raised by {@link INotificationOutbox.ack} when the delivery
 * row's status does not permit the completion it was handed.
 *
 * `DELIVERY_NOT_ELIGIBLE` is this package's already-registered ADR-0112 code
 * for "this delivery row's state does not permit the requested operation" —
 * the same refusal `SqlHttpOutbox.redeliver` raises when its own
 * compare-and-set misses. Reused deliberately rather than minted: the two
 * refusals are one concept on two delivery surfaces, and a second spelling
 * would be a second thing for a caller to match on.
 */
export class NotificationAckError extends Error {
    constructor(
        message: string,
        readonly code: 'DELIVERY_NOT_ELIGIBLE',
    ) {
        super(message);
        this.name = 'NotificationAckError';
    }
}

/**
 * The refusal message, in ONE place both implementations call — so the memory
 * and SQL backends cannot drift into two different wordings for one contract
 * violation (the drift this card's contract test exists to prevent).
 */
export function notificationAckNotClaimedMessage(id: string, status: DeliveryStatus | 'unknown'): string {
    return (
        `Delivery row '${id}' is '${status}', not 'in_flight': ack() records the outcome of a delivery `
        + 'the caller CLAIMED, and this row is not claimed. Acking an unclaimed row would race the '
        + "dispatcher (claim() is atomic by contract and ack() is not part of that atom) and record an "
        + 'attempt that never went on the wire. To stop a pending delivery, there is deliberately no '
        + 'ack() spelling — see #11453.'
    );
}

/**
 * The refusal message for the OTHER half of the precondition: the row WAS
 * `in_flight` when ack() read it and had stopped being so by the time the
 * conditional write ran — a claim lost to the visibility-timeout reap plus a
 * re-claim by another node.
 *
 * Distinguished from {@link notificationAckNotClaimedMessage} because the two
 * say different things to whoever reads the log: the first is a CALLER using
 * `ack` wrongly, the second is a dispatcher that lost a race it is allowed to
 * lose. Both write nothing.
 */
export function notificationAckLostClaimMessage(id: string, status: DeliveryStatus | 'unknown'): string {
    return (
        `Delivery row '${id}' stopped being 'in_flight' while ack() was recording its outcome `
        + `(it now reads '${status}'), so the conditional update matched no row and NOTHING was `
        + 'written — this attempt was not recorded and the row belongs to whoever holds it now. '
        + 'Expected when a slow send outruns `claimTtlMs` and the row is reaped and re-claimed (#11453).'
    );
}

/**
 * Pluggable storage for delivery rows. `claim()` MUST be atomic across
 * concurrent callers (the at-least-once guarantee), and `enqueue()` MUST treat
 * `(notificationId, recipientId, channel)` as unique (silently returning the
 * existing id on a duplicate) so a repeated `emit` can't double-deliver.
 */
export interface INotificationOutbox {
    enqueue(input: EnqueueDeliveryInput): Promise<string>;
    claim(opts: ClaimOptions): Promise<NotificationDeliveryRecord[]>;
    /**
     * Record the outcome of ONE dispatch attempt on a row this caller claimed.
     *
     * ⛔ **Precondition: the row MUST be `in_flight`** (i.e. claimed). Acking a
     * row in any other status — an unclaimed `pending` row, or one already
     * terminal — throws {@link NotificationAckError}, writes nothing, and
     * leaves `attempts` untouched. `ack` is the dispatcher's completion
     * callback, NOT a cancellation primitive: using it to flip a `pending` row
     * to `suppressed` raced the dispatcher and recorded an attempt that never
     * happened (#11453). An id that matches no row is not a contract
     * violation and stays a silent no-op — an absent row has no state to
     * corrupt and no claim to lose.
     *
     * Implementations MUST make the transition atomic against {@link claim}:
     * the status test and the write are one operation, never a read-then-write.
     */
    ack(id: string, result: AckResult): Promise<void>;
    list(filter?: { status?: DeliveryStatus; notificationId?: string }): Promise<NotificationDeliveryRecord[]>;
    /**
     * P3b-2: atomically claim **all** due batched rows (those with a `digestKey`)
     * in scope, so the dispatcher can collapse same-key rows into one message.
     * Like {@link claim} it flips rows to `in_flight` and respects `partition` /
     * `nextAttemptAt`; unlike it, it returns *only* digest rows and is not
     * `limit`-bounded per group (a window must be claimed whole). Normal `claim`
     * MUST exclude digest rows so they are never sent individually.
     */
    claimDigest(opts: ClaimOptions): Promise<NotificationDeliveryRecord[]>;
}
