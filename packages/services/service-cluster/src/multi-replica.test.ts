// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
    MULTI_REPLICA_CLUSTER_DRIVER,
    declaresMultiReplicaOnRedis,
    composedClusterDriver,
} from './multi-replica.js';

describe('declaresMultiReplicaOnRedis (cloud#3814 R3: declared replicas AND the Redis driver)', () => {
    it('true for declared replicas over the Redis driver, by either declaration', () => {
        expect(MULTI_REPLICA_CLUSTER_DRIVER).toBe('redis');
        expect(declaresMultiReplicaOnRedis({ OS_CLUSTER_REPLICAS: '3' }, 'redis')).toBe(true);
        expect(declaresMultiReplicaOnRedis({ OS_EXPECT_MULTI_NODE: 'true' }, 'redis')).toBe(true);
        expect(declaresMultiReplicaOnRedis({ OS_CLUSTER_REPLICAS: '2' }, ' redis ')).toBe(true);
    });

    it('false on a single node, whatever the driver', () => {
        expect(declaresMultiReplicaOnRedis({}, 'redis')).toBe(false);
        expect(declaresMultiReplicaOnRedis({ OS_CLUSTER_REPLICAS: '1' }, 'redis')).toBe(false);
        expect(declaresMultiReplicaOnRedis({ OS_EXPECT_MULTI_NODE: 'false' }, 'redis')).toBe(false);
    });

    it('false for declared replicas on any other driver, or none', () => {
        const declared = { OS_CLUSTER_REPLICAS: '3' };
        expect(declaresMultiReplicaOnRedis(declared, 'memory')).toBe(false);
        // The split-brain guard's escape hatch lets replicas boot on the
        // in-process driver; it does not make them Redis.
        expect(declaresMultiReplicaOnRedis({ ...declared, OS_ALLOW_MEMORY_CLUSTER_MULTINODE: 'true' }, 'memory')).toBe(false);
        expect(declaresMultiReplicaOnRedis(declared, 'nats')).toBe(false);
        expect(declaresMultiReplicaOnRedis(declared, undefined)).toBe(false);
    });
});

describe('composedClusterDriver', () => {
    const services = (cluster: unknown) => ({
        getService: <T,>(name: string): T => {
            if (name !== 'cluster' || cluster === undefined) throw new Error(`no ${name}`);
            return cluster as T;
        },
    });

    it('reads the composed cluster service\'s driver', () => {
        expect(composedClusterDriver(services({ driver: 'redis' }))).toBe('redis');
        expect(composedClusterDriver(services({ driver: 'memory' }))).toBe('memory');
    });

    it('undefined, never a throw, when no cluster service is composed or it names no driver', () => {
        expect(composedClusterDriver(services(undefined))).toBeUndefined();
        expect(composedClusterDriver(services({}))).toBeUndefined();
        expect(composedClusterDriver(services({ driver: 42 }))).toBeUndefined();
    });
});
