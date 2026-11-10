// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
    MULTI_REPLICA_CLUSTER_DRIVER,
    declaresMultiReplicaOnRedis,
    composedClusterDriver,
    multiReplicaMaintenanceWindowRecipe,
} from './multi-replica.js';

/**
 * [#32265] The recipe every multi-replica package refusal names (the runtime
 * package doors and the install-local doors) has to lift the declaration it is
 * spelled beside: the settings it tells the operator to give the one replica,
 * read from the recipe's own text the way an operator reads them (each
 * `NAME=value` and each `NAME unset`), applied over either declaration, make
 * `declaresMultiReplicaOnRedis` read false; restoring the declaration makes it
 * read true again. A recipe naming no settings leaves the declaration standing,
 * so the first expectation goes red rather than passing over an empty map.
 */
describe('multiReplicaMaintenanceWindowRecipe (#32265: the steps lift the declaration they are spelled beside)', () => {
    function recipeSettings(recipe: string): Record<string, string | undefined> {
        const settings: Record<string, string | undefined> = {};
        for (const m of recipe.matchAll(/\b(OS_[A-Z0-9_]+)=([^\s,;]+)/g)) settings[m[1]] = m[2];
        for (const m of recipe.matchAll(/\b(OS_[A-Z0-9_]+) unset\b/g)) settings[m[1]] = undefined;
        return settings;
    }

    for (const declared of [{ OS_CLUSTER_REPLICAS: '3' }, { OS_EXPECT_MULTI_NODE: 'true' }, { OS_CLUSTER_REPLICAS: '2', OS_EXPECT_MULTI_NODE: 'true' }]) {
        it(`${JSON.stringify(declared)}: the settings the recipe names lift it on the one replica, and restoring it stands again`, () => {
            const recipe = multiReplicaMaintenanceWindowRecipe('repeat the request');
            expect(declaresMultiReplicaOnRedis(declared, 'redis')).toBe(true);
            const lifted = { ...declared, ...recipeSettings(recipe) };
            expect(declaresMultiReplicaOnRedis(lifted, 'redis'), recipe).toBe(false);
            expect(declaresMultiReplicaOnRedis({ ...lifted, ...declared }, 'redis')).toBe(true);
        });
    }

    it('names the act the caller hands it, run against that one replica', () => {
        expect(multiReplicaMaintenanceWindowRecipe('run the install')).toContain('run the install against that replica');
        expect(multiReplicaMaintenanceWindowRecipe('repeat the request')).toContain('repeat the request against that replica');
    });
});

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
