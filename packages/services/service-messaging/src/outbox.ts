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
    /**
     * User who caused the event, snapshotted alongside the rendered content so
     * the dispatcher can put it back on the `Notification` without a read per
     * delivery. Declared rather than left to the index signature below: a typed
     * key beats an untyped record (Prime Directive #12), and the dispatcher's
     * read of it is then type-checked at both ends.
     */
    actorId?: string;
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

/**
 * [#11859] A delivery row as handed out by {@link INotificationOutbox.claim} /
 * {@link INotificationOutbox.claimDigest}: the **claim credential** — the
 * (`claimedBy`, `claimedAt`) pair the store stamped when it took the row — is
 * guaranteed present. {@link INotificationOutbox.ack} takes this record back,
 * and the credential joins the compare-and-set predicate, so ownership is
 * proven by ROUND-TRIPPING what `claim()` returned rather than by the caller
 * supplying an identity it had to know (the option-A shape the #11859 ruling
 * refused). The pair identifies one CLAIM, not one node: `claimedAt` is what
 * refuses a late ack even when the SAME node re-claimed its own reaped row —
 * the outcome belongs to the attempt, and a re-claim is a new attempt.
 */
export interface ClaimedDeliveryRecord extends NotificationDeliveryRecord {
    claimedBy: string;
    claimedAt: number;
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
    /**
     * [#17610] Skip the visibility-timeout reap this call otherwise runs before
     * claiming. Default `false`: a direct `claim()` stays self-contained — the
     * call that wants stale `in_flight` rows back is the one that recovers them.
     *
     * A caller that already ran {@link INotificationOutbox.reap} for this pass
     * passes `true`. `NotificationDispatcher` reaps once per tick and then claims
     * every partition twice (normal + digest); the reap is environment-wide — its
     * predicate names no partition — so repeating it per claim recovers nothing
     * the first run did not, and on an idle outbox with the default 8 partitions
     * it was 16 of a tick's 32 statements.
     */
    skipReap?: boolean;
}

/** [#17610] Options for {@link INotificationOutbox.reap}. */
export interface ReapOptions {
    /** Visibility timeout — `in_flight` rows claimed longer ago than this revert to `pending`. */
    claimTtlMs: number;
    /** "Now" reference, ms. Defaults to the store's clock. */
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
 * claimed by this caller and had stopped being so by the time the outcome was
 * recorded — a claim lost to the visibility-timeout reap. [#11859] Covers BOTH
 * post-reap states: the row moved out of `in_flight`, and the row re-claimed
 * (still `in_flight`, but under a different claim credential — possibly the
 * same node's LATER claim, which is still not the claim this ack completes).
 *
 * Distinguished from {@link notificationAckNotClaimedMessage} because the two
 * say different things to whoever reads the log: the first is a CALLER using
 * `ack` wrongly, the second is a dispatcher that lost a race it is allowed to
 * lose. Both write nothing.
 */
export function notificationAckLostClaimMessage(id: string, status: DeliveryStatus | 'unknown'): string {
    return (
        `Delivery row '${id}' is no longer held by the claim this ack completes (it now reads `
        + `'${status}'), so the ownership-checked conditional update matched no row and NOTHING was `
        + 'written — this attempt was not recorded and the row belongs to whoever holds it now. '
        + 'Expected when a slow send outruns `claimTtlMs` and the row is reaped and re-claimed '
        + '(#11453, #11859).'
    );
}

/**
 * [#11859] The refusal message for a record that carries no claim credential
 * at all. `ack()` takes back the exact record {@link INotificationOutbox.claim}
 * / {@link INotificationOutbox.claimDigest} returned; a row read via `list()`
 * while unclaimed, or a hand-built record, has no (`claimedBy`, `claimedAt`)
 * pair and is refused before any read or write — possession of a row's id was
 * never evidence of a claim, and the compile-time contract
 * ({@link ClaimedDeliveryRecord}) is enforced here at runtime for JS callers
 * and casts.
 */
export function notificationAckNoCredentialMessage(id: string): string {
    return (
        `Delivery row '${id}': the record passed to ack() carries no claim credential `
        + '(claimedBy + claimedAt). ack() records the outcome of a delivery the caller CLAIMED, '
        + 'and proves the claim by handing back the record claim()/claimDigest() returned. '
        + 'Nothing was written.'
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
    /**
     * [#17610] The visibility-timeout recovery on its own: every `in_flight` row
     * whose claim is older than `claimTtlMs` reverts to `pending` with its claim
     * credential cleared — across the WHOLE store, every partition and every
     * organization. It is the step {@link claim} / {@link claimDigest} run first
     * unless told `skipReap`, exposed so a dispatcher can run it once per pass
     * instead of once per (partition × claim kind).
     *
     * Safe at any moment and from any number of nodes: it moves only rows already
     * past their timeout, {@link claim} takes only `pending` rows, and an
     * {@link ack} whose claim was reaped matches nothing and is refused (#11859).
     *
     * Optional, so an outbox written before it keeps working unchanged: the
     * dispatcher probes for it and, when it is absent, lets every claim reap as
     * before — correct, at the per-claim cost. Both built-in stores implement it.
     */
    reap?(opts: ReapOptions): Promise<void>;
    claim(opts: ClaimOptions): Promise<ClaimedDeliveryRecord[]>;
    /**
     * Record the outcome of ONE dispatch attempt on a row this caller claimed,
     * by handing back the record {@link claim} / {@link claimDigest} returned.
     *
     * ⛔ **Precondition: the row MUST still be held by the claim `claimed`
     * came from.** That is two tests, both re-stated IN the conditional write:
     * the row is `in_flight`, AND its (`claimed_by`, `claimed_at`) pair equals
     * the credential on the record handed back. Acking a row in any other
     * status — an unclaimed `pending` row, or one already terminal — throws
     * {@link NotificationAckError}, writes nothing, and leaves `attempts`
     * untouched; so does a late ack whose claim was reaped and re-claimed
     * (#11859): `status = 'in_flight'` alone could not tell "claimed" from
     * "claimed by the caller", so a node whose send outran `claimTtlMs` wrote
     * its outcome over the re-claiming node's live attempt. `ack` is the
     * dispatcher's completion callback, NOT a cancellation primitive: using it
     * to flip a `pending` row to `suppressed` raced the dispatcher and
     * recorded an attempt that never happened (#11453). A record whose id
     * matches no row is not a contract violation and stays a silent no-op —
     * an absent row has no state to corrupt and no claim to lose.
     *
     * Only `claimed.id` and the credential are trusted; every other field on
     * the record may be stale by the time the ack runs, and implementations
     * MUST re-read what they need (e.g. `attempts`) from the store.
     *
     * Implementations MUST make the transition atomic against {@link claim}:
     * the ownership test and the write are one operation, never a
     * read-then-write.
     */
    ack(claimed: ClaimedDeliveryRecord, result: AckResult): Promise<void>;
    list(filter?: { status?: DeliveryStatus; notificationId?: string }): Promise<NotificationDeliveryRecord[]>;
    /**
     * P3b-2: atomically claim **all** due batched rows (those with a `digestKey`)
     * in scope, so the dispatcher can collapse same-key rows into one message.
     * Like {@link claim} it flips rows to `in_flight` and respects `partition` /
     * `nextAttemptAt`; unlike it, it returns *only* digest rows and is not
     * `limit`-bounded per group (a window must be claimed whole). Normal `claim`
     * MUST exclude digest rows so they are never sent individually.
     */
    claimDigest(opts: ClaimOptions): Promise<ClaimedDeliveryRecord[]>;
}
