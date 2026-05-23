// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Cross-node webhook dispatcher contract test.
 *
 * Builds two `WebhookDispatcher` instances that share one in-memory outbox
 * AND one cluster `ILock`/`IPubSub` (simulating two nodes sharing one
 * Redis/Postgres). Asserts:
 *
 *   1. Every enqueued delivery is POSTed *exactly once* (no double-fire).
 *   2. Work is distributed across both nodes (no starvation).
 *   3. 5xx responses are retried per the Stripe-style schedule.
 *   4. 4xx (permanent) responses go straight to `dead`.
 */

import { describe, expect, it } from 'vitest';
import {
    ComposedClusterService,
    MemoryCounter,
    MemoryKV,
    MemoryLock,
    MemoryPubSub,
} from '@objectstack/service-cluster';
import type { IClusterService } from '@objectstack/spec/contracts';
import { WebhookDispatcher } from './dispatcher.js';
import type { FetchImpl } from './http-sender.js';
import { MemoryWebhookOutbox } from './memory-outbox.js';
import { hashPartition } from './partition.js';

interface SharedCluster {
    nodeA: IClusterService;
    nodeB: IClusterService;
}

function makeSharedCluster(): SharedCluster {
    // ONE lock + pubsub shared by both "nodes" — this is what makes the test
    // a realistic cross-node simulation.
    const lock = new MemoryLock();
    const pubsub = new MemoryPubSub();
    const kv = new MemoryKV();
    const counter = new MemoryCounter();
    return {
        nodeA: new ComposedClusterService('node-A', 'memory', pubsub, lock, kv, counter),
        nodeB: new ComposedClusterService('node-B', 'memory', pubsub, lock, kv, counter),
    };
}

function makeFetchImpl(opts: {
    status?: number;
    log?: { url: string; deliveryId: string }[];
}): FetchImpl {
    const status = opts.status ?? 200;
    return async (url, init) => {
        opts.log?.push({
            url,
            deliveryId: init.headers['X-Objectstack-Delivery'] ?? '',
        });
        return {
            ok: status >= 200 && status < 300,
            status,
            async text() {
                return '';
            },
        };
    };
}

async function flushTicks(...dispatchers: WebhookDispatcher[]): Promise<void> {
    // Run several rounds with the nodes ticking *concurrently* so they
    // genuinely contend for the cluster lock — sequential ticks would let
    // whichever node ran first drain every partition.
    for (let round = 0; round < 6; round++) {
        await Promise.all(dispatchers.map((d) => d.tick()));
    }
}

describe('WebhookDispatcher cross-node', () => {
    it('exactly-once: 50 deliveries across 2 nodes → 50 POSTs total', async () => {
        const cluster = makeSharedCluster();
        const outbox = new MemoryWebhookOutbox();
        const log: { url: string; deliveryId: string }[] = [];
        const fetchImpl = makeFetchImpl({ status: 200, log });

        const partitionCount = 4;
        const a = new WebhookDispatcher({
            nodeId: 'node-A',
            cluster: cluster.nodeA,
            outbox,
            fetchImpl,
            partitionCount,
            intervalMs: 1_000_000, // disable timer; we drive with tick()
        });
        const b = new WebhookDispatcher({
            nodeId: 'node-B',
            cluster: cluster.nodeB,
            outbox,
            fetchImpl,
            partitionCount,
            intervalMs: 1_000_000,
        });

        for (let i = 0; i < 50; i++) {
            await outbox.enqueue({
                webhookId: `wh-${i % 10}`, // 10 webhooks → spread across 4 partitions
                eventId: `evt-${i}`,
                eventType: 'data.record.created',
                url: `https://example.test/${i}`,
                payload: { i },
            });
        }

        await flushTicks(a, b);

        expect(log).toHaveLength(50);
        const uniqueIds = new Set(log.map((l) => l.deliveryId));
        expect(uniqueIds.size).toBe(50);

        const success = await outbox.list({ status: 'success' });
        expect(success).toHaveLength(50);
    });

    it('partition affinity: dispatcher only claims rows for partitions it locked', async () => {
        const cluster = makeSharedCluster();
        const outbox = new MemoryWebhookOutbox();
        const partitionCount = 8;

        // For each attempt, record (nodeId, partitionForWebhook).
        const observed: { nodeId: string; partition: number }[] = [];

        const make = (nodeId: string, c: IClusterService) =>
            new WebhookDispatcher({
                nodeId,
                cluster: c,
                outbox,
                fetchImpl: makeFetchImpl({ status: 200 }),
                partitionCount,
                intervalMs: 1_000_000,
                onAttempt: (delivery) => {
                    observed.push({
                        nodeId,
                        partition: hashPartition(delivery.webhookId, partitionCount),
                    });
                },
            });

        const a = make('node-A', cluster.nodeA);
        const b = make('node-B', cluster.nodeB);

        for (let i = 0; i < 30; i++) {
            await outbox.enqueue({
                webhookId: `wh-${i % 5}`,
                eventId: `evt-${i}`,
                eventType: 't',
                url: 'https://example.test/x',
                payload: { i },
            });
        }
        await flushTicks(a, b);

        expect(observed).toHaveLength(30);
        // Each row's partition came from hash(webhookId, 8) — only 5 distinct
        // webhook ids → at most 5 distinct partitions.
        const partitionsTouched = new Set(observed.map((o) => o.partition));
        expect(partitionsTouched.size).toBeLessThanOrEqual(5);
    });

    it('load distribution: both nodes process some rows', async () => {
        const cluster = makeSharedCluster();
        const outbox = new MemoryWebhookOutbox();
        const partitionCount = 8;
        const counts: Record<string, number> = { 'node-A': 0, 'node-B': 0 };

        const make = (nodeId: string, c: IClusterService) =>
            new WebhookDispatcher({
                nodeId,
                cluster: c,
                outbox,
                fetchImpl: makeFetchImpl({ status: 200 }),
                partitionCount,
                intervalMs: 1_000_000,
                onAttempt: () => {
                    counts[nodeId] += 1;
                },
            });

        const a = make('node-A', cluster.nodeA);
        const b = make('node-B', cluster.nodeB);

        // Lots of distinct webhookIds → spreads work across many partitions.
        for (let i = 0; i < 200; i++) {
            await outbox.enqueue({
                webhookId: `wh-${i}`,
                eventId: `evt-${i}`,
                eventType: 't',
                url: 'https://example.test/x',
                payload: { i },
            });
        }
        await flushTicks(a, b);

        // Each node should have processed at least one row — proving the
        // rotation/offset isn't pinning all work to node A.
        expect(counts['node-A']).toBeGreaterThan(0);
        expect(counts['node-B']).toBeGreaterThan(0);
        expect(counts['node-A'] + counts['node-B']).toBe(200);
    });

    it('5xx is retried: row stays pending with future nextRetryAt', async () => {
        const cluster = makeSharedCluster();
        const outbox = new MemoryWebhookOutbox();
        const a = new WebhookDispatcher({
            nodeId: 'node-A',
            cluster: cluster.nodeA,
            outbox,
            fetchImpl: makeFetchImpl({ status: 503 }),
            partitionCount: 1,
            intervalMs: 1_000_000,
            rng: () => 0.5,
        });

        await outbox.enqueue({
            webhookId: 'wh-x',
            eventId: 'evt-x',
            eventType: 't',
            url: 'https://example.test/fail',
            payload: {},
        });

        await a.tick();
        const rows = await outbox.list();
        expect(rows[0].status).toBe('pending');
        expect(rows[0].attempts).toBe(1);
        expect(rows[0].nextRetryAt).toBeGreaterThan(Date.now());
    });

    it('4xx is permanent: row moves to dead', async () => {
        const cluster = makeSharedCluster();
        const outbox = new MemoryWebhookOutbox();
        const a = new WebhookDispatcher({
            nodeId: 'node-A',
            cluster: cluster.nodeA,
            outbox,
            fetchImpl: makeFetchImpl({ status: 404 }),
            partitionCount: 1,
            intervalMs: 1_000_000,
        });

        await outbox.enqueue({
            webhookId: 'wh-x',
            eventId: 'evt-x',
            eventType: 't',
            url: 'https://example.test/missing',
            payload: {},
        });

        await a.tick();
        const dead = await outbox.list({ status: 'dead' });
        expect(dead).toHaveLength(1);
        expect(dead[0].responseCode).toBe(404);
    });

    it('dedup: identical (eventId, webhookId) enqueues collapse to one row', async () => {
        const outbox = new MemoryWebhookOutbox();
        const id1 = await outbox.enqueue({
            webhookId: 'wh-1',
            eventId: 'evt-dup',
            eventType: 't',
            url: 'https://example.test/',
            payload: {},
        });
        const id2 = await outbox.enqueue({
            webhookId: 'wh-1',
            eventId: 'evt-dup',
            eventType: 't',
            url: 'https://example.test/',
            payload: {},
        });
        expect(id1).toBe(id2);
        const rows = await outbox.list();
        expect(rows).toHaveLength(1);
    });

    it('lock prevents same partition being claimed twice in a tick', async () => {
        const cluster = makeSharedCluster();
        const outbox = new MemoryWebhookOutbox();
        const log: { url: string; deliveryId: string }[] = [];
        const fetchImpl = makeFetchImpl({ status: 200, log });

        // Single partition → both nodes contend for the same lock.
        const a = new WebhookDispatcher({
            nodeId: 'node-A',
            cluster: cluster.nodeA,
            outbox,
            fetchImpl,
            partitionCount: 1,
            intervalMs: 1_000_000,
        });
        const b = new WebhookDispatcher({
            nodeId: 'node-B',
            cluster: cluster.nodeB,
            outbox,
            fetchImpl,
            partitionCount: 1,
            intervalMs: 1_000_000,
        });

        for (let i = 0; i < 5; i++) {
            await outbox.enqueue({
                webhookId: 'wh-1',
                eventId: `evt-${i}`,
                eventType: 't',
                url: 'https://example.test/',
                payload: { i },
            });
        }

        // Fire both ticks "simultaneously" — only one should claim the partition.
        await Promise.all([a.tick(), b.tick()]);

        expect(log).toHaveLength(5);
        const uniqueIds = new Set(log.map((l) => l.deliveryId));
        expect(uniqueIds.size).toBe(5);
    });
});
