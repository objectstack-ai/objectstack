// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import { runFullContract } from '../testing.js';
import { MemoryPubSub } from './pubsub.js';
import { MemoryLock } from './lock.js';
import { MemoryKV } from './kv.js';
import { MemoryCounter } from './counter.js';
import { defineCluster } from '../cluster.js';

runFullContract('memory', {
    makePubSub: async () => new MemoryPubSub(),
    makeLock: async () => new MemoryLock(),
    makeKV: async () => new MemoryKV(),
    makeCounter: async () => new MemoryCounter(),
});

describe('defineCluster(memory) smoke', () => {
    it('builds a working facade with all four primitives', async () => {
        const cluster = defineCluster({ driver: 'memory', nodeId: 'test-1' });
        expect(cluster.nodeId).toBe('test-1');
        expect(cluster.driver).toBe('memory');

        // Round-trip through all four.
        const received: unknown[] = [];
        cluster.pubsub.subscribe('e', (m) => { received.push(m.payload); });
        await cluster.pubsub.publish('e', 'hi');
        expect(received).toEqual(['hi']);

        const h = await cluster.lock.acquire('k');
        expect(h).not.toBeNull();
        await h!.release();

        await cluster.kv.set('s', { ok: true });
        expect((await cluster.kv.get('s'))?.value).toEqual({ ok: true });

        expect(await cluster.counter.incr('seq')).toBe(1n);
        expect(await cluster.counter.incr('seq')).toBe(2n);

        await cluster.close();
    });

    it('auto-generates a nodeId when absent', () => {
        const cluster = defineCluster();
        expect(cluster.nodeId).toMatch(/^node-/);
        void cluster.close();
    });

    it('rejects unknown drivers with a helpful message', () => {
        expect(() => defineCluster({ driver: 'redis' })).toThrow(
            /not registered/i,
        );
    });

    it('PubSub messages carry the nodeId as fromNode', async () => {
        const cluster = defineCluster({ driver: 'memory', nodeId: 'node-X' });
        let from: string | undefined;
        cluster.pubsub.subscribe('c', (m) => {
            from = m.fromNode;
        });
        await cluster.pubsub.publish('c', 'p');
        expect(from).toBe('node-X');
        await cluster.close();
    });
});
