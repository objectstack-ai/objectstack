// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { IDataEngine, IRealtimeService, RealtimeEventPayload } from '@objectstack/spec/contracts';
import type { WebhookTriggerType } from '@objectstack/spec/automation';
import type { EnqueueHttpInput } from '@objectstack/service-messaging';
import {
    WEBHOOK_SECRET_FIELD,
    WEBHOOK_SECRET_REFUSAL_CODE,
    WEBHOOK_SECRET_REFUSAL_STATUS,
    onCryptoProviderChange,
    readLegacySecret,
    resolveWebhookSecret,
} from './webhook-secret.js';
import {
    WEBHOOK_HEADERS_FIELD,
    readLegacyHeaders,
    resolveWebhookHeaders,
} from './webhook-headers.js';

/**
 * The authored trigger vocabulary, taken from the spec rather than restated
 * here — this file both validates authored triggers and maps events onto them,
 * so a locally-spelled union would be a second contract free to drift from the
 * one authors are validated against.
 */
type WebhookTrigger = WebhookTriggerType;

/**
 * Enqueue callback into the shared `service-messaging` HTTP outbox (ADR-0018 M3).
 * The plugin supplies one bound to `messaging.enqueueHttp(...)`; webhooks no
 * longer own a delivery outbox/dispatcher — they share the generic substrate.
 *
 * [#8069] It MUST be `MessagingService.enqueueHttp`, not `IHttpOutbox.enqueue`.
 * The enqueuer now emits two kinds of input through this one door — an ordinary
 * delivery, and a PARKED event whose subscription lost its credentials — and
 * only the messaging seam routes the second to `recordUndeliverable()`. Wired
 * to the raw outbox instead, the parked input is refused at the delivery door
 * (correctly — the alternative is a `pending` unsigned row) and the durable
 * record is lost; {@link AutoEnqueuer} reports that at `error` rather than
 * letting it pass as an ordinary enqueue failure.
 */
export type HttpEnqueueFn = (input: EnqueueHttpInput) => Promise<string>;

/**
 * Which encrypted credential a drop is about, and the words its report needs.
 *
 * Parameterised rather than duplicated because the two reports differ only in
 * the noun and the consequence clause — everything an `error` owes (the
 * consequence, concretely, and the fix) is identical, and a second hand-written
 * copy is how one of them drifts into being less actionable than the other.
 */
interface DropReason {
    /** Column the value lives in — travels in the ADR-0112 meta. */
    field: string;
    /** How the credential is named in prose. */
    noun: string;
    /** Indefinite form for "webhook X holds …". */
    article: string;
    /** What delivering anyway would mean — the harm being refused. */
    ratherThan: string;
    /** Issue this drop rule comes from. */
    issue: string;
    /** Issue pair for the repeat line. */
    issues: string;
}

const SIGNING_SECRET_CREDENTIAL: DropReason = {
    field: WEBHOOK_SECRET_FIELD,
    noun: 'signing secret',
    article: 'an encrypted signing secret',
    ratherThan: 'delivered unsigned',
    issue: '#7799',
    issues: '#7799/#8022',
};

const CUSTOM_HEADERS_CREDENTIAL: DropReason = {
    field: WEBHOOK_HEADERS_FIELD,
    noun: 'custom header map',
    article: 'encrypted custom headers',
    ratherThan: 'delivered without the headers it was authored with',
    issue: '#7986',
    issues: '#7986/#8022',
};

/**
 * Optional logger interface (subset of console / kernel logger).
 */
interface OptionalLogger {
    info?(msg: string, meta?: unknown): void;
    warn?(msg: string, meta?: unknown): void;
    debug?(msg: string, meta?: unknown): void;
    error?(msg: string, err?: unknown, meta?: unknown): void;
}

/**
 * Per-row subscription cached in memory. Mirrors a subset of the
 * `sys_webhook` object — only what the auto-enqueuer needs to match an
 * event and build an `EnqueueInput`.
 */
interface CachedSubscription {
    id: string;
    name: string;
    objectName: string | undefined; // empty = matches all objects
    triggers: Set<WebhookTrigger>;
    url: string;
    method?: string;
    headers?: Record<string, string>;
    secret?: string;
    timeoutMs?: number;
    /**
     * [#8069] Set when a credential this subscription needs could not be
     * recovered. The subscription stays CACHED — that is the change — but every
     * event it matches is written to `sys_http_delivery` as a parked `dead` row
     * carrying this text, instead of being discarded with nothing to find.
     *
     * Before this, `attachCredentials` returning false removed the row from the
     * cache entirely, so matching events found no subscription and vanished:
     * fail-closed and correct, but leaving an operator with a log line (#8043)
     * and no durable trace. A parked subscription is still fail-closed —
     * {@link secret} and {@link headers} stay unset, so nothing can be sent —
     * it is merely no longer silent.
     */
    parkedReason?: string;
}

export interface AutoEnqueuerOptions {
    /**
     * Object name holding webhook subscriptions. Defaults to `sys_webhook`,
     * the platform-objects schema authored in apps.
     */
    subscriptionsObject?: string;

    /**
     * Periodic full-cache refresh interval (ms). Belt-and-braces in case
     * the subscription-change event is missed. Default 60s.
     */
    refreshIntervalMs?: number;

    logger?: OptionalLogger;
}

/**
 * Bridge between `IRealtimeService` (`data.record.*` events emitted by
 * the engine) and `IWebhookOutbox` (durable delivery rows the dispatcher
 * picks up).
 *
 * ## Why a separate class
 * Keeps `WebhookOutboxPlugin` lean: the plugin wires services, this
 * class owns the runtime fan-out logic + subscription cache.
 *
 * ## Hot path
 * Every `engine.insert/update/delete` fires a `data.record.*` event.
 * The handler:
 *   1. Looks up matching subscriptions in an in-memory `Map<object, sub[]>`
 *      — O(1) per event, no DB hit on the write path.
 *   2. Calls `outbox.enqueue()` fire-and-forget for each match. The
 *      enqueue itself is a single INSERT, which runs *after* the user's
 *      request has already returned.
 *
 * Net cost on the write path: one synchronous Map lookup (~microseconds).
 *
 * ## Cache freshness
 * The cache is rebuilt:
 *   1. Once on `start()`.
 *   2. On every `data.record.{created,updated,deleted}` event whose
 *      object is `sys_webhook` (self-healing — when a user toggles a
 *      webhook, the handler refreshes the cache before returning).
 *   3. Periodically (default 60s) as belt-and-braces.
 *
 * For multi-node clusters this is *eventually consistent* — node B may
 * not see node A's edit for up to one cycle. That's acceptable for
 * webhook configuration changes (humans don't expect millisecond
 * propagation) and matches Hasura's behaviour.
 *
 * ## Determinism
 * `eventId` is computed from `${object}:${recordId}:${type}:${timestamp}`
 * so the outbox dedup index catches duplicates that could arise from
 * upstream replay or buggy producers — and is stable across nodes.
 *
 * An aggregate `data.records.*` event (#4639) has no record to key on, so it
 * dedups on the producer's event uuid instead: two predicate sweeps in the
 * same millisecond are genuinely different events and must not collapse into
 * one delivery, which a timestamp-based key would do.
 */
export class AutoEnqueuer {
    private readonly subscriptions = new Map<string, CachedSubscription[]>();
    private readonly subscriptionsObject: string;
    private readonly refreshIntervalMs: number;
    private readonly logger: OptionalLogger;
    private subId: string | undefined;
    private subIdSelfHeal: string | undefined;
    private refreshTimer: ReturnType<typeof setInterval> | undefined;
    private running = false;
    private refreshing: Promise<void> | undefined;
    /** [#8022] Detach for the engine's crypto-registration listener. */
    private unbindCryptoListener: (() => void) | undefined;
    /**
     * [#8022] Webhook ids currently dropped for an unresolvable credential —
     * the signing key (#7799) or, since #7986, the custom header map. ONE set
     * for both on purpose: a subscription is either armed or dropped, so a
     * per-credential ledger would let a row already silenced for its key report
     * loudly again for its headers on the very next refresh.
     * Held so the loud first report is said ONCE per outage (AGENTS.md
     * "Degradation log levels": *say it once, at the first degradation*) and
     * again if the same webhook breaks after recovering — not once per row per
     * refresh, forever.
     */
    private readonly droppedForSecret = new Set<string>();

    constructor(
        private readonly engine: IDataEngine,
        private readonly realtime: IRealtimeService,
        private readonly enqueue: HttpEnqueueFn,
        opts: AutoEnqueuerOptions = {},
    ) {
        this.subscriptionsObject = opts.subscriptionsObject ?? 'sys_webhook';
        this.refreshIntervalMs = opts.refreshIntervalMs ?? 60_000;
        this.logger = opts.logger ?? {};
    }

    /**
     * Load the subscription cache and start listening for events.
     */
    async start(): Promise<void> {
        if (this.running) return;
        this.running = true;

        // [#8022] Bound BEFORE the first build, not after: on every host the
        // composition root wires the CryptoProvider after `runtime.start()`
        // returns, i.e. after the `kernel:ready` handler that runs this method
        // — so the registration we need to hear about can land at any point
        // from here on, including while the await below is still in flight.
        // Subscribing first makes that unmissable; subscribing after the
        // refresh would reintroduce the same race in miniature.
        this.unbindCryptoListener = onCryptoProviderChange(this.engine, () =>
            this.rearmAfterCryptoRegistered(),
        );

        await this.refresh();

        // Main subscription: every data event → match → enqueue.
        this.subId = await this.realtime.subscribe(
            'webhook-auto-enqueuer',
            (event) => this.handleEvent(event),
        );

        // Self-healing: any change to sys_webhook refreshes the cache.
        this.subIdSelfHeal = await this.realtime.subscribe(
            'webhook-auto-enqueuer-self-heal',
            (event) => this.handleSelfHealEvent(event),
            { object: this.subscriptionsObject },
        );

        if (this.refreshIntervalMs > 0) {
            this.refreshTimer = setInterval(() => {
                this.refresh().catch((err) =>
                    this.logger.warn?.('[webhook-auto-enqueuer] periodic refresh failed', err),
                );
            }, this.refreshIntervalMs);
            // Don't keep the process alive solely for this timer.
            this.refreshTimer.unref?.();
        }
    }

    async stop(): Promise<void> {
        if (!this.running) return;
        this.running = false;
        if (this.subId) await this.realtime.unsubscribe(this.subId);
        if (this.subIdSelfHeal) await this.realtime.unsubscribe(this.subIdSelfHeal);
        if (this.refreshTimer) clearInterval(this.refreshTimer);
        this.unbindCryptoListener?.();
        this.subId = undefined;
        this.subIdSelfHeal = undefined;
        this.refreshTimer = undefined;
        this.unbindCryptoListener = undefined;
    }

    /**
     * [#8022] The engine just gained a CryptoProvider — rebuild the cache so
     * subscriptions dropped for an unresolvable signing key re-arm now, instead
     * of at the next periodic refresh up to {@link refreshIntervalMs} away.
     *
     * It deliberately does NOT call {@link refresh} directly. `refresh()`
     * coalesces onto an in-flight build, and the build most likely to be in
     * flight right now is the one from `start()` — the very build whose rows
     * were read while there was no provider. Joining it would return "refreshed"
     * having re-armed nothing, which is this issue with an extra step. So: let
     * whatever is running finish, then read again.
     */
    private rearmAfterCryptoRegistered(): void {
        const inFlight = this.refreshing ?? Promise.resolve();
        void inFlight
            // A failed in-flight refresh already logged; it must not stop the
            // re-arm, which is the whole point of this callback.
            .catch(() => undefined)
            .then(() => (this.running ? this.refresh() : undefined))
            .catch((err) =>
                this.logger.warn?.(
                    '[webhook-auto-enqueuer] re-arm after CryptoProvider registration failed',
                    err,
                ),
            );
    }

    /**
     * Force-refresh the subscription cache from storage. Concurrent
     * callers share a single in-flight refresh.
     */
    async refresh(): Promise<void> {
        if (this.refreshing) return this.refreshing;
        this.refreshing = this.doRefresh().finally(() => {
            this.refreshing = undefined;
        });
        return this.refreshing;
    }

    private async doRefresh(): Promise<void> {
        let rows: any[];
        try {
            rows = await this.engine.find(this.subscriptionsObject, {
                where: { active: true },
            });
        } catch (err) {
            this.logger.warn?.(
                `[webhook-auto-enqueuer] failed to load ${this.subscriptionsObject}`,
                err,
            );
            return;
        }

        const next = new Map<string, CachedSubscription[]>();
        for (const row of rows) {
            const sub = this.parseRow(row);
            if (!sub) continue;
            // [#7799, #7986] Neither credential is in the row we just read —
            // the signing key and the custom header map both live encrypted in
            // `sys_secret`, and this read path returns only a mask. Dereference
            // them here, on the 60s refresh, rather than per event: the cache
            // already holds the plaintext in memory (it always did), so this
            // changes where the values come FROM, not how long they are held. A
            // row whose credentials cannot be recovered is PARKED — cached with
            // `parkedReason` set and no credentials, so its events are recorded
            // as undeliverable instead of silently discarded (#8069). See
            // `attachCredentials`.
            await this.attachCredentials(sub, row);
            // Empty objectName == "any object" → indexed under '*'.
            const key = sub.objectName ?? '*';
            const arr = next.get(key) ?? [];
            arr.push(sub);
            next.set(key, arr);
        }

        this.subscriptions.clear();
        for (const [k, v] of next) this.subscriptions.set(k, v);

        // [#8022] Forget rows this refresh no longer sees — deleted, or
        // deactivated. Otherwise the set grows for the life of the process, and
        // a webhook turned off while broken and later turned back on still
        // broken would have its first report suppressed as a repeat.
        if (this.droppedForSecret.size > 0) {
            const live = new Set(rows.map((r) => String(r?.id)));
            for (const id of this.droppedForSecret) {
                if (!live.has(id)) this.droppedForSecret.delete(id);
            }
        }

        this.logger.debug?.('[webhook-auto-enqueuer] cache refreshed', {
            objects: this.subscriptions.size,
            rows: rows.length,
        });
    }

    /**
     * [#7799, #7986] Resolve BOTH encrypted credentials for one cached
     * subscription. Returns `false` when the subscription must be dropped from
     * the cache.
     *
     * The two halves are deliberately resolved on the SAME build rather than on
     * separate schedules. #8022's re-arm rebuilds the whole cache when a
     * CryptoProvider registers; a header map recovered on any other cadence
     * would let the enqueuer re-arm into a delivery that is correctly signed and
     * silently missing its `Authorization`, which is the failure mode of both
     * cards at once.
     *
     * The drop ledger is cleared only when BOTH succeed — otherwise a row whose
     * secret resolves and whose headers do not would clear its own "already
     * reported" mark on every refresh and shout the same `error` every 60s,
     * which is precisely the unreadable-error-channel failure #8022's say-once
     * rule exists to prevent.
     *
     * Cost: up to two point reads + two decrypts per credential-bearing row per
     * refresh (default 60s), off the write path entirely. Deliberately NOT
     * memoised across refreshes — the only cheap cache key would be
     * `updated_at`, which nothing guarantees is stamped when a credential is
     * rotated, and a stale key signs every delivery with a signature the
     * receiver rejects.
     */
    private async attachCredentials(sub: CachedSubscription, row: any): Promise<boolean> {
        if (!(await this.attachSecret(sub, row))) return false;
        if (!(await this.attachHeaders(sub, row))) return false;
        // Recovered — a later break is a new outage and gets said loudly again
        // rather than being swallowed as a repeat.
        this.droppedForSecret.delete(sub.id);
        return true;
    }

    /**
     * [#8069] Mark a subscription parked and strip anything sendable off it.
     *
     * Called from the two `attachX` failure paths, which each already reported
     * the drop at `error` (say-once, #8022). The credentials are cleared rather
     * than merely "not set": `attachSecret` can succeed and `attachHeaders`
     * fail, and a parked row must not carry the header map — that map is the
     * ordinary place an `Authorization: Bearer …` goes (#7986), and copying it
     * onto a row that will sit in `sys_http_delivery` for the full 30d
     * retention window without ever being sent is a credential copy bought for
     * nothing.
     */
    /**
     * [#8069] Report a failed outbox write off the hot path, at the level the
     * loss actually deserves.
     *
     * AGENTS.md decides that with one question — *does the system still look
     * normal from the outside while something it claims is persisted has not
     * landed?* For a PARKED subscription the answer is unambiguously yes, and
     * worse than for an ordinary enqueue failure: the durable record is the
     * only trace this event ever existed, so losing the write puts us back
     * exactly where this issue started, silently. So `error` there, and the
     * pre-existing `warn` for an ordinary enqueue, where the delivery itself is
     * the thing that did not happen and the subscription is otherwise healthy.
     *
     * The realistic cause of the parked branch is a host that wired
     * {@link HttpEnqueueFn} straight to `IHttpOutbox.enqueue` instead of
     * `MessagingService.enqueueHttp`: only the messaging seam routes a parked
     * input to `recordUndeliverable()`, and the raw delivery door refuses the
     * discriminator rather than minting a `pending` unsigned row from it. The
     * message names that, because it is not guessable from "enqueue failed".
     */
    private reportWriteFailure(
        sub: CachedSubscription,
        eventId: string,
        err: unknown,
        verb: string,
    ): void {
        const meta = { webhook: sub.name, eventId, err: (err as Error)?.message ?? err };
        if (!sub.parkedReason) {
            this.logger.warn?.(`[webhook-auto-enqueuer] ${verb} failed`, meta);
            return;
        }
        const message =
            `[webhook-auto-enqueuer] could not record the undeliverable event for webhook `
            + `'${sub.name}' — the subscription is parked for an unresolvable credential, and this `
            + `event is now DISCARDED WITH NO TRACE in sys_http_delivery, which is the durability `
            + `gap #8069 closes. Most likely cause: the enqueue callback was wired directly to `
            + `IHttpOutbox.enqueue instead of MessagingService.enqueueHttp — only the messaging seam `
            + `routes a parked event to recordUndeliverable(), and the delivery door refuses it `
            + `rather than minting a pending row that would be sent UNSIGNED.`;
        if (typeof this.logger.error === 'function') {
            this.logger.error(message, err, meta);
        } else {
            this.logger.warn?.(message, meta);
        }
    }

    private park(sub: CachedSubscription, err: unknown, credential: DropReason): void {
        sub.secret = undefined;
        sub.headers = undefined;
        sub.parkedReason =
            `[${WEBHOOK_SECRET_REFUSAL_CODE}/${WEBHOOK_SECRET_REFUSAL_STATUS}] webhook '${sub.name}' `
            + `holds ${credential.article} that could not be decrypted, so this event was NOT `
            + `delivered — recording it here rather than ${credential.ratherThan} (${credential.issue}, `
            + `#8069). This row was never sent and cannot be redelivered: it carries no HMAC signature, `
            + `because the ${credential.noun} that would have produced one is exactly what is missing. `
            + `Fix: register a CryptoProvider (engine.setCryptoProvider — LocalCryptoProvider in dev, `
            + `KMS/Vault in production) with the same key the ${credential.noun} was written under, and `
            + `make sure the sys_secret row is reachable; the subscription re-arms on registration `
            + `(#8022) and at the next periodic refresh, and later events are delivered normally. `
            + `Cause: ${(err as Error)?.message ?? String(err)}`;
    }

    /**
     * [#7799] Resolve `sub.secret`. Returns `false` when the subscription must
     * be dropped.
     *
     * Three sources, in order:
     *  1. `sys_webhook.signing_secret` — the encrypted column. The read path
     *     returns a mask, so presence is decidable here but the value is not;
     *     `resolveWebhookSecret` dereferences it server-side.
     *  2. `definition_json.secret` — a row not yet swept by
     *     `migrateLegacyWebhookSecrets` (or hand-edited back in). Still honoured
     *     so an un-migrated deployment keeps signing, and warned about once per
     *     refresh so the exposure is visible rather than silently permanent.
     *  3. Neither — an unsigned webhook, which is a legitimate authored choice
     *     (`secret` is optional on the envelope).
     *
     * A stored-but-unresolvable key DROPS the subscription instead of
     * delivering unsigned. The signature is the receiver's only proof of
     * origin (#7722, #7799): a webhook that stops arriving is visible and gets
     * investigated, while one that keeps arriving unsigned is invisible and
     * teaches the receiver to accept unauthenticated traffic.
     *
     * [#8542] Case 3 means what it says only because the seam was fixed to say
     * it. `resolveWebhookSecret` used to answer `undefined` for BOTH "no key is
     * stored" and "a key is stored and did not come back", so this method read
     * the second as the third and armed the subscription — the invariant above
     * failing OPEN, silently, on the producer path. Nothing here changed: the
     * seam now raises for that case, so it lands in the `catch` below exactly
     * the way a throwing resolver already did, and the drop, the say-once
     * `error` and the #8069 park all apply to it unchanged.
     */
    private async attachSecret(sub: CachedSubscription, row: any): Promise<boolean> {
        try {
            const stored = await resolveWebhookSecret(this.engine, row, this.subscriptionsObject);
            if (stored) {
                sub.secret = stored;
                return true;
            }
        } catch (err) {
            this.reportDrop(sub, err, SIGNING_SECRET_CREDENTIAL);
            this.park(sub, err, SIGNING_SECRET_CREDENTIAL);
            return false;
        }

        const legacy = readLegacySecret(row?.definition_json);
        if (legacy) {
            this.logger.warn?.(
                `[webhook-auto-enqueuer] webhook '${sub.name}' still carries its signing secret as ` +
                    `CLEARTEXT in definition_json, readable over the data API (#7799). Signing continues ` +
                    `from it; run the boot sweep (migrateLegacyWebhookSecrets) with a CryptoProvider wired ` +
                    `to move it into sys_secret.`,
                { id: sub.id },
            );
            sub.secret = legacy;
        }
        return true;
    }

    /**
     * [#7986] Resolve `sub.headers` from the encrypted column, with the same
     * three-source shape as {@link attachSecret} and for the same reasons.
     *
     * A stored-but-unresolvable header map DROPS the subscription rather than
     * delivering without it. That is the identical trade #7799 made for the
     * signature, and it needs restating because the intuition runs the other
     * way: a missing `Authorization` looks self-announcing, since the receiver
     * answers 401 and the attempt lands in `sys_http_delivery` for anyone to
     * find. But that is only the AUTHENTICATED case. Against an endpoint that
     * does not require the header — a routing `X-Tenant-Id`, an
     * `X-Environment: staging` — the delivery SUCCEEDS while quietly deviating
     * from the configuration the author wrote, and nothing anywhere records
     * that it went out incomplete. A subscription that stops is visible; a
     * delivery that arrives subtly wrong is not.
     *
     * [#8558] And that is what this method used to do, for the same reason its
     * signing sibling did (#8542): `resolveWebhookHeaders` answered `undefined`
     * for BOTH "no headers are stored" and "a map is stored and did not come
     * back as one", so this method read the second as the first and armed the
     * subscription — the paragraph above failing OPEN. Measured, the delivery
     * then went out SUCCESSFULLY and correctly SIGNED with the whole authored
     * map missing, which is the worst available combination: the signature
     * tells the receiver the request is genuinely ours. Nothing here changed:
     * the seam now raises, so it lands in the `catch` below exactly the way a
     * throwing resolver already did, and the drop, the say-once `error` and the
     * #8069 park all apply to it unchanged.
     */
    private async attachHeaders(sub: CachedSubscription, row: any): Promise<boolean> {
        try {
            const stored = await resolveWebhookHeaders(this.engine, row, this.subscriptionsObject);
            if (stored) {
                sub.headers = stored;
                return true;
            }
        } catch (err) {
            this.reportDrop(sub, err, CUSTOM_HEADERS_CREDENTIAL);
            this.park(sub, err, CUSTOM_HEADERS_CREDENTIAL);
            return false;
        }

        const legacy = readLegacyHeaders(row?.definition_json);
        if (legacy) {
            this.logger.warn?.(
                `[webhook-auto-enqueuer] webhook '${sub.name}' still carries its custom headers as ` +
                    `CLEARTEXT in definition_json, readable over the data API (#7986) — that map is the ` +
                    `ordinary place an Authorization header goes. Delivery continues from it; run the boot ` +
                    `sweep (migrateLegacyWebhookSecrets) with a CryptoProvider wired to move them into ` +
                    `sys_secret.`,
                { id: sub.id },
            );
            sub.headers = legacy;
        }
        return true;
    }

    /**
     * [#8022] Report a subscription dropped for an unresolvable signing key.
     *
     * ## Why `error`, and why only the first time
     * AGENTS.md decides the level with one question: *after the degradation,
     * does the system still look normal from the outside while something the
     * system claims is happening is not?* Here the answer is yes, and it is the
     * whole defect — `GET /api/v1/data/sys_webhook` keeps reading
     * `active: true`, Setup keeps showing the webhook armed, and every matching
     * record change is discarded with no delivery and no `sys_http_delivery`
     * row to find afterwards. That is a durability degradation wearing a
     * functional degradation's clothes, so it owes the two things an `error`
     * owes: the consequence, concretely, and the fix.
     *
     * Said ONCE per outage per webhook, per the same section. The cache is
     * rebuilt every {@link refreshIntervalMs}; an unfixed misconfiguration would
     * otherwise print this line every 60s forever, which is how an `error`
     * channel becomes unreadable — the failure mode that made the founding
     * incident's `warn` invisible. Repeats drop to `debug`; a recovery clears
     * the id, so a re-break is loud again.
     *
     * ADR-0112: `code` + `status` travel in the meta so a consumer branches on
     * the pair, not on message text. Same pair the seeder's refusal carries for
     * the same underlying cause.
     */
    private reportDrop(
        sub: CachedSubscription,
        err: unknown,
        credential: DropReason = SIGNING_SECRET_CREDENTIAL,
    ): void {
        const meta = {
            id: sub.id,
            webhook: sub.name,
            field: credential.field,
            code: WEBHOOK_SECRET_REFUSAL_CODE,
            status: WEBHOOK_SECRET_REFUSAL_STATUS,
            err: (err as Error)?.message ?? err,
        };
        if (this.droppedForSecret.has(sub.id)) {
            this.logger.debug?.(
                `[webhook-auto-enqueuer] webhook '${sub.name}' is still dropped for an unresolvable ` +
                    `${credential.noun} (${credential.issues})`,
                meta,
            );
            return;
        }
        this.droppedForSecret.add(sub.id);
        // [#8069] The consequence clause used to end "…with NO delivery and NO
        // sys_http_delivery row". The second half is no longer true — that is
        // precisely what this card changed — and an `error` that misdescribes
        // the consequence sends an operator looking in the wrong place, which
        // is worse than the old accurate-but-bleaker line. It now names where
        // the evidence IS.
        const message =
            `[webhook-auto-enqueuer] webhook '${sub.name}' holds ${credential.article} that ` +
            `could not be decrypted — the subscription is PARKED rather than ${credential.ratherThan} ` +
            `(${credential.issue}), so every matching record change is discarded with NO delivery, ` +
            'while the row keeps reading active:true in Setup. Each discarded event IS recorded in ' +
            'sys_http_delivery as a dead row with 0 attempts carrying this cause (#8069) — look there ' +
            'for the backlog; those rows can never be sent or redelivered, because a parked row has no ' +
            'HMAC signature. Fix: register a ' +
            'CryptoProvider (engine.setCryptoProvider — LocalCryptoProvider in dev, KMS/Vault in ' +
            `production) with the same key the ${credential.noun} was written under, and make sure the ` +
            'sys_secret row is reachable; the subscription re-arms on registration (#8022) and at the ' +
            'next periodic refresh.';
        // The logger surface is a subset of console/kernel logger — `error` is
        // optional on it, so fall back rather than silently losing the report
        // on a logger that only implements `warn`.
        if (typeof this.logger.error === 'function') {
            this.logger.error(message, err, meta);
        } else {
            this.logger.warn?.(message, meta);
        }
    }

    private parseRow(row: any): CachedSubscription | null {
        if (!row?.id || !row?.url) return null;
        // `triggers` is now authored as a multi-select (stored as an array), but
        // legacy rows stored a comma-separated string (and some drivers hand a
        // JSON-encoded array back as a string). Accept all three shapes so a
        // schema change never silently drops a subscription's events.
        const rawTriggers = row.triggers;
        let triggerList: string[];
        if (Array.isArray(rawTriggers)) {
            triggerList = rawTriggers.map((t) => String(t));
        } else {
            const s = String(rawTriggers ?? '').trim();
            if (s.startsWith('[')) {
                try {
                    const parsed = JSON.parse(s);
                    triggerList = Array.isArray(parsed) ? parsed.map((t) => String(t)) : [s];
                } catch {
                    triggerList = s.split(',');
                }
            } else {
                triggerList = s.split(',');
            }
        }
        const normalized = triggerList.map((t) => t.trim().toLowerCase()).filter(Boolean);
        // [#3196] Drop (and warn about) any trigger the enqueuer can't map to an
        // emitted record event — e.g. a legacy `sys_webhook` row authored with
        // the now-removed `undelete`/`api` values, which would otherwise sit in
        // the cache matching nothing. A loud drift-guard so a dead trigger can't
        // silently no-op again.
        const unknown = normalized.filter((t) => !DISPATCHABLE_WEBHOOK_TRIGGERS.has(t));
        if (unknown.length > 0) {
            this.logger.warn?.(
                `[webhook-auto-enqueuer] webhook '${(row.name as string) ?? row.id}' declares trigger(s) the engine never emits: ` +
                    `${unknown.join(', ')} — ignored. Dispatchable triggers: ` +
                    `${[...DISPATCHABLE_WEBHOOK_TRIGGERS].join(', ')}.`,
                { id: row.id, unknown },
            );
        }
        const triggers = new Set(
            normalized.filter((t) => DISPATCHABLE_WEBHOOK_TRIGGERS.has(t)) as WebhookTrigger[],
        );
        if (triggers.size === 0) {
            // [ADR-0078 Phase 4] No dispatchable triggers — the webhook can
            // never fire on ANY path, so say so instead of skipping silently.
            // This comment used to read "(or a manual-only webhook with
            // none)", but that mode does not exist: the `api` trigger was
            // REMOVED (#3196, `webhook.zod.ts`) precisely because there is no
            // manual fire path — the only webhook HTTP surface re-queues
            // already-failed deliveries. So a zero-trigger row is not an off
            // switch (that is `active`), it is a dead subscription that looks
            // armed in Setup. Same rule id as the author-time gate
            // (`webhook/without-triggers`) so the boot log greps into the
            // same docs. Only active rows reach parseRow, so a deliberately
            // disabled webhook stays warning-free.
            this.logger.warn?.(
                `[webhook-auto-enqueuer] webhook '${(row.name as string) ?? row.id}' has no dispatchable ` +
                    `triggers — it will NEVER fire (rule webhook/without-triggers): there is no manual fire ` +
                    `path (#3196), so this row is dead while looking armed in Setup. Declare ` +
                    `one of: ${[...DISPATCHABLE_WEBHOOK_TRIGGERS].join(', ')}, or set it inactive if it ` +
                    `should be off.`,
                { id: row.id },
            );
            return null;
        }

        // The "definition_json" field carries advanced config (timeout);
        // attempt a best-effort parse. Fall back to top-level fields where
        // present. It no longer carries either credential — the signing secret
        // (#7799) and the custom headers (#7986) are both sourced from their
        // encrypted columns by `attachCredentials`.
        let defn: Record<string, any> = {};
        if (typeof row.definition_json === 'string' && row.definition_json.length > 0) {
            try {
                defn = JSON.parse(row.definition_json) ?? {};
            } catch {
                defn = {};
            }
        }

        return {
            id: row.id as string,
            name: (row.name as string) ?? row.id,
            objectName: row.object_name ? String(row.object_name) : undefined,
            triggers,
            url: String(row.url),
            // Method is authored via a select whose option values are lowercased
            // (get/post/…); upper-case here so delivery uses a canonical HTTP
            // method regardless of whether the row was authored before or after
            // the select change (legacy rows stored 'POST').
            method: String(row.method ?? defn.method ?? 'POST').toUpperCase(),
            // `headers` and `secret` are both filled by attachCredentials()
            // from their encrypted columns, NOT read off the row — see #7799
            // (secret) and #7986 (headers).
            timeoutMs: defn.timeoutMs,
        };
    }

    /**
     * Handler for the firehose subscription.
     *
     * NOTE: we intentionally `void` the inner enqueue() so the realtime
     * publisher (and therefore the user's request) is never blocked on
     * webhook persistence.
     */
    private handleEvent(event: RealtimeEventPayload): void {
        if (!event.object) return;
        if (event.object === this.subscriptionsObject) return; // self-heal handles its own

        // [#4639] A predicate write publishes the aggregate `data.records.*`
        // instead, which has no record to describe — separate path, separate
        // trigger, separate delivery shape.
        if (event.type?.startsWith('data.records.')) {
            this.handleBulkEvent(event);
            return;
        }
        if (!event.type?.startsWith('data.record.')) return;

        const action = event.type.slice('data.record.'.length) as
            | 'created' | 'updated' | 'deleted' | string;
        const trigger = mapActionToTrigger(action);
        if (!trigger) return;

        const subs = [
            ...(this.subscriptions.get(event.object) ?? []),
            ...(this.subscriptions.get('*') ?? []),
        ];
        if (subs.length === 0) return;

        // [#4626] The envelope's `payload` IS the spec's `DataEvent`
        // (`@objectstack/spec/api`): `recordId` is a REQUIRED top-level string
        // the ObjectQL engine validates before publishing. Read it directly.
        // The old `recordId ?? id ?? after?.id ?? before?.id ?? 'unknown'`
        // chain was consumer-side tolerance for a producer that never filled
        // the contract (AGENTS.md PD #12) — and its `'unknown'` fallback
        // silently turned an unnameable record into a delivered webhook. An
        // off-contract event is now DROPPED loudly: the producer is broken and
        // gets fixed there.
        const payload = event.payload ?? {};
        const recordId = (payload as { recordId?: unknown }).recordId;
        if (typeof recordId !== 'string' || recordId === '') {
            this.logger.warn?.(
                '[webhook-auto-enqueuer] dropping off-contract data event: payload is not a DataEvent ' +
                    '(no top-level string `recordId`) — fix the producer',
                { type: event.type, object: event.object },
            );
            return;
        }

        // Deterministic eventId — same input on any node → same id.
        // Includes timestamp so two distinct updates to the same record
        // don't accidentally dedup.
        const eventId = `${event.object}:${recordId}:${action}:${event.timestamp}`;

        for (const sub of subs) {
            if (!sub.triggers.has(trigger)) continue;

            // Fire-and-forget — never await on the hot path. Map the webhook
            // delivery onto the generic HTTP-outbox shape (ADR-0018 M3):
            //  - source 'webhook' + dedupKey '<webhookId>:<eventId>' preserves
            //    the old (event_id, webhook_id) at-most-once enqueue;
            //  - refId = webhookId keeps per-webhook partition affinity / ordering;
            //  - label = event type → X-Objectstack-Event header.
            void this.enqueue({
                source: 'webhook',
                refId: sub.id,
                dedupKey: `${sub.id}:${eventId}`,
                label: event.type,
                url: sub.url,
                method: sub.method,
                headers: sub.headers,
                signingSecret: sub.secret,
                // [#8069] Set only for a PARKED subscription, and then this is
                // not an enqueue at all: the messaging seam routes it to
                // `recordUndeliverable()`, which writes a terminal `dead` row
                // with this reason and no signature. Undefined for every healthy
                // subscription, so the delivery path is byte-identical to before.
                undeliverableReason: sub.parkedReason,
                timeoutMs: sub.timeoutMs,
                // [#3946] Envelope keys are written LAST so the event payload
                // cannot rewrite them. Behaviour-neutral for the engine's own
                // publishers — since #4626 a `data.record.*` payload is a
                // `DataEvent` (`id`, `type`, `object`, `recordId`, `changes?`,
                // `after?`, `userId?`, `timestamp`), whose `object` /
                // `recordId` / `timestamp` carry the SAME values written here
                // and whose record fields stay nested under `after`. It is the
                // shape that was wrong: a publisher that flattened record
                // fields into the payload would have silently rewritten the
                // `object` / `action` / `timestamp` a subscriber receives.
                payload: {
                    ...payload,
                    object: event.object,
                    recordId,
                    action,
                    timestamp: event.timestamp,
                },
            }).catch((err) => this.reportWriteFailure(sub, eventId, err, 'enqueue'));
        }
    }

    /**
     * Handler for aggregate `data.records.*` events — a predicate write
     * (`multi: true`) that the driver reports only as an affected-row count
     * (#4639).
     *
     * Deliberately NOT folded into {@link handleEvent}'s per-record path. The
     * delivered body has no `recordId` and no record fields, so a subscriber
     * to `update` that started receiving these would get a payload missing
     * everything it reads — which is how the pre-#4626 `recordId: ''`
     * fabrication broke consumers, just arriving from the other side. A
     * webhook opts in with `bulk_update` / `bulk_delete`.
     */
    private handleBulkEvent(event: RealtimeEventPayload): void {
        const action = event.type.slice('data.records.'.length);
        const trigger = mapBulkActionToTrigger(action);
        if (!trigger) return;

        const subs = [
            ...(this.subscriptions.get(event.object!) ?? []),
            ...(this.subscriptions.get('*') ?? []),
        ];
        if (subs.length === 0) return;

        // Same contract discipline as the per-record path: the payload IS the
        // spec's `BulkDataEvent`, whose `matched` the engine validates before
        // publishing. An off-contract event is dropped loudly rather than
        // delivered with a guessed count — `matched` is the entire substance
        // of a bulk delivery, so a wrong one is worse than none.
        const payload = event.payload ?? {};
        const matched = (payload as { matched?: unknown }).matched;
        if (typeof matched !== 'number' || !Number.isInteger(matched) || matched < 0) {
            this.logger.warn?.(
                '[webhook-auto-enqueuer] dropping off-contract bulk data event: payload is not a ' +
                    'BulkDataEvent (no top-level non-negative integer `matched`) — fix the producer',
                { type: event.type, object: event.object },
            );
            return;
        }

        // A predicate write has no natural key to build a deterministic id
        // from — `${object}:${action}:${timestamp}` would collide between two
        // sweeps landing in the same millisecond, and silently drop the
        // second. The producer's own event uuid is generated once and travels
        // with the event, so it dedups redelivery of the SAME event without
        // ever conflating two distinct ones.
        const eventUuid = (payload as { id?: unknown }).id;
        if (typeof eventUuid !== 'string' || eventUuid === '') {
            this.logger.warn?.(
                '[webhook-auto-enqueuer] dropping off-contract bulk data event: payload has no ' +
                    'top-level string `id` to dedup on — fix the producer',
                { type: event.type, object: event.object },
            );
            return;
        }
        const eventId = `${event.object}:${event.type}:${eventUuid}`;

        for (const sub of subs) {
            if (!sub.triggers.has(trigger)) continue;

            void this.enqueue({
                source: 'webhook',
                refId: sub.id,
                dedupKey: `${sub.id}:${eventId}`,
                label: event.type,
                url: sub.url,
                method: sub.method,
                headers: sub.headers,
                signingSecret: sub.secret,
                // [#8069] See the per-record path — parked subscriptions record
                // an undeliverable row instead of enqueuing a delivery.
                undeliverableReason: sub.parkedReason,
                timeoutMs: sub.timeoutMs,
                // [#3946] Envelope keys last so the payload cannot rewrite them.
                payload: {
                    ...payload,
                    object: event.object,
                    matched,
                    action,
                    timestamp: event.timestamp,
                },
            }).catch((err) => this.reportWriteFailure(sub, eventId, err, 'bulk enqueue'));
        }
    }

    private handleSelfHealEvent(event: RealtimeEventPayload): void {
        if (event.object !== this.subscriptionsObject) return;
        // [#4639] A predicate write over `sys_webhook` (deactivate every
        // webhook on an object, say) changes the subscription set exactly like
        // a per-record edit does, so it must refresh the cache too — matching
        // only `data.record.` would leave the enqueuer dispatching from rows
        // the admin just turned off.
        if (!event.type?.startsWith('data.record.') && !event.type?.startsWith('data.records.')) return;
        this.refresh().catch((err) =>
            this.logger.warn?.('[webhook-auto-enqueuer] self-heal refresh failed', err),
        );
    }

    /** Test / admin accessor. */
    snapshot(): ReadonlyMap<string, ReadonlyArray<CachedSubscription>> {
        return this.subscriptions;
    }
}

function mapActionToTrigger(
    action: string,
): 'create' | 'update' | 'delete' | null {
    switch (action) {
        case 'created':
            return 'create';
        case 'updated':
            return 'update';
        case 'deleted':
            return 'delete';
        default:
            return null;
    }
}

/** [#4639] `data.records.{action}` → its opt-in bulk trigger. */
function mapBulkActionToTrigger(action: string): 'bulk_update' | 'bulk_delete' | null {
    switch (action) {
        case 'updated':
            return 'bulk_update';
        case 'deleted':
            return 'bulk_delete';
        default:
            return null;
    }
}

/** The trigger values the enqueuer can actually map from an emitted record event. */
const DISPATCHABLE_WEBHOOK_TRIGGERS: ReadonlySet<string> = new Set([
    'create',
    'update',
    'delete',
    'bulk_update',
    'bulk_delete',
]);
