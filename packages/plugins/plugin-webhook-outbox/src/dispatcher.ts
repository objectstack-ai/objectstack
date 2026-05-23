// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { IClusterService, LockHandle } from '@objectstack/spec/contracts';
import type { FetchImpl } from './http-sender.js';
import { classifyAttempt, sendOnce } from './http-sender.js';
import type { IWebhookOutbox, WebhookDelivery } from './outbox.js';

/**
 * Minimal logger surface — kernel's `Logger` is compatible (extra params
 * accepted). Keeping it permissive avoids a hard dependency on the spec
 * Logger interface here.
 */
export interface DispatcherLogger {
    warn: (msg: string, meta?: any) => void;
    info?: (msg: string, meta?: any) => void;
}

export interface DispatcherOptions {
    /** Stable id identifying this dispatcher node. */
    nodeId: string;
    /** Cluster service providing `lock` (and optional metrics). */
    cluster: IClusterService;
    /** Outbox backend. */
    outbox: IWebhookOutbox;
    /**
     * How many partitions to split work across. Each tick the dispatcher
     * attempts to acquire each partition's lock independently — the node
     * that wins owns that partition for the duration of the batch.
     *
     * Default: 8 (matches webhook-delivery.mdx §4 example).
     */
    partitionCount?: number;
    /** Max rows to claim from each partition per tick. Default 32. */
    batchSize?: number;
    /** Tick interval in ms. Default 250. */
    intervalMs?: number;
    /** Per-partition lock TTL. Default = 5 × intervalMs. */
    lockTtlMs?: number;
    /** Visibility timeout for claimed rows. Default = 2 × lockTtlMs. */
    claimTtlMs?: number;
    /** Override `globalThis.fetch` (tests). */
    fetchImpl?: FetchImpl;
    /** Hook fired after every attempt — observability hook. */
    onAttempt?: (delivery: WebhookDelivery, success: boolean) => void;
    /** RNG override for the retry-jitter schedule (tests). */
    rng?: () => number;
    /** Logger callback (optional). */
    logger?: DispatcherLogger;
}

/**
 * Cross-node webhook dispatcher.
 *
 * **Design** — each tick the dispatcher iterates over `partitionCount`
 * logical partitions. For each, it tries to acquire a cluster-scoped lock
 * (`webhook.dispatcher.partition.{i}`) with a short TTL. If it wins the
 * lock, it claims up to `batchSize` ready rows whose `hash(webhookId) mod
 * partitionCount === i`, POSTs them, and acks. The lock is released
 * immediately after the batch so other nodes can fairly rotate through.
 *
 * **Why per-partition locks rather than one global lock?**
 *
 *   1. Throughput — N nodes can process N partitions concurrently.
 *   2. Partition affinity — rows for the same webhook always sort into the
 *      same partition, preserving in-order delivery per webhook.
 *   3. Failure isolation — a stuck node only blocks its partition until the
 *      TTL elapses; other partitions keep moving.
 *
 * **At-least-once, not exactly-once.** Receivers MUST be idempotent on the
 * `X-Objectstack-Delivery` (== row id) header. If the HTTP call succeeds
 * but the ack write fails, the row reverts to pending after the claim TTL
 * and will be re-posted.
 */
export class WebhookDispatcher {
    private readonly opts: Required<
        Omit<DispatcherOptions, 'onAttempt' | 'fetchImpl' | 'rng' | 'logger'>
    > & Pick<DispatcherOptions, 'onAttempt' | 'fetchImpl' | 'rng' | 'logger'>;
    private timer: ReturnType<typeof setInterval> | undefined;
    private running = false;
    private inflightTick: Promise<void> | undefined;

    constructor(options: DispatcherOptions) {
        const intervalMs = options.intervalMs ?? 250;
        const lockTtlMs = options.lockTtlMs ?? intervalMs * 5;
        this.opts = {
            nodeId: options.nodeId,
            cluster: options.cluster,
            outbox: options.outbox,
            partitionCount: options.partitionCount ?? 8,
            batchSize: options.batchSize ?? 32,
            intervalMs,
            lockTtlMs,
            claimTtlMs: options.claimTtlMs ?? lockTtlMs * 2,
            onAttempt: options.onAttempt,
            fetchImpl: options.fetchImpl,
            rng: options.rng,
            logger: options.logger,
        };
    }

    /** Begin the periodic loop. Safe to call once; subsequent calls are no-ops. */
    start(): void {
        if (this.running) return;
        this.running = true;
        // Fire one tick immediately so single-row tests don't wait the interval.
        this.scheduleTick();
        this.timer = setInterval(() => this.scheduleTick(), this.opts.intervalMs);
    }

    /** Stop the loop and wait for the in-flight tick to drain. */
    async stop(): Promise<void> {
        if (!this.running) return;
        this.running = false;
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
        if (this.inflightTick) {
            try {
                await this.inflightTick;
            } catch {
                /* swallow — already logged */
            }
        }
    }

    /**
     * Run one full tick (all partitions, single attempt each). Exposed for
     * deterministic tests that want to step the dispatcher manually.
     */
    async tick(): Promise<void> {
        await this.runTick();
    }

    private scheduleTick(): void {
        if (this.inflightTick) return; // skip if previous tick still running
        this.inflightTick = this.runTick()
            .catch((err) => {
                this.opts.logger?.warn?.('webhook-dispatcher: tick failed', {
                    nodeId: this.opts.nodeId,
                    error: (err as Error)?.message ?? String(err),
                });
            })
            .finally(() => {
                this.inflightTick = undefined;
            });
    }

    private async runTick(): Promise<void> {
        const partitionCount = this.opts.partitionCount;
        // Walk partitions in a rotated order per node so contention spreads.
        const offset = stableNodeOffset(this.opts.nodeId, partitionCount);
        for (let step = 0; step < partitionCount; step++) {
            const i = (offset + step) % partitionCount;
            await this.runPartition(i);
        }
    }

    private async runPartition(index: number): Promise<void> {
        const key = `webhook.dispatcher.partition.${index}`;
        const handle: LockHandle | null = await this.opts.cluster.lock.acquire(key, {
            ttlMs: this.opts.lockTtlMs,
            // waitMs=0 → fail-fast; we'll try this partition again next tick.
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
            if (claimed.length === 0) return;
            // Renew before potentially long HTTP work — and bound batch time.
            await handle.renew(this.opts.lockTtlMs);
            for (const row of claimed) {
                if (!handle.isHeld()) break; // lost the lock — abandon remaining rows
                await this.processRow(row);
            }
        } finally {
            await handle.release();
        }
    }

    private async processRow(row: WebhookDelivery): Promise<void> {
        const fetchImpl = (this.opts.fetchImpl ?? (globalThis.fetch as unknown as FetchImpl)) as FetchImpl | undefined;
        if (!fetchImpl) {
            this.opts.logger?.warn?.('webhook-dispatcher: no fetch impl available', {
                rowId: row.id,
            });
            await this.opts.outbox.ack(row.id, {
                success: false,
                error: 'no fetch implementation',
                durationMs: 0,
                dead: true,
            });
            return;
        }
        const outcome = await sendOnce(row, fetchImpl);
        const result = classifyAttempt(outcome, row.attempts, Date.now(), this.opts.rng);
        await this.opts.outbox.ack(row.id, result);
        this.opts.onAttempt?.(row, result.success);
    }
}

/**
 * Spread starting partition per node so a 2-node cluster with 8 partitions
 * doesn't have both nodes serialise on partition 0 every tick.
 */
function stableNodeOffset(nodeId: string, partitionCount: number): number {
    let h = 0;
    for (let i = 0; i < nodeId.length; i++) {
        h = (h * 31 + nodeId.charCodeAt(i)) | 0;
    }
    return Math.abs(h) % partitionCount;
}
