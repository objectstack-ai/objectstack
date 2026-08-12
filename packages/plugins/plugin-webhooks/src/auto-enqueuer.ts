// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { IDataEngine, IRealtimeService, RealtimeEventPayload } from '@objectstack/spec/contracts';
import type { WebhookTriggerType } from '@objectstack/spec/automation';
import type { EnqueueHttpInput } from '@objectstack/service-messaging';
import { WEBHOOK_SECRET_FIELD, readLegacySecret, resolveWebhookSecret } from './webhook-secret.js';

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
 */
export type HttpEnqueueFn = (input: EnqueueHttpInput) => Promise<string>;

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
        this.subId = undefined;
        this.subIdSelfHeal = undefined;
        this.refreshTimer = undefined;
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
            // [#7799] The signing key is no longer in the row we just read — it
            // lives encrypted in `sys_secret`, and this read path returns only a
            // mask. Dereference it here, on the 60s refresh, rather than per
            // event: the cache already holds the plaintext in memory (it always
            // did), so this changes where the value comes FROM, not how long it
            // is held. A row whose key cannot be recovered is DROPPED — see
            // `attachSecret`.
            if (!(await this.attachSecret(sub, row))) continue;
            // Empty objectName == "any object" → indexed under '*'.
            const key = sub.objectName ?? '*';
            const arr = next.get(key) ?? [];
            arr.push(sub);
            next.set(key, arr);
        }

        this.subscriptions.clear();
        for (const [k, v] of next) this.subscriptions.set(k, v);

        this.logger.debug?.('[webhook-auto-enqueuer] cache refreshed', {
            objects: this.subscriptions.size,
            rows: rows.length,
        });
    }

    /**
     * [#7799] Resolve `sub.secret` for one cached subscription. Returns `false`
     * when the subscription must be dropped from the cache.
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
     * Cost: one point read + one decrypt per secret-bearing row per refresh
     * (default 60s), off the write path entirely. Deliberately NOT memoised
     * across refreshes — the only cheap cache key would be `updated_at`, which
     * nothing guarantees is stamped when a secret is rotated, and a stale key
     * signs every delivery with a signature the receiver rejects.
     */
    private async attachSecret(sub: CachedSubscription, row: any): Promise<boolean> {
        try {
            const stored = await resolveWebhookSecret(this.engine, row, this.subscriptionsObject);
            if (stored) {
                sub.secret = stored;
                return true;
            }
        } catch (err) {
            this.logger.warn?.(
                `[webhook-auto-enqueuer] webhook '${sub.name}' holds an encrypted signing secret that ` +
                    `could not be decrypted — the subscription is DROPPED rather than delivered unsigned ` +
                    `(#7799). Deliveries resume once the sys_secret row and CryptoProvider are reachable.`,
                { id: sub.id, field: WEBHOOK_SECRET_FIELD, err: (err as Error)?.message ?? err },
            );
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

        // The "definition_json" field carries advanced config (headers,
        // timeout); attempt a best-effort parse. Fall back to top-level fields
        // where present. It no longer carries the signing secret (#7799) —
        // `attachSecret` sources that from the encrypted column.
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
            headers: defn.headers,
            // `secret` is filled by attachSecret() from the encrypted column,
            // NOT read off the row — see #7799.
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
            }).catch((err) =>
                this.logger.warn?.('[webhook-auto-enqueuer] enqueue failed', {
                    webhook: sub.name,
                    eventId,
                    err: (err as Error)?.message ?? err,
                }),
            );
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
                timeoutMs: sub.timeoutMs,
                // [#3946] Envelope keys last so the payload cannot rewrite them.
                payload: {
                    ...payload,
                    object: event.object,
                    matched,
                    action,
                    timestamp: event.timestamp,
                },
            }).catch((err) =>
                this.logger.warn?.('[webhook-auto-enqueuer] bulk enqueue failed', {
                    webhook: sub.name,
                    eventId,
                    err: (err as Error)?.message ?? err,
                }),
            );
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
