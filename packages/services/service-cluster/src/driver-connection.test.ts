// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import { defineCluster } from './cluster.js';
import { offerClusterDriverConnection, readClusterDriverConnection } from './driver-connection.js';

describe('cluster driver connection offer', () => {
    it('reads back exactly what the driver offered, for that driver only', () => {
        const client = { tag: 'ioredis' };
        const cluster = { driver: 'redis' };
        offerClusterDriverConnection(cluster, { driver: 'redis', client, keyPrefix: 'acme:' });

        const conn = readClusterDriverConnection<typeof client>(cluster, 'redis');
        expect(conn?.client).toBe(client);
        expect(conn?.keyPrefix).toBe('acme:');
        expect(readClusterDriverConnection(cluster, 'postgres')).toBeUndefined();
    });

    it('answers undefined — never throws — for a cluster that offers nothing', () => {
        expect(readClusterDriverConnection(defineCluster({ driver: 'memory' }), 'redis')).toBeUndefined();
        expect(readClusterDriverConnection(undefined, 'redis')).toBeUndefined();
        expect(readClusterDriverConnection(null, 'redis')).toBeUndefined();
        expect(readClusterDriverConnection('redis', 'redis')).toBeUndefined();
    });

    it('is invisible to enumeration and serialisation, and cannot be replaced', () => {
        const cluster: Record<string, unknown> = { driver: 'redis' };
        offerClusterDriverConnection(cluster, { driver: 'redis', client: {}, keyPrefix: 'os:' });
        expect(Object.keys(cluster)).toEqual(['driver']);
        expect(JSON.stringify(cluster)).toBe('{"driver":"redis"}');
        expect(() => offerClusterDriverConnection(cluster, { driver: 'redis', client: {}, keyPrefix: 'x:' })).toThrow(
            /already offers a "redis" connection/,
        );
        expect(readClusterDriverConnection(cluster, 'redis')?.keyPrefix).toBe('os:');
    });

    it('lives under a GLOBAL-registry symbol, so a second copy of this module reads the same offer', () => {
        // A process can hold two instances of this package (ESM + CJS builds);
        // the driver may offer through one and the cache read through the
        // other. The key is spelled once more here, deliberately: renaming it
        // breaks every already-published driver, and this is the pin that says so.
        const cluster = { driver: 'redis' };
        offerClusterDriverConnection(cluster, { driver: 'redis', client: 'c', keyPrefix: 'os:' });
        const key = Symbol.for('@objectstack/service-cluster:driver-connection');
        expect((cluster as Record<symbol, unknown>)[key]).toMatchObject({ driver: 'redis', client: 'c', keyPrefix: 'os:' });
    });
});
