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

/**
 * Lifecycle state of a delivery row.
 *
 * [#8069] Deliberately UNCHANGED by the drop-record work. A subscription
 * dropped for an unresolvable signing secret is recorded as `dead` carrying
 * its cause in {@link HttpDelivery.error}, not as a new never-sendable member
 * of this union — the maintainer's ruling of 2026-08-12 admits a new lifecycle
 * state only if the reason column cannot carry the cause, and it can (`error`
 * is an unbounded textarea already surfaced by `sys_http_delivery`'s
 * "Failures" list view, which filters `status in (failed, dead)` and shows
 * `error` as a column). What distinguishes a parked row from a row the
 * dispatcher killed is {@link HttpDelivery.attempts} — see
 * {@link assertHttpRedeliverable}.
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
    /**
     * Number of attempts made so far (0 before first attempt).
     *
     * [#8069] **Load-bearing beyond diagnostics.** `ack()` — the only writer of
     * a terminal status — increments this unconditionally, so a row that is
     * terminal (`success` / `failed` / `dead`) with `attempts === 0` never came
     * from the dispatch path: it was **parked** by
     * {@link IHttpOutbox.recordUndeliverable} and has never existed on the
     * wire. {@link assertHttpRedeliverable} reads exactly that pair, which is
     * why this counter is part of the contract and not an implementation
     * detail. See {@link HttpDeliveryStatus} for why the pair is used instead
     * of a new lifecycle state.
     */
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
    /**
     * [#8069] Transport-only discriminator for the ONE seam that carries both
     * kinds of write — `MessagingService.enqueueHttp()`, the single function a
     * producer plugin is handed. When set, this is **not a delivery**: the
     * producer could not obtain the credentials this delivery needed, and the
     * seam routes the input to {@link IHttpOutbox.recordUndeliverable} instead
     * of {@link IHttpOutbox.enqueue}.
     *
     * ⛔ It never reaches `enqueue()`. Both implementations reject it there
     * (see {@link assertEnqueueDeliverable}) rather than ignoring it, because
     * an ignored discriminator is exactly how a row that must never be sent
     * gets minted `pending` — the shape this issue exists to prevent.
     */
    undeliverableReason?: string;
}

/**
 * [#8069] Input for a PARKED row — a delivery that was never sendable, written
 * so the drop leaves a durable record instead of only a log line.
 *
 * `signingSecret` is structurally absent, not merely unused: a parked row is
 * parked *because* the secret could not be resolved, so there is nothing to
 * sign with, and a signature on such a row would be a lie. `undeliverableReason`
 * is absent too — the cause travels as the required {@link reason} here.
 */
export interface UndeliverableHttpInput
    extends Omit<EnqueueHttpInput, 'signingSecret' | 'undeliverableReason'> {
    /**
     * Why this delivery can never be sent. Lands verbatim in
     * {@link HttpDelivery.error} — the existing reason column, which the
     * `sys_http_delivery` "Failures" list view already renders.
     *
     * Owes what an AGENTS.md `error` owes: the consequence, concretely, and the
     * fix. An operator reading this row is the person who has to repair the
     * misconfiguration.
     */
    reason: string;
}

/**
 * Verdict function consulted by {@link IHttpOutbox.redeliver} BEFORE it resets
 * a row — the seam through which a producer that owns configuration the outbox
 * cannot see (a webhook's `sys_webhook` row and its encrypted signing secret)
 * gets to refuse a replay.
 *
 * Returns a human-readable refusal reason, or `undefined` to allow.
 *
 * [#8069] It exists because "is the signing configuration still available?" is
 * not answerable from the delivery row: `service-messaging` deliberately knows
 * nothing about `sys_webhook`. Putting the question here — rather than in the
 * `POST /api/v1/webhooks/redeliver` route — means every caller of
 * `redeliver()` is covered, not just the audited HTTP door. A guard that throws
 * refuses the redelivery: the row is left untouched.
 */
export type RedeliverGuard = (
    row: HttpDelivery,
) => Promise<string | undefined> | string | undefined;

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
        readonly code: 'RESOURCE_NOT_FOUND' | 'DELIVERY_NOT_ELIGIBLE' | 'DELIVERY_NEVER_SENT',
    ) {
        super(message);
        this.name = 'HttpRedeliverError';
    }
}

/**
 * [#8069] The `redeliver()` refusal, in ONE place both implementations call.
 *
 * ## What it refuses, and why that predicate
 * `redeliver` means *send this again*. A terminal row with `attempts === 0` was
 * never sent a first time — {@link IHttpOutbox.ack}, the only writer of a
 * terminal status, increments `attempts` unconditionally, so the pair
 * (terminal, 0 attempts) is reachable only through
 * {@link IHttpOutbox.recordUndeliverable}. Such a row is a **record of a
 * delivery that was refused before it ever existed on the wire**, and resetting
 * it to `pending` is not a replay: it is a FIRST delivery conjured by an
 * operator button, bypassing every check the enqueue path applies.
 *
 * ## Why this is a security refusal and not a tidiness one
 * A parked row has no {@link HttpDelivery.signature}, because the signature is
 * computed at enqueue from the very secret that could not be resolved (#7722,
 * #7799). `POST /api/v1/webhooks/redeliver` is reachable by any authenticated
 * user. Without this refusal, making the drop durable would hand that user a
 * button that delivers the webhook UNSIGNED — reopening #7799 through a door
 * nobody would think to audit. **An unsigned redelivery is strictly worse than
 * an unrecorded drop**, which is why this guard lands with — and logically
 * before — the durable record itself.
 *
 * ## Why `attempts`, not "row has no signature"
 * `signature === undefined` is AMBIGUOUS: it also means "authored unsigned",
 * which is a legitimate configuration (`secret` is optional on the webhook
 * envelope), and refusing those would break a working feature. `attempts === 0`
 * on a terminal row is unambiguous and needs no new column and no new lifecycle
 * state. It is also fail-closed under the ambiguity that remains: a parked row
 * that somehow carried a signature would still be refused.
 */
export function assertHttpRedeliverable(row: HttpDelivery): void {
    if (row.status !== 'success' && row.status !== 'failed' && row.status !== 'dead') {
        throw new HttpRedeliverError(
            `Delivery row '${row.id}' is '${row.status}', expected one of: success, failed, dead`,
            'DELIVERY_NOT_ELIGIBLE',
        );
    }
    if (row.attempts === 0) {
        throw new HttpRedeliverError(
            `Delivery row '${row.id}' was never sent — it is a PARKED record of a delivery that `
                + 'could not be prepared (0 attempts), not a delivery that failed. Reason recorded on '
                + `the row: ${row.error ?? '(none recorded)'}. Redelivering it would send the payload `
                + 'for the first time, and a parked row carries no HMAC signature because the signing '
                + 'secret it needed could not be resolved — so the delivery would go out UNSIGNED '
                + '(#7799, #8069). Fix the underlying configuration instead; the subscription re-arms '
                + 'on its own and future events are delivered signed.',
            'DELIVERY_NEVER_SENT',
        );
    }
}

/**
 * [#8069] The full pre-write refusal for `redeliver()`: the row-local check
 * above, then the producer's {@link RedeliverGuard}.
 *
 * Ordering is deliberate — the row-local refusal never needs I/O and never
 * needs a guard to be wired, so a deployment whose producer registered no guard
 * still refuses parked rows. The guard adds what the row cannot answer: whether
 * the configuration this delivery was signed against still exists.
 *
 * A guard that THROWS refuses the redelivery. That is fail-closed on purpose:
 * a guard whose own lookup failed does not know the configuration is available,
 * and "we could not check" must never read as "allowed".
 */
export async function assertRedeliverAllowed(
    row: HttpDelivery,
    guard?: RedeliverGuard,
): Promise<void> {
    assertHttpRedeliverable(row);
    if (!guard) return;
    let refusal: string | undefined;
    try {
        refusal = await guard(row);
    } catch (err) {
        throw new HttpRedeliverError(
            `Delivery row '${row.id}' cannot be redelivered: its producer's configuration check `
                + `failed, so it is unknown whether this delivery can still be signed — refusing `
                + `rather than sending (#8069). Cause: ${(err as Error)?.message ?? String(err)}`,
            'DELIVERY_NOT_ELIGIBLE',
        );
    }
    if (refusal !== undefined) {
        throw new HttpRedeliverError(
            `Delivery row '${row.id}' cannot be redelivered: ${refusal}`,
            'DELIVERY_NOT_ELIGIBLE',
        );
    }
}

/**
 * [#8069] Reject a parked-row discriminator that reached the delivery door.
 *
 * {@link EnqueueHttpInput.undeliverableReason} is routed away by
 * `MessagingService.enqueueHttp()`. If it arrives here anyway, the routing was
 * bypassed or broken, and the row about to be minted is a `pending` unsigned
 * delivery for a subscription whose credentials are missing. Refuse loudly
 * rather than silently dropping the flag.
 */
export function assertEnqueueDeliverable(input: EnqueueHttpInput): void {
    if (input.undeliverableReason !== undefined) {
        throw new Error(
            'IHttpOutbox.enqueue: input carries `undeliverableReason` — a row that must NEVER be sent '
                + 'cannot be minted `pending`. Route it to recordUndeliverable() instead (#8069). '
                + `Reason was: ${input.undeliverableReason}`,
        );
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
     * [#8069] Record a delivery that can **never** be sent, so a dropped
     * subscription leaves a durable trace instead of only a log line.
     *
     * Writes the row terminal on arrival — `status: 'dead'`, `attempts: 0`,
     * `error: input.reason`, no signature — and it is therefore never claimed
     * by a dispatcher and never redeliverable (see
     * {@link assertHttpRedeliverable}). Same `(source, dedupKey)` uniqueness as
     * {@link enqueue}, so the same event cannot produce two records.
     *
     * ## Why a second door rather than a flag on `enqueue()`
     * `enqueue()`'s contract is "insert a delivery row that the dispatcher will
     * send". A mode flag that sometimes makes it mint a terminal non-delivery
     * would make the name lie, and the failure mode of a *missed* flag is the
     * exact catastrophe this issue is about — a `pending`, unsigned row for a
     * subscription whose secret could not be resolved. Two named doors make the
     * dangerous outcome unreachable by omission rather than merely discouraged.
     */
    recordUndeliverable(input: UndeliverableHttpInput): Promise<string>;

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
     *
     * [#8069] Implementations MUST call {@link assertHttpRedeliverable} before
     * writing anything, and MUST consult `guard` — the producer's verdict on
     * whether the configuration this row depends on is still available — with
     * the same "refuse before you write" ordering. A refused redelivery leaves
     * the row exactly as it was.
     *
     * @param guard Optional producer verdict; see {@link RedeliverGuard}.
     */
    redeliver(id: string, guard?: RedeliverGuard): Promise<HttpDelivery>;
}
