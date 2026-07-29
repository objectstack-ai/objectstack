// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { IDataEngine, IRealtimeService, RealtimeEventPayload } from '@objectstack/spec/contracts';
import type { EnqueueHttpInput } from '@objectstack/service-messaging';

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
    triggers: Set<'create' | 'update' | 'delete'>;
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
                    `${unknown.join(', ')} — ignored. Dispatchable triggers: create, update, delete.`,
                { id: row.id, unknown },
            );
        }
        const triggers = new Set(
            normalized.filter((t) => DISPATCHABLE_WEBHOOK_TRIGGERS.has(t)) as Array<'create' | 'update' | 'delete'>,
        );
        if (triggers.size === 0) {
            // No dispatchable triggers (or a manual-only webhook with none) —
            // skip auto-enqueue.
            return null;
        }

        // The "definition_json" field carries advanced config (headers,
        // secret, timeout); attempt a best-effort parse. Fall back to
        // top-level fields where present.
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
            secret: defn.secret,
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
        if (!event.type?.startsWith('data.record.')) return;
        if (!event.object) return;
        if (event.object === this.subscriptionsObject) return; // self-heal handles its own

        const action = event.type.slice('data.record.'.length) as
            | 'created' | 'updated' | 'deleted' | string;
        const trigger = mapActionToTrigger(action);
        if (!trigger) return;

        const subs = [
            ...(this.subscriptions.get(event.object) ?? []),
            ...(this.subscriptions.get('*') ?? []),
        ];
        if (subs.length === 0) return;

        const payload = event.payload ?? {};
        const recordId =
            (payload as any).recordId ??
            (payload as any).id ??
            (payload as any).after?.id ??
            (payload as any).before?.id ??
            'unknown';

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
                // publishers — `data.record.*` payloads are
                // `{ recordId, after, changes }`, with record fields nested
                // under `after`, so none of these four keys collide today. It
                // is the shape that was wrong: a publisher that flattened
                // record fields into the payload (the `payload.id` fallback
                // above suggests some do) would have silently rewritten the
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

    private handleSelfHealEvent(event: RealtimeEventPayload): void {
        if (event.object !== this.subscriptionsObject) return;
        if (!event.type?.startsWith('data.record.')) return;
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

/** The trigger values the enqueuer can actually map from an emitted record event. */
const DISPATCHABLE_WEBHOOK_TRIGGERS: ReadonlySet<string> = new Set(['create', 'update', 'delete']);
