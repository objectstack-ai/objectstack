// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Cluster membership (cloud#3814): under a declared multi-replica deployment on
 * the Redis driver each replica beats a TTL key, and `readClusterMembers()`
 * lists the live ones. Three replicas are three kernels whose cluster facades
 * say `redis` and share one KV (the in-process stand-in for one Redis); the
 * real-Redis stop/start smoke is recorded on the PR.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import type { IClusterService, IKV, KVEntry, KVSetOptions } from '@objectstack/spec/contracts';

import { ComposedClusterService } from './cluster.js';
import { ClusterServicePlugin } from './cluster-service-plugin.js';
import { ClusterMembershipHeartbeat, readClusterMembers } from './cluster-membership.js';
import { MemoryCounter } from './memory/counter.js';
import { MemoryKV } from './memory/kv.js';
import { MemoryLock } from './memory/lock.js';
import { MemoryPubSub } from './memory/pubsub.js';

const HEARTBEAT_MS = 40;
const TTL_MS = 160;

/** One replica's view of the shared store: counts its writes, can go down, can die. */
class ReplicaKV implements IKV {
    writes = 0;
    /** The store is unreachable: every call rejects, like a refused connection. */
    down = false;
    /** The process is gone: nothing it would send reaches the store. */
    dead = false;

    constructor(private readonly store: IKV) {}

    private gate(): void {
        if (this.dead) throw new Error('replica process killed');
        if (this.down) throw new Error('connect ECONNREFUSED redis://admin:s3cret@10.0.0.9:6379');
    }

    async get<T = unknown>(key: string): Promise<KVEntry<T> | undefined> {
        this.gate();
        return this.store.get<T>(key);
    }
    async set<T = unknown>(key: string, value: T, opts?: KVSetOptions): Promise<KVEntry<T>> {
        this.gate();
        this.writes++;
        return this.store.set(key, value, opts);
    }
    async delete(key: string, opts?: { ifVersion?: bigint }): Promise<boolean> {
        this.gate();
        this.writes++;
        return this.store.delete(key, opts);
    }
    async cas<T = unknown>(
        key: string,
        expectedVersion: bigint,
        next: T,
        opts?: Omit<KVSetOptions, 'ifVersion'>,
    ): Promise<KVEntry<T> | undefined> {
        this.gate();
        this.writes++;
        return this.store.cas(key, expectedVersion, next, opts);
    }
    async close(): Promise<void> {}
}

interface Replica {
    nodeId: string;
    kernel: LiteKernel;
    cluster: IClusterService;
    kv: ReplicaKV;
}

const kernels: LiteKernel[] = [];

async function bootReplica(nodeId: string, store: IKV, driver = 'redis'): Promise<Replica> {
    const kv = new ReplicaKV(store);
    const cluster = new ComposedClusterService(
        nodeId,
        driver,
        new MemoryPubSub({ nodeId }),
        new MemoryLock(),
        kv,
        new MemoryCounter(),
    );
    const kernel = new LiteKernel({ logger: { level: 'warn', format: 'text' } });
    kernel.use(new ClusterServicePlugin({ cluster, membership: { heartbeatMs: HEARTBEAT_MS, ttlMs: TTL_MS } }));
    await kernel.bootstrap();
    kernels.push(kernel);
    return { nodeId, kernel, cluster, kv };
}

async function shutdown(kernel: LiteKernel): Promise<void> {
    const i = kernels.indexOf(kernel);
    if (i >= 0) kernels.splice(i, 1);
    await kernel.shutdown();
}

function ids(reading: { members: readonly { nodeId: string }[] }): string[] {
    return reading.members.map((m) => m.nodeId);
}

afterEach(async () => {
    for (const kernel of kernels.splice(0)) await kernel.shutdown();
    vi.unstubAllEnvs();
});

describe('cluster membership under a declared multi-replica deployment on redis', () => {
    it('three replicas list three members, each with its record', async () => {
        vi.stubEnv('OS_EXPECT_MULTI_NODE', 'true');
        const store = new MemoryKV();
        const [a, b, c] = [
            await bootReplica('node-a', store),
            await bootReplica('node-b', store),
            await bootReplica('node-c', store),
        ];

        for (const replica of [a, b, c]) {
            await vi.waitFor(async () => {
                const reading = await readClusterMembers(replica.cluster);
                expect(reading.state).toBe('live');
                expect(reading.self).toBe(replica.nodeId);
                expect(ids(reading)).toEqual(['node-a', 'node-b', 'node-c']);
            });
        }
        const reading = await readClusterMembers(a.cluster);
        for (const member of reading.members) {
            expect(member.pid).toBe(process.pid);
            expect(typeof member.host).toBe('string');
            expect(member.lastBeatAt).toBeGreaterThanOrEqual(member.startedAt);
        }
        // The keys the card names: one TTL key per replica, one roster.
        expect((await store.get('cluster:member:node-b'))?.expiresAt).toBeGreaterThan(Date.now());
        expect([...((await store.get<string[]>('cluster:members'))?.value ?? [])].sort()).toEqual([
            'node-a',
            'node-b',
            'node-c',
        ]);
    });

    it('a killed replica drops out within the TTL, and a beat prunes it from the roster', async () => {
        vi.stubEnv('OS_EXPECT_MULTI_NODE', 'true');
        const store = new MemoryKV();
        const a = await bootReplica('node-a', store);
        await bootReplica('node-b', store);
        const c = await bootReplica('node-c', store);
        await vi.waitFor(async () => expect(ids(await readClusterMembers(a.cluster))).toHaveLength(3));

        c.kv.dead = true;
        const killedAt = Date.now();
        await vi.waitFor(
            async () => expect(ids(await readClusterMembers(a.cluster))).toEqual(['node-a', 'node-b']),
            { timeout: TTL_MS * 4, interval: 10 },
        );
        expect(Date.now() - killedAt).toBeLessThanOrEqual(TTL_MS + HEARTBEAT_MS * 2);

        await vi.waitFor(async () =>
            expect([...((await store.get<string[]>('cluster:members'))?.value ?? [])].sort()).toEqual([
                'node-a',
                'node-b',
            ]),
        );
    });

    it('a replica that shuts down cleanly drops out at once and writes nothing after', async () => {
        vi.stubEnv('OS_EXPECT_MULTI_NODE', 'true');
        const store = new MemoryKV();
        const a = await bootReplica('node-a', store);
        const b = await bootReplica('node-b', store);
        await vi.waitFor(async () => expect(ids(await readClusterMembers(a.cluster))).toHaveLength(2));

        await shutdown(b.kernel);
        expect(ids(await readClusterMembers(a.cluster))).toEqual(['node-a']);

        const writesAtShutdown = b.kv.writes;
        await new Promise((resolve) => setTimeout(resolve, HEARTBEAT_MS * 5));
        expect(b.kv.writes).toBe(writesAtShutdown);
    });

    it('a store outage answers a degraded reading with the last good one and its own asOf, and throws nothing', async () => {
        vi.stubEnv('OS_EXPECT_MULTI_NODE', 'true');
        const store = new MemoryKV();
        const a = await bootReplica('node-a', store);
        await bootReplica('node-b', store);
        const good = await vi.waitFor(async () => {
            const reading = await readClusterMembers(a.cluster);
            expect(ids(reading)).toHaveLength(2);
            return reading;
        });

        a.kv.down = true;
        await new Promise((resolve) => setTimeout(resolve, HEARTBEAT_MS * 3));
        const degraded = await readClusterMembers(a.cluster);
        expect(degraded.state).toBe('degraded');
        expect(degraded.members).toEqual(good.members);
        expect(degraded.asOf).toBe(good.asOf);
        expect(degraded.reason).toContain('ECONNREFUSED');
        expect(degraded.reason).not.toContain('s3cret');

        a.kv.down = false;
        await vi.waitFor(async () => expect((await readClusterMembers(a.cluster)).state).toBe('live'));
    });

    it('a store down from the first beat leaves the boot and shutdown intact and reads this replica alone', async () => {
        vi.stubEnv('OS_EXPECT_MULTI_NODE', 'true');
        const store = new MemoryKV();
        const kv = new ReplicaKV(store);
        kv.down = true;
        const cluster = new ComposedClusterService(
            'node-a',
            'redis',
            new MemoryPubSub({ nodeId: 'node-a' }),
            new MemoryLock(),
            kv,
            new MemoryCounter(),
        );
        const kernel = new LiteKernel({ logger: { level: 'warn', format: 'text' } });
        kernel.use(new ClusterServicePlugin({ cluster, membership: { heartbeatMs: HEARTBEAT_MS, ttlMs: TTL_MS } }));
        await expect(kernel.bootstrap()).resolves.toBeUndefined();
        await new Promise((resolve) => setTimeout(resolve, HEARTBEAT_MS * 3));

        const reading = await readClusterMembers(cluster);
        expect(reading.state).toBe('degraded');
        expect(ids(reading)).toEqual(['node-a']);
        await expect(kernel.shutdown()).resolves.toBeUndefined();
    });
});

describe('cluster membership without the declaration (CONTROL)', () => {
    it('writes nothing and reads this replica alone, on the redis driver too', async () => {
        vi.stubEnv('OS_EXPECT_MULTI_NODE', undefined);
        vi.stubEnv('OS_CLUSTER_REPLICAS', undefined);
        const store = new MemoryKV();
        const a = await bootReplica('node-a', store);
        await new Promise((resolve) => setTimeout(resolve, HEARTBEAT_MS * 4));

        expect(a.kv.writes).toBe(0);
        expect(await store.get('cluster:members')).toBeUndefined();
        const reading = await readClusterMembers(a.cluster);
        expect(reading.state).toBe('single-node');
        expect(ids(reading)).toEqual(['node-a']);
    });

    it('a declared deployment on another remote driver writes nothing either', async () => {
        vi.stubEnv('OS_EXPECT_MULTI_NODE', 'true');
        const a = await bootReplica('node-a', new MemoryKV(), 'nats');
        await new Promise((resolve) => setTimeout(resolve, HEARTBEAT_MS * 4));
        expect(a.kv.writes).toBe(0);
        expect((await readClusterMembers(a.cluster)).state).toBe('single-node');
    });
});

describe('ClusterMembershipHeartbeat', () => {
    it('one cluster instance runs one heartbeat', () => {
        const cluster = { nodeId: 'node-a', kv: new MemoryKV() };
        const first = new ClusterMembershipHeartbeat({ cluster, heartbeatMs: HEARTBEAT_MS, ttlMs: TTL_MS });
        first.start();
        const second = new ClusterMembershipHeartbeat({ cluster, heartbeatMs: HEARTBEAT_MS, ttlMs: TTL_MS });
        expect(() => second.start()).toThrow(/already runs a membership heartbeat/);
        return first.stop();
    });
});
