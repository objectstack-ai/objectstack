// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The driver-agnostic half of the outage story: `ClusterDriverLiveness` logs an
 * outage ONCE, reports health, and emits ONE local `cluster.resync` when every
 * failed connection is back. The Redis driver feeds it from ioredis events; the
 * end-to-end leg against a real `redis-server` lives in
 * `@objectstack/service-cluster-redis` (`redis-outage.real-redis.test.ts`).
 */

import { describe, expect, it, vi } from 'vitest';
import {
    CLUSTER_RESYNC_EVENT,
    ClusterDriverLiveness,
    describeConnectionError,
    offerClusterDriverLiveness,
    onClusterResync,
    readClusterDriverHealth,
    redactCredentials,
    watchClusterDriverConnection,
} from './cluster-resync.js';
import { EventEmitter } from 'node:events';
import { defineCluster } from './cluster.js';

function makeLiveness() {
    let clock = 1_000;
    const logger = { warn: vi.fn(), info: vi.fn() };
    const liveness = new ClusterDriverLiveness({
        driver: 'redis',
        nodeId: 'n1',
        target: '127.0.0.1:6379',
        logger,
        now: () => clock,
    });
    return { liveness, logger, tick: (ms: number) => { clock += ms; } };
}

describe('ClusterDriverLiveness — one warning per outage, one resync per recovery', () => {
    it('warns once for a whole outage, however many failures it sees', () => {
        const { liveness, logger } = makeLiveness();
        liveness.reportUp('command');
        for (let i = 0; i < 25; i++) liveness.reportDown('command', new Error('connect ECONNREFUSED 127.0.0.1:6379'));
        liveness.reportDown('subscriber');
        expect(logger.warn).toHaveBeenCalledTimes(1);
        expect(logger.warn.mock.calls[0]![0]).toContain('lost its connection to 127.0.0.1:6379');
        expect(liveness.health()).toMatchObject({ state: 'down', outages: 1, lastError: 'connect ECONNREFUSED 127.0.0.1:6379' });
    });

    it('emits cluster.resync once, only when EVERY failed connection is back', () => {
        const { liveness, logger, tick } = makeLiveness();
        const handler = vi.fn();
        liveness.onResync(handler);
        liveness.reportUp('command');
        liveness.reportDown('command', new Error('boom'));
        liveness.reportDown('subscriber', new Error('boom'));
        tick(16_000);
        liveness.reportUp('command');
        expect(handler).not.toHaveBeenCalled();
        expect(liveness.health().state).toBe('down');
        liveness.reportUp('subscriber');
        liveness.reportUp('subscriber');
        liveness.reportUp('command');
        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler).toHaveBeenCalledWith({
            event: CLUSTER_RESYNC_EVENT,
            driver: 'redis',
            nodeId: 'n1',
            outageMs: 16_000,
            at: 17_000,
        });
        expect(logger.info).toHaveBeenCalledTimes(1);
        expect(liveness.health()).toEqual({ driver: 'redis', nodeId: 'n1', state: 'up', since: 17_000, outages: 1 });
    });

    it('does NOT resync on the first connect (nothing was missed) and warns again on the NEXT outage', () => {
        const { liveness, logger } = makeLiveness();
        const handler = vi.fn();
        liveness.onResync(handler);
        expect(liveness.health().state).toBe('unknown');
        liveness.reportUp('command');
        expect(handler).not.toHaveBeenCalled();
        liveness.reportDown('command', new Error('a'));
        liveness.reportUp('command');
        liveness.reportDown('command', new Error('b'));
        liveness.reportUp('command');
        expect(logger.warn).toHaveBeenCalledTimes(2);
        expect(handler).toHaveBeenCalledTimes(2);
        expect(liveness.health().outages).toBe(2);
    });

    it('isolates a throwing or rejecting handler: the others still run, one warning names it', async () => {
        const { liveness, logger } = makeLiveness();
        const after = vi.fn();
        liveness.onResync(() => { throw new Error('sync'); });
        liveness.onResync(async () => { throw new Error('async'); });
        liveness.onResync(after);
        liveness.reportDown('command', new Error('x'));
        liveness.reportUp('command');
        await new Promise((r) => setTimeout(r, 0));
        expect(after).toHaveBeenCalledTimes(1);
        // 1 outage line + 2 handler-failure lines.
        expect(logger.warn).toHaveBeenCalledTimes(3);
    });

    it('after close() a deliberate disconnect is not an outage and nothing fires', () => {
        const { liveness, logger } = makeLiveness();
        const handler = vi.fn();
        liveness.onResync(handler);
        liveness.reportUp('command');
        liveness.close();
        liveness.reportDown('command');
        liveness.reportUp('command');
        expect(logger.warn).not.toHaveBeenCalled();
        expect(handler).not.toHaveBeenCalled();
    });
});

describe('the outage line never carries a credential', () => {
    it('masks the userinfo of any URL in the error text', () => {
        expect(redactCredentials('dial redis://default:s3cr3t@cache.internal:6379 failed')).toBe(
            'dial redis://***@cache.internal:6379 failed',
        );
        expect(redactCredentials('rediss://:onlypass@h:1 and redis://u:p@h2')).toBe('rediss://***@h:1 and redis://***@h2');
        expect(describeConnectionError(Object.assign(new Error('getaddrinfo redis://u:pw@x'), { code: 'ENOTFOUND' }))).toBe(
            'ENOTFOUND: getaddrinfo redis://***@x',
        );
    });

    it('the logged line is redacted end to end', () => {
        const { liveness, logger } = makeLiveness();
        liveness.reportDown('command', new Error('could not reach redis://admin:hunter2@10.0.0.5:6379'));
        const line = String(logger.warn.mock.calls[0]![0]);
        expect(line).not.toContain('hunter2');
        expect(line).toContain('redis://***@10.0.0.5:6379');
    });
});

describe('the offer on the cluster instance — onClusterResync / readClusterDriverHealth', () => {
    it('a remote driver offers its liveness: subscribers get the event, a probe reads health', () => {
        const cluster = {};
        const { liveness } = makeLiveness();
        offerClusterDriverLiveness(cluster, liveness);
        const handler = vi.fn();
        const off = onClusterResync(cluster, handler);
        liveness.reportDown('command', new Error('x'));
        expect(readClusterDriverHealth(cluster)?.state).toBe('down');
        liveness.reportUp('command');
        expect(handler).toHaveBeenCalledTimes(1);
        off();
        liveness.reportDown('command', new Error('y'));
        liveness.reportUp('command');
        expect(handler).toHaveBeenCalledTimes(1);
        expect(() => offerClusterDriverLiveness(cluster, liveness)).toThrow(/already offers/);
        // Not enumerable: never leaks into a spread or a JSON dump of the cluster.
        expect(Object.getOwnPropertySymbols({ ...cluster })).toHaveLength(0);
    });

    it('CONTROL — the memory driver offers none: no health, and a subscription is an inert no-op', async () => {
        const cluster = defineCluster({ driver: 'memory' });
        expect(readClusterDriverHealth(cluster)).toBeUndefined();
        const handler = vi.fn();
        const off = onClusterResync(cluster, handler);
        expect(typeof off).toBe('function');
        off();
        expect(handler).not.toHaveBeenCalled();
        await cluster.close();
    });
});

describe('watchClusterDriverConnection — a derived connection joins the driver\'s liveness', () => {
    function connection(status?: string) {
        return Object.assign(new EventEmitter(), { status });
    }
    const counts = (c: EventEmitter) => ['error', 'close', 'ready'].map((e) => c.listenerCount(e));

    it('reports into the offered liveness as its source; the disposer detaches all three listeners', () => {
        const cluster = {};
        const { liveness, logger } = makeLiveness();
        offerClusterDriverLiveness(cluster, liveness);
        const conn = connection('ready');
        const unwatch = watchClusterDriverConnection(cluster, conn, 'cache');
        expect(readClusterDriverHealth(cluster)?.state).toBe('up');
        expect(counts(conn)).toEqual([1, 1, 1]);

        conn.emit('error', new Error('ECONNREFUSED'));
        conn.emit('error', new Error('ECONNREFUSED'));
        expect(readClusterDriverHealth(cluster)).toMatchObject({ state: 'down', outages: 1 });
        expect(logger.warn).toHaveBeenCalledTimes(1);
        conn.emit('ready');
        expect(readClusterDriverHealth(cluster)?.state).toBe('up');

        unwatch();
        unwatch();
        expect(counts(conn)).toEqual([0, 0, 0]);
        conn.emit('close');
        expect(readClusterDriverHealth(cluster)?.state).toBe('up');
    });

    it('CONTROL — no liveness offered (the memory driver): attaches nothing, the disposer is inert', async () => {
        const cluster = defineCluster({ driver: 'memory' });
        const conn = connection();
        const unwatch = watchClusterDriverConnection(cluster, conn, 'cache');
        expect(counts(conn)).toEqual([0, 0, 0]);
        unwatch();
        await cluster.close();
    });
});
