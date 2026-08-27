// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#11968] The boot-time posture statement, pinned where it actually happens.
 *
 * `authz-cache-posture.test.ts` in `@objectstack/core` pins the DECISION —
 * given a TTL and a bus state, is the line loud, quiet or absent. This file
 * pins the BOOT: which bus state a real composition resolves to, and therefore
 * whether the line comes out at all. The two halves are separable and both are
 * needed — a perfect decision function reached with the wrong input is silent
 * in exactly the deployment the ruling made this non-optional for.
 *
 * ⭐ Both arms of the card's acceptance criterion are asserted here:
 *
 *   - the line appears **exactly when** a cache flag is on with no cross-node
 *     bus — including the case that reads as "bus present" and is not: `Runtime`
 *     registers the MEMORY cluster driver by default, so `getService('cluster')`
 *     succeeds while nothing crosses a process boundary;
 *   - and **not otherwise** — with the shipped default (`0`) this plugin
 *     attaches nothing, publishes nothing, and says nothing above `debug`.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { PluginContext } from '@objectstack/core';
import { AuthzClusterBridgePlugin } from './authz-cluster-bridge-plugin.js';

const TTL_ENV = 'OS_AUTHZ_GRANTS_CACHE_TTL_MS';

interface HarnessOptions {
    /** Cluster driver name, or `undefined` for "no cluster service registered". */
    driver?: string;
    /** When false, `getService('objectql')` throws — no engine seam to attach to. */
    engine?: boolean;
    /** When true, the engine's attach method throws. */
    attachThrows?: boolean;
}

function makeHarness(opts: HarnessOptions = {}) {
    const { driver, engine = true, attachThrows = false } = opts;

    const logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    };

    const attach = vi.fn(() => {
        if (attachThrows) throw new Error('attach exploded');
        return detach;
    });
    const detach = vi.fn();

    const pubsub = { publish: vi.fn(), subscribe: vi.fn(), close: vi.fn() };
    const cluster =
        driver === undefined
            ? undefined
            : { nodeId: 'node-a', driver, pubsub, lock: {}, kv: {}, counter: {}, close: vi.fn() };

    const hooks = new Map<string, Array<() => Promise<void> | void>>();
    const ctx = {
        logger,
        hook(name: string, handler: () => Promise<void> | void) {
            const list = hooks.get(name) ?? [];
            list.push(handler);
            hooks.set(name, list);
        },
        getService(name: string) {
            if (name === 'cluster') {
                if (!cluster) throw new Error('service not found: cluster');
                return cluster;
            }
            if (name === 'objectql') {
                if (!engine) throw new Error('service not found: objectql');
                return { attachAuthzInvalidationPubSub: attach };
            }
            throw new Error(`service not found: ${name}`);
        },
    } as unknown as PluginContext;

    const fire = async (name: string) => {
        for (const h of hooks.get(name) ?? []) await h();
    };

    return { ctx, logger, attach, detach, fire, pubsub };
}

afterEach(() => {
    vi.unstubAllEnvs();
});

describe('[#11968] ⭐ the silent arm — the shipped default is inert', () => {
    it('says nothing above debug and attaches nothing when the cache is off', async () => {
        // The card's own acceptance criterion: substrate landed, no cache
        // consumers, runtime behaviour unchanged. A courtesy line on every
        // default boot is how the loud line below stops being loud.
        vi.stubEnv(TTL_ENV, '');
        const h = makeHarness({ driver: 'memory' });
        await new AuthzClusterBridgePlugin().init(h.ctx);
        await h.fire('kernel:ready');

        expect(h.logger.warn).not.toHaveBeenCalled();
        expect(h.logger.info).not.toHaveBeenCalled();
        expect(h.attach).not.toHaveBeenCalled();
    });

    it('an explicit 0 is the same real path, not a degenerate TTL', async () => {
        vi.stubEnv(TTL_ENV, '0');
        const h = makeHarness({ driver: 'redis' });
        await new AuthzClusterBridgePlugin().init(h.ctx);
        await h.fire('kernel:ready');

        expect(h.logger.warn).not.toHaveBeenCalled();
        expect(h.logger.info).not.toHaveBeenCalled();
        expect(h.attach).not.toHaveBeenCalled();
    });
});

describe('[#11968] ⭐ the loud arm — an enabled cache with no bus is stated', () => {
    it('warns when NO cluster service is registered at all', async () => {
        vi.stubEnv(TTL_ENV, '5000');
        const h = makeHarness({ driver: undefined });
        await new AuthzClusterBridgePlugin().init(h.ctx);
        await h.fire('kernel:ready');

        expect(h.logger.warn).toHaveBeenCalledTimes(1);
        expect(h.logger.warn.mock.calls[0][0]).toMatch(/NO .*invalidation bus/);
        expect(h.attach).not.toHaveBeenCalled();
    });

    it('⭐ warns when the cluster service exists but its driver is IN-PROCESS', async () => {
        // The case a "is a cluster service registered?" check answers `yes` to
        // and is wrong about: `Runtime` registers the memory driver by default,
        // so this is the DEFAULT multi-replica deployment, not an exotic one.
        vi.stubEnv(TTL_ENV, '5000');
        const h = makeHarness({ driver: 'memory' });
        await new AuthzClusterBridgePlugin().init(h.ctx);
        await h.fire('kernel:ready');

        expect(h.logger.warn).toHaveBeenCalledTimes(1);
        expect(h.logger.warn.mock.calls[0][0]).toContain('memory');
        expect(h.attach).not.toHaveBeenCalled();
    });

    it('warns when a remote driver exists but the engine exposes no seam', async () => {
        vi.stubEnv(TTL_ENV, '5000');
        const h = makeHarness({ driver: 'redis', engine: false });
        await new AuthzClusterBridgePlugin().init(h.ctx);
        await h.fire('kernel:ready');

        expect(h.logger.warn).toHaveBeenCalledTimes(1);
        expect(h.attach).not.toHaveBeenCalled();
    });

    it('a FAILED attach is reported as no bus, never as a bridged one', async () => {
        vi.stubEnv(TTL_ENV, '5000');
        const h = makeHarness({ driver: 'redis', attachThrows: true });
        await new AuthzClusterBridgePlugin().init(h.ctx);
        await h.fire('kernel:ready');

        expect(h.logger.error).toHaveBeenCalled();
        expect(h.logger.warn).toHaveBeenCalledTimes(1);
    });

    it('a malformed TTL warns on its own — "we read your setting as off" is not inferable', async () => {
        vi.stubEnv(TTL_ENV, '5OOO');
        const h = makeHarness({ driver: 'memory' });
        await new AuthzClusterBridgePlugin().init(h.ctx);
        await h.fire('kernel:ready');

        expect(h.logger.warn).toHaveBeenCalledTimes(1);
        expect(h.logger.warn.mock.calls[0][0]).toContain(TTL_ENV);
        expect(h.attach).not.toHaveBeenCalled();
    });
});

describe('[#11968] the bridged arm — enabled cache, remote driver', () => {
    it('attaches the channel and states the posture at info, not warn', async () => {
        vi.stubEnv(TTL_ENV, '5000');
        const h = makeHarness({ driver: 'redis' });
        await new AuthzClusterBridgePlugin().init(h.ctx);
        await h.fire('kernel:ready');

        expect(h.attach).toHaveBeenCalledTimes(1);
        expect(h.attach.mock.calls[0][1]).toBe('node-a');
        expect(h.logger.warn).not.toHaveBeenCalled();
        expect(h.logger.info).toHaveBeenCalledTimes(1);
        expect(h.logger.info.mock.calls[0][0]).toMatch(/TTL remains the correctness bound/);
    });

    it('shutdown detaches what boot attached', async () => {
        vi.stubEnv(TTL_ENV, '5000');
        const h = makeHarness({ driver: 'redis' });
        const plugin = new AuthzClusterBridgePlugin();
        await plugin.init(h.ctx);
        await h.fire('kernel:ready');
        await h.fire('kernel:shutdown');

        expect(h.detach).toHaveBeenCalledTimes(1);

        // Idempotent: a second shutdown does not detach twice.
        await h.fire('kernel:shutdown');
        expect(h.detach).toHaveBeenCalledTimes(1);
    });

    it('shutdown with nothing attached is a no-op, not a throw', async () => {
        vi.stubEnv(TTL_ENV, '0');
        const h = makeHarness({ driver: 'memory' });
        const plugin = new AuthzClusterBridgePlugin();
        await plugin.init(h.ctx);
        await h.fire('kernel:ready');
        await expect(h.fire('kernel:shutdown')).resolves.toBeUndefined();
        expect(h.logger.error).not.toHaveBeenCalled();
    });
});
