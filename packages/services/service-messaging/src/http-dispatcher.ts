// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { DispatchCluster, DispatchLockHandle } from './dispatcher.js';
import { DispatchLoop } from './dispatch-loop.js';
import { classifyAttempt, sendOnce, type FetchImpl } from './http-sender.js';
import type { HttpDelivery, IHttpOutbox } from './http-outbox.js';

/**
 * HttpDispatcher (ADR-0018 M3) — drains the generic outbound-HTTP outbox
 * (`sys_http_delivery`) and POSTs each row, retrying with backoff and
 * dead-lettering once the budget is exhausted.
 *
 * Structurally identical to `NotificationDispatcher` / `WebhookDispatcher`: a
 * timer loop walks `partitionCount` partitions, each guarded by a
 * per-partition cluster lock; within a held partition it claims a batch
 * (`pending → in_flight`), sends, and acks. Partition affinity is on the
 * delivery's `refId`, preserving in-order delivery per source anchor.
 *
 * At-least-once: if the POST succeeds but the ack write fails, the row reverts
 * to pending after the claim TTL and is re-posted. Receivers MUST be idempotent
 * on the `X-Objectstack-Delivery` (== row id) header.
 *
 * ## What an idle tick costs (#17623)
 *
 * Against an empty outbox one tick is `1 + partitionCount` store round trips:
 * ONE visibility-timeout reap for the whole environment, then a candidate probe
 * per partition. The reap used to open every partition's claim —
 * `partitionCount` identical environment-wide UPDATEs a tick, 8 of the 16
 * statements a tick issued with the default 8 partitions — on a fixed 500 ms
 * interval that never let up, one loop per warm kernel: the shape #17610 had
 * just removed from `NotificationDispatcher`. Both dispatchers now run the same
 * {@link DispatchLoop}, which backs off while idle
 * ({@link HttpDispatcherOptions.maxIdleIntervalMs}); {@link HttpDispatcher.wake}
 * — which the messaging service calls when `enqueueHttp()` or
 * `redeliverHttp()` leaves a row pending — runs the next tick at once.
 */

const SINGLE_NODE_CLUSTER: DispatchCluster = {
    lock: {
        async acquire() {
            return { release() {}, isHeld: () => true, renew() {} };
        },
    },
};

export interface HttpDispatcherLogger {
    warn: (msg: string, meta?: any) => void;
    info?: (msg: string, meta?: any) => void;
}

export interface HttpDispatcherOptions {
    /** Stable id identifying this dispatcher node. */
    nodeId: string;
    /** Outbox backend. */
    outbox: IHttpOutbox;
    /** Cross-node coordination. Defaults to a single-node always-grant lock. */
    cluster?: DispatchCluster;
    /** Partitions to split work across (must match the outbox's). Default 8. */
    partitionCount?: number;
    /** Max rows to claim from each partition per tick. Default 32. */
    batchSize?: number;
    /** Tick interval in ms while ticks find work. Default 500. */
    intervalMs?: number;
    /**
     * [#17623] Idle backoff ceiling in ms (default `DEFAULT_MAX_IDLE_INTERVAL_MS`,
     * 30 s — the notification dispatcher's). Each loop tick that claims nothing
     * doubles the delay before the next one, from `intervalMs` up to this; a
     * tick that claims anything, or a {@link HttpDispatcher.wake} call, snaps it
     * back to `intervalMs`. A value at or below `intervalMs` disables the backoff.
     *
     * While idle this bounds how late the loop notices work nobody woke it for:
     *  - a retry coming due — attempted less than `min(its delay + intervalMs,
     *    maxIdleIntervalMs)` after it is due (plus the time ticks themselves
     *    take), because the backoff restarts from `intervalMs` at the attempt
     *    that scheduled the retry;
     *  - a row enqueued by a process this dispatcher does not serve;
     *  - a crashed node's `in_flight` rows — reaped at most `claimTtlMs` + this
     *    after their claim, where the fixed interval gave `claimTtlMs` +
     *    `intervalMs`.
     */
    maxIdleIntervalMs?: number;
    /** Per-partition lock TTL. Default = 5 × intervalMs. */
    lockTtlMs?: number;
    /** Visibility timeout for claimed rows. Default = 2 × lockTtlMs. */
    claimTtlMs?: number;
    /** Override `globalThis.fetch` (tests). */
    fetchImpl?: FetchImpl;
    /** RNG override for the retry-jitter schedule (tests). */
    rng?: () => number;
    /** Injectable clock (ms) for deterministic tests. Defaults to Date.now. */
    now?: () => number;
    /** Logger callback (optional). */
    logger?: HttpDispatcherLogger;
    /** Hook fired after every attempt — observability hook. */
    onAttempt?: (delivery: HttpDelivery, success: boolean) => void;
}

export class HttpDispatcher {
    private readonly opts: Required<
        Omit<HttpDispatcherOptions, 'fetchImpl' | 'rng' | 'logger' | 'onAttempt' | 'cluster' | 'now' | 'maxIdleIntervalMs'>
    > &
        Pick<HttpDispatcherOptions, 'fetchImpl' | 'rng' | 'logger' | 'onAttempt' | 'now'> & {
            cluster: DispatchCluster;
        };
    /** [#17623] The timer loop — idle backoff, wake, stop — shared with `NotificationDispatcher`. */
    private readonly loop: DispatchLoop;

    constructor(options: HttpDispatcherOptions) {
        const intervalMs = options.intervalMs ?? 500;
        const lockTtlMs = options.lockTtlMs ?? intervalMs * 5;
        this.opts = {
            nodeId: options.nodeId,
            outbox: options.outbox,
            cluster: options.cluster ?? SINGLE_NODE_CLUSTER,
            partitionCount: options.partitionCount ?? 8,
            batchSize: options.batchSize ?? 32,
            intervalMs,
            lockTtlMs,
            claimTtlMs: options.claimTtlMs ?? lockTtlMs * 2,
            fetchImpl: options.fetchImpl,
            rng: options.rng,
            now: options.now,
            logger: options.logger,
            onAttempt: options.onAttempt,
        };
        this.loop = new DispatchLoop({
            intervalMs,
            maxIdleIntervalMs: options.maxIdleIntervalMs,
            runTick: () => this.runTick(),
            onTickError: (err) => {
                this.opts.logger?.warn?.('http-dispatcher: tick failed', {
                    nodeId: this.opts.nodeId,
                    error: (err as Error)?.message ?? String(err),
                });
            },
        });
    }

    /** Begin the loop; the first tick runs immediately. Safe to call once; subsequent calls are no-ops. */
    start(): void {
        this.loop.start();
    }

    /** Stop the loop and wait for the in-flight tick to drain. */
    async stop(): Promise<void> {
        await this.loop.stop();
    }

    /**
     * [#17623] Work was just written: tick now and reset the idle backoff.
     *
     * The messaging service calls this after `enqueueHttp()` enqueues a
     * delivery and after `redeliverHttp()` resets one, so a callout raised in
     * this process never waits out a backed-off interval. A wake that lands
     * while a tick is running queues ONE follow-up tick for the moment it
     * settles — the running tick may already be past the partition the row
     * hashed into — and every wake in that window collapses into that one.
     * No-op while stopped.
     */
    wake(): void {
        this.loop.wake();
    }

    /** Run one full tick (the reap, then all partitions). Exposed for deterministic tests. */
    async tick(): Promise<void> {
        await this.runTick();
    }

    /** One full pass: the reap, then every partition. Resolves to the rows claimed. */
    private async runTick(): Promise<number> {
        // [#17623] Visibility-timeout recovery ONCE per tick, BEFORE any claim —
        // the arrangement #17610 made for notifications. The reap's predicate
        // names no partition, so this one run hands every claim below each row
        // that had already expired when the tick began: what reaping inside every
        // partition's claim achieved, less the rows that expire DURING this tick,
        // which the next tick's reap returns. An abandoned claim is still
        // recovered within one tick of `claimTtlMs` passing (one backed-off tick
        // while idle, see `maxIdleIntervalMs`), and never before its TTL.
        //
        // No partition lock is needed, and none was ever in force: the per-claim
        // reap, run under partition p's lock, was already rewriting expired rows
        // in every other partition. The reap moves only rows past their timeout
        // and a claim takes only `pending` rows, so running it here opens no
        // interleaving the claim TTL did not already allow.
        //
        // `reap` is optional on the outbox contract, so a store written before it
        // keeps working: without it every claim keeps reaping as it always did —
        // correct, at the per-claim cost.
        const { outbox } = this.opts;
        let reapedForTick = false;
        if (outbox.reap) {
            await outbox.reap({ claimTtlMs: this.opts.claimTtlMs, now: this.opts.now?.() });
            reapedForTick = true;
        }

        const partitionCount = this.opts.partitionCount;
        const offset = stableNodeOffset(this.opts.nodeId, partitionCount);
        let claimed = 0;
        for (let step = 0; step < partitionCount; step++) {
            const i = (offset + step) % partitionCount;
            claimed += await this.runPartition(i, reapedForTick);
        }
        return claimed;
    }

    /**
     * Claim and POST within one partition's lock. Resolves to the number of rows
     * claimed — 0 when another node holds the lock. `skipReap` is true when this
     * tick already ran the outbox's `reap()`.
     */
    private async runPartition(index: number, skipReap: boolean): Promise<number> {
        const key = `http.dispatcher.partition.${index}`;
        const handle: DispatchLockHandle | null = await this.opts.cluster.lock.acquire(key, {
            ttlMs: this.opts.lockTtlMs,
            waitMs: 0,
        });
        if (!handle) return 0;

        try {
            const claimed = await this.opts.outbox.claim({
                nodeId: this.opts.nodeId,
                limit: this.opts.batchSize,
                partition: { index, count: this.opts.partitionCount },
                claimTtlMs: this.opts.claimTtlMs,
                now: this.opts.now?.(),
                // [#17623] Reaped once for the whole tick in runTick(), when the
                // outbox has a reap() to run.
                skipReap,
            });
            if (claimed.length === 0) return 0;
            await handle.renew?.(this.opts.lockTtlMs);
            for (const row of claimed) {
                if (handle.isHeld && !handle.isHeld()) break;
                await this.processRow(row);
            }
            return claimed.length;
        } finally {
            await handle.release();
        }
    }

    private async processRow(row: HttpDelivery): Promise<void> {
        const fetchImpl = (this.opts.fetchImpl ?? (globalThis.fetch as unknown as FetchImpl)) as
            | FetchImpl
            | undefined;
        if (!fetchImpl) {
            this.opts.logger?.warn?.('http-dispatcher: no fetch impl available', { rowId: row.id });
            await this.opts.outbox.ack(row.id, {
                success: false,
                error: 'no fetch implementation',
                durationMs: 0,
                dead: true,
            });
            return;
        }
        const outcome = await sendOnce(row, fetchImpl);
        const result = classifyAttempt(outcome, row.attempts, this.opts.now?.() ?? Date.now(), this.opts.rng);
        await this.opts.outbox.ack(row.id, result);
        this.opts.onAttempt?.(row, result.success);
    }
}

/** Spread starting partition per node so nodes don't serialise on partition 0. */
function stableNodeOffset(nodeId: string, partitionCount: number): number {
    let h = 0;
    for (let i = 0; i < nodeId.length; i++) {
        h = (h * 31 + nodeId.charCodeAt(i)) | 0;
    }
    return Math.abs(h) % partitionCount;
}
