// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { MessagingChannel, MessagingChannelContext, Notification, SendResult } from './channel.js';
import type { AckResult, ClaimedDeliveryRecord, INotificationOutbox, NotificationDeliveryRecord } from './outbox.js';
import { classifyDeliveryAttempt } from './backoff.js';
import { renderDigest } from './digest-render.js';

/** Minimal channel-registry surface the dispatcher needs (MessagingService satisfies it). */
export interface ChannelRegistry {
    getChannel(id: string): MessagingChannel | undefined;
}

/** A held lock; `release()` frees it, `isHeld()`/`renew()` mirror the cluster API. */
export interface DispatchLockHandle {
    release(): Promise<void> | void;
    isHeld?(): boolean;
    renew?(ttlMs: number): Promise<void> | void;
}

/** Just the slice of `IClusterService` the dispatcher uses. */
export interface DispatchCluster {
    lock: {
        acquire(key: string, opts: { ttlMs: number; waitMs: number }): Promise<DispatchLockHandle | null>;
    };
}

/**
 * Single-node fallback lock — always grants. Used when no cluster service is
 * registered, so the dispatcher runs correctly (just without cross-node
 * coordination). The per-partition serialization a single process needs is
 * already provided by the `inflightTick` guard + the outbox's atomic claim.
 */
const SINGLE_NODE_CLUSTER: DispatchCluster = {
    lock: {
        async acquire() {
            return { release() {}, isHeld: () => true, renew() {} };
        },
    },
};

export interface NotificationDispatcherLogger {
    warn: (msg: string, meta?: any) => void;
    info?: (msg: string, meta?: any) => void;
}

export interface NotificationDispatcherOptions {
    nodeId: string;
    outbox: INotificationOutbox;
    channels: ChannelRegistry;
    /** Context handed to each channel's `send()` (logger). */
    channelContext: MessagingChannelContext;
    /** Cross-node coordination. Defaults to a single-node always-grant lock. */
    cluster?: DispatchCluster;
    partitionCount?: number;
    batchSize?: number;
    intervalMs?: number;
    lockTtlMs?: number;
    claimTtlMs?: number;
    rng?: () => number;
    /** Injectable clock (ms) for deterministic tests. Defaults to Date.now. */
    now?: () => number;
    logger?: NotificationDispatcherLogger;
    /** Observability hook fired after every attempt. */
    onAttempt?: (delivery: NotificationDeliveryRecord, success: boolean) => void;
}

/**
 * NotificationDispatcher (ADR-0030 P1) — drains the `sys_notification_delivery`
 * outbox and sends each row through its channel, retrying with backoff and
 * dead-lettering once the budget is exhausted. Structurally mirrors
 * `WebhookDispatcher`: an interval loop walks `partitionCount` partitions, each
 * guarded by a per-partition cluster lock; within a held partition it claims a
 * batch (`pending → in_flight`), sends, and acks.
 *
 * At-least-once: if a channel send succeeds but the ack write fails, the row
 * reverts to pending after the claim TTL and is re-sent — the inbox channel's
 * receipt write is idempotent-friendly, and downstream channels should be too.
 */
export class NotificationDispatcher {
    private readonly opts: Required<
        Omit<NotificationDispatcherOptions, 'rng' | 'logger' | 'onAttempt' | 'cluster' | 'now'>
    > &
        Pick<NotificationDispatcherOptions, 'rng' | 'logger' | 'onAttempt' | 'now'> & { cluster: DispatchCluster };
    private timer: ReturnType<typeof setInterval> | undefined;
    private running = false;
    private inflightTick: Promise<void> | undefined;

    constructor(options: NotificationDispatcherOptions) {
        const intervalMs = options.intervalMs ?? 500;
        const lockTtlMs = options.lockTtlMs ?? intervalMs * 5;
        this.opts = {
            nodeId: options.nodeId,
            outbox: options.outbox,
            channels: options.channels,
            channelContext: options.channelContext,
            cluster: options.cluster ?? SINGLE_NODE_CLUSTER,
            partitionCount: options.partitionCount ?? 8,
            batchSize: options.batchSize ?? 32,
            intervalMs,
            lockTtlMs,
            claimTtlMs: options.claimTtlMs ?? lockTtlMs * 2,
            rng: options.rng,
            now: options.now,
            logger: options.logger,
            onAttempt: options.onAttempt,
        };
    }

    /** Begin the periodic loop. Idempotent. */
    start(): void {
        if (this.running) return;
        this.running = true;
        this.scheduleTick();
        this.timer = setInterval(() => this.scheduleTick(), this.opts.intervalMs);
        // Don't keep the event loop alive solely for the dispatcher.
        (this.timer as { unref?: () => void })?.unref?.();
    }

    /** Stop the loop and drain the in-flight tick. */
    async stop(): Promise<void> {
        if (!this.running) return;
        this.running = false;
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
        if (this.inflightTick) {
            try { await this.inflightTick; } catch { /* already logged */ }
        }
    }

    /** Run one full tick (all partitions). Exposed for deterministic tests. */
    async tick(): Promise<void> {
        await this.runTick();
    }

    private scheduleTick(): void {
        if (this.inflightTick) return;
        this.inflightTick = this.runTick()
            .catch((err) => {
                this.opts.logger?.warn?.('notification-dispatcher: tick failed', {
                    nodeId: this.opts.nodeId,
                    error: (err as Error)?.message ?? String(err),
                });
            })
            .finally(() => { this.inflightTick = undefined; });
    }

    private async runTick(): Promise<void> {
        const count = this.opts.partitionCount;
        const offset = stableNodeOffset(this.opts.nodeId, count);
        for (let step = 0; step < count; step++) {
            await this.runPartition((offset + step) % count);
        }
    }

    private async runPartition(index: number): Promise<void> {
        const handle = await this.opts.cluster.lock.acquire(`notify.dispatcher.partition.${index}`, {
            ttlMs: this.opts.lockTtlMs,
            waitMs: 0,
        });
        if (!handle) return;
        try {
            const claimed = await this.opts.outbox.claim({
                nodeId: this.opts.nodeId,
                limit: this.opts.batchSize,
                partition: { index, count: this.opts.partitionCount },
                claimTtlMs: this.opts.claimTtlMs,
            });
            if (claimed.length > 0) {
                await handle.renew?.(this.opts.lockTtlMs);
                for (const row of claimed) {
                    if (handle.isHeld && !handle.isHeld()) break;
                    await this.processRow(row);
                }
            }

            // P3b-2 digest pass: collapse due batched rows by group. Runs under
            // the same partition lock — a window's rows share a partition (keyed
            // on digest_key), so exactly one node assembles each digest.
            const digestRows = await this.opts.outbox.claimDigest({
                nodeId: this.opts.nodeId,
                limit: this.opts.batchSize,
                partition: { index, count: this.opts.partitionCount },
                claimTtlMs: this.opts.claimTtlMs,
            });
            if (digestRows.length > 0) {
                await handle.renew?.(this.opts.lockTtlMs);
                for (const group of groupByDigestKey(digestRows)) {
                    if (handle.isHeld && !handle.isHeld()) break;
                    await this.processDigestGroup(group);
                }
            }
        } finally {
            await handle.release();
        }
    }

    /**
     * Send one collapsed message for a `(recipient, channel, window)` group and
     * ack every row in it with that one outcome. On failure the whole group
     * re-defers together (each row keeps its own backoff via its `attempts`).
     */
    private async processDigestGroup(rows: ClaimedDeliveryRecord[]): Promise<void> {
        const channelName = rows[0].channel;
        const recipient = rows[0].recipientId;
        const channel = this.opts.channels.getChannel(channelName);
        if (!channel) {
            for (const row of rows) {
                await this.ackAttempt(row, { success: false, error: `channel '${channelName}' not registered`, dead: true });
                this.opts.onAttempt?.(row, false);
            }
            return;
        }

        const digest = renderDigest(rows);
        const notification: Notification = {
            notificationId: rows[0].notificationId, // representative event id
            organizationId: rows[0].organizationId,
            topic: rows[0].topic,
            title: digest.title,
            body: digest.body,
            severity: 'info',
            recipients: [recipient],
            channels: [channelName],
            payload: { digest: true, count: digest.count, items: digest.items },
        };

        let result: SendResult;
        try {
            result = await channel.send(this.opts.channelContext, { notification, channel: channelName, recipient });
        } catch (err) {
            result = { ok: false, error: (err as Error)?.message ?? String(err) };
        }

        const errorClass = !result.ok && channel.classifyError ? channel.classifyError(result.error) : undefined;
        const now = this.opts.now?.() ?? Date.now();
        for (const row of rows) {
            const ack = classifyDeliveryAttempt(result, errorClass, row.attempts, now, this.opts.rng);
            await this.ackAttempt(row, ack);
            this.opts.onAttempt?.(row, result.ok);
        }
    }

    private async processRow(row: ClaimedDeliveryRecord): Promise<void> {
        const channel = this.opts.channels.getChannel(row.channel);
        if (!channel) {
            // No transport for this channel → terminal, observable on the row.
            await this.ackAttempt(row, {
                success: false,
                error: `channel '${row.channel}' not registered`,
                dead: true,
            });
            this.opts.onAttempt?.(row, false);
            return;
        }

        const p = row.payload ?? {};
        const notification: Notification = {
            notificationId: row.notificationId,
            organizationId: row.organizationId,
            topic: row.topic,
            title: typeof p.title === 'string' ? p.title : row.topic ?? '',
            body: typeof p.body === 'string' ? p.body : '',
            severity: (p.severity as Notification['severity']) ?? 'info',
            recipients: [row.recipientId],
            channels: [row.channel],
            actionUrl: typeof p.actionUrl === 'string' ? p.actionUrl : undefined,
            payload: p,
        };

        let result: SendResult;
        try {
            result = await channel.send(this.opts.channelContext, {
                notification,
                channel: row.channel,
                recipient: row.recipientId,
            });
        } catch (err) {
            result = { ok: false, error: (err as Error)?.message ?? String(err) };
        }

        const errorClass = !result.ok && channel.classifyError ? channel.classifyError(result.error) : undefined;
        const now = this.opts.now?.() ?? Date.now();
        const ack = classifyDeliveryAttempt(result, errorClass, row.attempts, now, this.opts.rng);
        await this.ackAttempt(row, ack);
        this.opts.onAttempt?.(row, result.ok);
    }

    /**
     * [#11453] Record one attempt's outcome, tolerating the ONE refusal a
     * correct dispatcher can legitimately provoke.
     *
     * `ack()` now refuses a row that is not `in_flight`, and this loop can meet
     * that honestly: a send slower than `claimTtlMs` lets the visibility-timeout
     * reap return the row to `pending` for another node, so by the time we ack,
     * the row is not ours. That is a race we are ALLOWED to lose — the delivery
     * is re-driven by whoever holds the row now, which is what at-least-once
     * means — and the refusal is the outbox correctly declining to overwrite
     * someone else's state.
     *
     * ⛔ What it must not do is abort the tick. The rows still validly claimed
     * by this node are processed after this one; letting a lost race unwind the
     * partition loop would strand every one of them `in_flight` until their own
     * timeouts expire, turning one lost race into a batch-wide delay.
     *
     * Only `DELIVERY_NOT_ELIGIBLE` is absorbed. A store fault is not a lost
     * race and still propagates to `runTick`'s handler.
     */
    private async ackAttempt(row: ClaimedDeliveryRecord, result: AckResult): Promise<void> {
        try {
            // [#11859] The record is handed back WHOLE: its (claimedBy,
            // claimedAt) pair is the claim credential the store stamped, and
            // the ack's compare-and-set binds it — this loop never needs to
            // know or repeat its own nodeId.
            await this.opts.outbox.ack(row, result);
        } catch (err) {
            if ((err as { code?: string })?.code !== 'DELIVERY_NOT_ELIGIBLE') throw err;
            this.opts.logger?.warn?.('notification-dispatcher: ack refused, claim no longer held', {
                nodeId: this.opts.nodeId,
                deliveryId: row.id,
                error: (err as Error)?.message ?? String(err),
            });
        }
    }
}

/** Group claimed digest rows by their `digestKey` (insertion order preserved). */
function groupByDigestKey(rows: ClaimedDeliveryRecord[]): ClaimedDeliveryRecord[][] {
    const groups = new Map<string, ClaimedDeliveryRecord[]>();
    for (const r of rows) {
        const key = r.digestKey ?? r.id; // defensive — claimDigest only returns keyed rows
        let g = groups.get(key);
        if (!g) { g = []; groups.set(key, g); }
        g.push(r);
    }
    return [...groups.values()];
}

/** Spread the starting partition per node so contention rotates fairly. */
function stableNodeOffset(nodeId: string, partitionCount: number): number {
    let h = 0;
    for (let i = 0; i < nodeId.length; i++) h = (h * 31 + nodeId.charCodeAt(i)) | 0;
    return Math.abs(h) % partitionCount;
}
