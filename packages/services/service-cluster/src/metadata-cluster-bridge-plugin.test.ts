// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13331] `MetadataClusterBridgePlugin` — first test file for this plugin,
 * written with the protocol lane it gains here.
 *
 * The composition case that matters most is the shipped EE shape (⭐ below):
 * a TS-config host boot fills the `metadata` slot with the kernel's in-memory
 * core fallback (no `attachClusterPubSub`) while the `protocol` service is the
 * real `ObjectStackProtocolImplementation`. Pre-fix, that boot warned
 * "cross-node cache invalidation disabled" and attached NOTHING — and every
 * replica but the writer answered OBJECT_NOT_FOUND for runtime-authored
 * objects, indefinitely. The mutation lane must attach exactly there, without
 * the metadata-service lane's absence taking it down.
 *
 * ⚠️ Lane 1's in-process-driver behaviour (it attaches and logs "bridged" on
 * the memory driver that fans out to nobody) is #14021's card, NOT pinned
 * here — these cases drive lane 1 only through its warn/absence paths so that
 * card stays free to fix it. Lane 2 carries the `isInProcessClusterDriver`
 * guard from birth, and that IS pinned here.
 */

import { describe, it, expect, vi } from 'vitest';
import type { PluginContext } from '@objectstack/core';
import { MetadataClusterBridgePlugin } from './metadata-cluster-bridge-plugin.js';

interface HarnessOptions {
    /**
     * Cluster driver name, or `null` for "no cluster service registered" — a
     * SENTINEL, not `undefined`, because an explicit `undefined` re-applies
     * the destructuring default (#6621's shape, warned about in
     * `protocol.delete-object-registry-unregister.test.ts`).
     */
    driver?: string | null;
    /**
     * The `metadata` slot: `'none'` (getService throws), `'fallback'` (present,
     * no attachClusterPubSub — the host-config boot's core fallback), or
     * `'manager'` (exposes attachClusterPubSub).
     */
    metadata?: 'none' | 'fallback' | 'manager';
    /**
     * The `protocol` slot: `'none'`, `'bare'` (present, no
     * attachMetadataMutationPubSub — an older or foreign implementation), or
     * `'real'` (exposes attachMetadataMutationPubSub).
     */
    protocol?: 'none' | 'bare' | 'real';
}

function makeHarness(opts: HarnessOptions = {}) {
    const { driver = 'redis', metadata = 'fallback', protocol = 'real' } = opts;

    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const detachMetadata = vi.fn();
    const attachMetadata = vi.fn((_pubsub: unknown, _nodeId: string) => detachMetadata);
    const detachMutation = vi.fn();
    const attachMutation = vi.fn((_pubsub: unknown, _nodeId: string) => detachMutation);

    const pubsub = { publish: vi.fn(), subscribe: vi.fn(), close: vi.fn() };
    const cluster =
        driver === null
            ? undefined
            : { nodeId: 'node-a', driver, pubsub, lock: {}, kv: {}, counter: {}, close: vi.fn() };

    const metadataService =
        metadata === 'none' ? undefined
        : metadata === 'fallback' ? { get: vi.fn(), list: vi.fn() }
        : { attachClusterPubSub: attachMetadata };
    const protocolService =
        protocol === 'none' ? undefined
        : protocol === 'bare' ? { saveMetaItem: vi.fn() }
        : { attachMetadataMutationPubSub: attachMutation };

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
            if (name === 'metadata') {
                if (!metadataService) throw new Error('service not found: metadata');
                return metadataService;
            }
            if (name === 'protocol') {
                if (!protocolService) throw new Error('service not found: protocol');
                return protocolService;
            }
            throw new Error(`service not found: ${name}`);
        },
    } as unknown as PluginContext;

    const fire = async (name: string) => {
        for (const h of hooks.get(name) ?? []) await h();
    };

    return {
        ctx, logger, fire, pubsub,
        attachMetadata, detachMetadata, attachMutation, detachMutation,
    };
}

const infoLines = (h: ReturnType<typeof makeHarness>) =>
    h.logger.info.mock.calls.map((c) => String(c[0]));
const warnLines = (h: ReturnType<typeof makeHarness>) =>
    h.logger.warn.mock.calls.map((c) => String(c[0]));

describe('[#13331] ⭐ the shipped EE shape — fallback metadata slot, real protocol', () => {
    it('warns for lane 1 AND attaches lane 2 in the same boot', async () => {
        const h = makeHarness({ driver: 'redis', metadata: 'fallback', protocol: 'real' });
        await new MetadataClusterBridgePlugin().init(h.ctx);
        await h.fire('kernel:ready');

        // Lane 1's statement stays true and VERBATIM on this boot: the
        // metadata SERVICE has no cluster seam there. (The card's original
        // boot symptom — the line other measurements matched byte-for-byte.)
        expect(warnLines(h)).toContain(
            'MetadataClusterBridgePlugin: metadata service does not expose attachClusterPubSub(); cross-node cache invalidation disabled',
        );
        // …and pre-fix that warn was the END of the story. Now the mutation
        // lane attaches regardless of lane 1's outcome.
        expect(h.attachMutation).toHaveBeenCalledTimes(1);
        expect(h.attachMutation).toHaveBeenCalledWith(h.pubsub, 'node-a');
        expect(infoLines(h).some((l) => l.includes('bridged metadata.mutated'))).toBe(true);
    });

    it('a MISSING metadata service does not take the mutation lane down either', async () => {
        const h = makeHarness({ driver: 'redis', metadata: 'none', protocol: 'real' });
        await new MetadataClusterBridgePlugin().init(h.ctx);
        await h.fire('kernel:ready');

        expect(h.attachMutation).toHaveBeenCalledTimes(1);
    });
});

describe('[#13331] the mutation lane’s own guards', () => {
    it('skips attach on the in-process memory driver — no peers to reach', async () => {
        const h = makeHarness({ driver: 'memory', protocol: 'real' });
        await new MetadataClusterBridgePlugin().init(h.ctx);
        await h.fire('kernel:ready');

        // The guard `AuthzClusterBridgePlugin` uses, applied from birth: an
        // in-process bus fans out to nobody, and logging "bridged" over it is
        // the misreading #14021 records for lane 1.
        expect(h.attachMutation).not.toHaveBeenCalled();
        expect(infoLines(h).some((l) => l.includes('metadata.mutated'))).toBe(false);
    });

    it('skips quietly when no protocol service is registered', async () => {
        const h = makeHarness({ driver: 'redis', protocol: 'none' });
        await new MetadataClusterBridgePlugin().init(h.ctx);
        await h.fire('kernel:ready');

        expect(h.attachMutation).not.toHaveBeenCalled();
        expect(h.logger.error).not.toHaveBeenCalled();
    });

    it('skips quietly when the protocol does not expose the seam', async () => {
        const h = makeHarness({ driver: 'redis', protocol: 'bare' });
        await new MetadataClusterBridgePlugin().init(h.ctx);
        await h.fire('kernel:ready');

        expect(h.attachMutation).not.toHaveBeenCalled();
        expect(h.logger.error).not.toHaveBeenCalled();
    });

    it('no cluster service at all skips BOTH lanes', async () => {
        const h = makeHarness({ driver: null, metadata: 'manager', protocol: 'real' });
        await new MetadataClusterBridgePlugin().init(h.ctx);
        await h.fire('kernel:ready');

        expect(h.attachMetadata).not.toHaveBeenCalled();
        expect(h.attachMutation).not.toHaveBeenCalled();
    });
});

describe('[#13331] both lanes present, and both released on shutdown', () => {
    it('a manager metadata service and a real protocol both attach', async () => {
        const h = makeHarness({ driver: 'redis', metadata: 'manager', protocol: 'real' });
        await new MetadataClusterBridgePlugin().init(h.ctx);
        await h.fire('kernel:ready');

        expect(h.attachMetadata).toHaveBeenCalledWith(h.pubsub, 'node-a');
        expect(h.attachMutation).toHaveBeenCalledWith(h.pubsub, 'node-a');
        expect(warnLines(h)).toEqual([]);
    });

    it('kernel:shutdown detaches both lanes', async () => {
        const h = makeHarness({ driver: 'redis', metadata: 'manager', protocol: 'real' });
        await new MetadataClusterBridgePlugin().init(h.ctx);
        await h.fire('kernel:ready');
        await h.fire('kernel:shutdown');

        expect(h.detachMetadata).toHaveBeenCalledTimes(1);
        expect(h.detachMutation).toHaveBeenCalledTimes(1);
    });

    it('a throwing lane-1 detach does not strand lane 2’s', async () => {
        const h = makeHarness({ driver: 'redis', metadata: 'manager', protocol: 'real' });
        h.detachMetadata.mockImplementation(() => { throw new Error('detach exploded'); });
        await new MetadataClusterBridgePlugin().init(h.ctx);
        await h.fire('kernel:ready');
        await h.fire('kernel:shutdown');

        expect(h.detachMutation).toHaveBeenCalledTimes(1);
        expect(h.logger.error).toHaveBeenCalled();
    });
});
