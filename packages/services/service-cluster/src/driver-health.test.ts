// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it, vi } from 'vitest';
import { defineCluster } from './cluster.js';
import { offerClusterDriverConnection } from './driver-connection.js';
import { probeClusterDriverHealth } from './driver-health.js';

/** A cluster instance offering a `redis` connection whose client is `client`. */
function redisCluster(client: unknown): object {
    const cluster = { driver: 'redis' };
    offerClusterDriverConnection(cluster, { driver: 'redis', client, keyPrefix: 'os:' });
    return cluster;
}

describe('probeClusterDriverHealth — the cluster driver reachability reading', () => {
    it('reads a store that answers PONG as reachable, with no reason', async () => {
        const ping = vi.fn(async () => 'PONG');
        await expect(probeClusterDriverHealth(redisCluster({ ping }), 'redis'))
            .resolves.toEqual({ driver: 'redis', reachable: true });
        expect(ping).toHaveBeenCalledTimes(1);
    });

    it('reads a rejected ping as unreachable — ping-failed — and never throws', async () => {
        const ping = vi.fn(async () => { throw new Error('connect ECONNREFUSED 10.0.0.7:6379'); });
        const reading = await probeClusterDriverHealth(redisCluster({ ping }), 'redis');
        expect(reading).toEqual({ driver: 'redis', reachable: false, reason: 'ping-failed' });
        // The client's error text names the store's address; the reading is
        // served anonymously, so none of it may travel.
        expect(JSON.stringify(reading)).not.toContain('10.0.0.7');
    });

    it('reads a synchronous throw from ping() as ping-failed too', async () => {
        const ping = () => { throw new Error('Connection is closed.'); };
        await expect(probeClusterDriverHealth(redisCluster({ ping }), 'redis'))
            .resolves.toEqual({ driver: 'redis', reachable: false, reason: 'ping-failed' });
    });

    it('bounds a ping that never settles — a reconnecting client queues it — as timeout', async () => {
        const ping = vi.fn(() => new Promise<string>(() => { /* never settles */ }));
        const started = Date.now();
        const reading = await probeClusterDriverHealth(redisCluster({ ping }), 'redis', { timeoutMs: 30 });
        expect(reading).toEqual({ driver: 'redis', reachable: false, reason: 'timeout' });
        expect(Date.now() - started).toBeLessThan(1_000);
    });

    it('reads any reply other than PONG as unreachable — unexpected-reply', async () => {
        const ping = async () => 'LOADING Redis is loading the dataset in memory';
        await expect(probeClusterDriverHealth(redisCluster({ ping }), 'redis'))
            .resolves.toEqual({ driver: 'redis', reachable: false, reason: 'unexpected-reply' });
    });

    it('reads an offered client with no ping() as no-probe — never as healthy', async () => {
        await expect(probeClusterDriverHealth(redisCluster({ get: async () => null }), 'redis'))
            .resolves.toEqual({ driver: 'redis', reachable: false, reason: 'no-probe' });
    });

    it('answers undefined — no reading at all — when the cluster offers no connection for the driver', async () => {
        await expect(probeClusterDriverHealth(defineCluster({ driver: 'memory' }), 'redis')).resolves.toBeUndefined();
        await expect(probeClusterDriverHealth(undefined, 'redis')).resolves.toBeUndefined();
        const ping = vi.fn(async () => 'PONG');
        await expect(probeClusterDriverHealth(redisCluster({ ping }), 'postgres')).resolves.toBeUndefined();
        expect(ping).not.toHaveBeenCalled();
    });

    it('observes a ping that rejects after the timeout instead of leaking an unhandled rejection', async () => {
        const unhandled = vi.fn();
        process.on('unhandledRejection', unhandled);
        try {
            let reject!: (e: Error) => void;
            const ping = () => new Promise<string>((_, r) => { reject = r; });
            const reading = await probeClusterDriverHealth(redisCluster({ ping }), 'redis', { timeoutMs: 10 });
            expect(reading?.reason).toBe('timeout');
            reject(new Error('MaxRetriesPerRequestError'));
            await new Promise((r) => setTimeout(r, 20));
            expect(unhandled).not.toHaveBeenCalled();
        } finally {
            process.off('unhandledRejection', unhandled);
        }
    });
});
