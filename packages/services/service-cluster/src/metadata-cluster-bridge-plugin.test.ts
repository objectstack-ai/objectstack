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
 * ⚠️ Lane 1's in-process-driver behaviour (it attached and logged "bridged"
 * on the memory driver that fans out to nobody) was #14021's card, and the
 * #13331 cases below deliberately do NOT pin it — they drive lane 1 only
 * through its warn/absence paths so that card stayed free to fix it.
 *
 * [#14021] It is fixed: lane 1 now carries the same `isInProcessClusterDriver`
 * guard lane 2 was born with. The block at the BOTTOM of this file pins it,
 * together with the cross-process control that keeps the guard honest —
 * without that control a guard is indistinguishable from "never say bridged".
 */

import { afterEach, describe, it, expect, vi } from 'vitest';
import type { PluginContext } from '@objectstack/core';
import { MetadataClusterBridgePlugin } from './metadata-cluster-bridge-plugin.js';
import { ClusterDriverLiveness, offerClusterDriverLiveness } from './cluster-resync.js';

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
    /**
     * [#13805] The `datasource-admin` slot: `'none'` (getService throws — the
     * default, so the #13331 cases above read exactly as they did), `'bare'`
     * (present, no attachDatasourceMutationPubSub — an older implementation),
     * or `'real'` (exposes attachDatasourceMutationPubSub).
     */
    datasourceAdmin?: 'none' | 'bare' | 'real';
    /** When true, the datasource-admin seam throws on attach. */
    datasourceAttachThrows?: boolean;
    /**
     * [#27428] The `automation` slot: `'none'` (getService throws — the
     * default, so every earlier case reads exactly as it did), `'bare'`
     * (present, no attachConnectorCredentialPubSub — an older implementation),
     * or `'real'` (exposes attachConnectorCredentialPubSub).
     */
    automation?: 'none' | 'bare' | 'real';
    /** When true, the automation seam throws on attach. */
    automationAttachThrows?: boolean;
    /**
     * [#31597] The `settings` slot: `'none'` (getService throws — the default,
     * so every earlier case reads exactly as it did), `'bare'` (present, no
     * attachSettingsChangePubSub — an older implementation), or `'real'`
     * (exposes attachSettingsChangePubSub).
     */
    settings?: 'none' | 'bare' | 'real';
    /** When true, the settings seam throws on attach. */
    settingsAttachThrows?: boolean;
}

function makeHarness(opts: HarnessOptions = {}) {
    const {
        driver = 'redis', metadata = 'fallback', protocol = 'real',
        datasourceAdmin = 'none', datasourceAttachThrows = false,
        automation = 'none', automationAttachThrows = false,
        settings = 'none', settingsAttachThrows = false,
    } = opts;

    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const detachMetadata = vi.fn();
    const attachMetadata = vi.fn((_pubsub: unknown, _nodeId: string) => detachMetadata);
    const detachMutation = vi.fn();
    const attachMutation = vi.fn((_pubsub: unknown, _nodeId: string) => detachMutation);
    const detachDatasource = vi.fn();
    const attachDatasource = vi.fn((_pubsub: unknown, _nodeId: string) => {
        if (datasourceAttachThrows) throw new Error('datasource attach exploded');
        return detachDatasource;
    });
    const detachCredential = vi.fn();
    const attachCredential = vi.fn((_pubsub: unknown, _nodeId: string) => {
        if (automationAttachThrows) throw new Error('automation attach exploded');
        return detachCredential;
    });

    const detachSettings = vi.fn();
    const attachSettings = vi.fn((_pubsub: unknown, _nodeId: string) => {
        if (settingsAttachThrows) throw new Error('settings attach exploded');
        return detachSettings;
    });

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
    const datasourceAdminService =
        datasourceAdmin === 'none' ? undefined
        : datasourceAdmin === 'bare' ? { listDatasources: vi.fn() }
        : { attachDatasourceMutationPubSub: attachDatasource };
    const automationService =
        automation === 'none' ? undefined
        : automation === 'bare' ? { execute: vi.fn() }
        : { attachConnectorCredentialPubSub: attachCredential };
    const settingsService =
        settings === 'none' ? undefined
        : settings === 'bare' ? { get: vi.fn(), subscribe: vi.fn() }
        : { attachSettingsChangePubSub: attachSettings };

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
            if (name === 'datasource-admin') {
                if (!datasourceAdminService) throw new Error('service not found: datasource-admin');
                return datasourceAdminService;
            }
            if (name === 'automation') {
                if (!automationService) throw new Error('service not found: automation');
                return automationService;
            }
            if (name === 'settings') {
                if (!settingsService) throw new Error('service not found: settings');
                return settingsService;
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
        attachDatasource, detachDatasource,
        attachCredential, detachCredential,
        attachSettings, detachSettings,
    };
}

const infoLines = (h: ReturnType<typeof makeHarness>) =>
    h.logger.info.mock.calls.map((c) => String(c[0]));
const warnLines = (h: ReturnType<typeof makeHarness>) =>
    h.logger.warn.mock.calls.map((c) => String(c[0]));
const debugLines = (h: ReturnType<typeof makeHarness>) =>
    h.logger.debug.mock.calls.map((c) => String(c[0]));

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

describe('[#14021] lane 1 — an in-process bus must not be reported as “bridged”', () => {
    it('skips the attach and never claims “bridged” on the memory driver', async () => {
        const h = makeHarness({ driver: 'memory', metadata: 'manager', protocol: 'real' });
        await new MetadataClusterBridgePlugin().init(h.ctx);
        await h.fire('kernel:ready');

        // A cluster service IS registered here — `Runtime` registers the memory
        // driver by default — but it fans out to nobody. Reporting this as
        // “bridged” is the exact misreading the posture statement exists to
        // prevent: a false positive, not a quiet negative. The attach is
        // skipped rather than merely relabelled, which is what BOTH in-tree
        // exemplars do (`AuthzClusterBridgePlugin`, and lane 2 below).
        expect(h.attachMetadata).not.toHaveBeenCalled();
        expect(infoLines(h).some((l) => l.includes('bridged metadata.changed'))).toBe(false);
        expect(
            debugLines(h).some(
                (l) => l.includes('is in-process') && l.includes('metadata.changed'),
            ),
        ).toBe(true);
    });

    it('⭐ reverse control — a cross-process driver STILL attaches and STILL claims “bridged”', async () => {
        const h = makeHarness({ driver: 'redis', metadata: 'manager', protocol: 'real' });
        await new MetadataClusterBridgePlugin().init(h.ctx);
        await h.fire('kernel:ready');

        // Without this arm the guard above is indistinguishable from a bridge
        // that never says “bridged” at all. The line is asserted VERBATIM
        // because its wording is what an operator reads as “fan-out is on”.
        expect(h.attachMetadata).toHaveBeenCalledTimes(1);
        expect(h.attachMetadata).toHaveBeenCalledWith(h.pubsub, 'node-a');
        expect(infoLines(h)).toContain(
            'MetadataClusterBridgePlugin: bridged metadata.changed → cluster.pubsub (node=node-a)',
        );
    });

    it('the in-process guard does not swallow #13331’s boot warn', async () => {
        const h = makeHarness({ driver: 'memory', metadata: 'fallback', protocol: 'real' });
        await new MetadataClusterBridgePlugin().init(h.ctx);
        await h.fire('kernel:ready');

        // Ordering pin: the seam-missing warn is evaluated BEFORE the driver
        // guard, exactly as in lane 2, so #13331's original boot symptom keeps
        // firing byte-for-byte on an in-process boot. Fixing a false positive
        // must not cost a true negative.
        expect(warnLines(h)).toContain(
            'MetadataClusterBridgePlugin: metadata service does not expose attachClusterPubSub(); cross-node cache invalidation disabled',
        );
        expect(h.attachMetadata).not.toHaveBeenCalled();
    });

    it('leaves nothing to detach when the in-process guard skipped the attach', async () => {
        const h = makeHarness({ driver: 'memory', metadata: 'manager', protocol: 'real' });
        await new MetadataClusterBridgePlugin().init(h.ctx);
        await h.fire('kernel:ready');
        await h.fire('kernel:shutdown');

        expect(h.detachMetadata).not.toHaveBeenCalled();
        expect(h.logger.error).not.toHaveBeenCalled();
    });
});

describe('[#13805] lane 3 — the datasource admin service’s datasource.mutated fan-out', () => {
    it('⭐ attaches on a cross-process driver and reports it — independently of lanes 1 and 2', async () => {
        // The shipped EE shape again, one owner over: no manager-backed
        // metadata slot, no protocol seam, and a real datasource-admin service.
        // Lane 3 must attach exactly there, with nothing from the other two
        // lanes taking it down.
        const h = makeHarness({ driver: 'redis', metadata: 'none', protocol: 'none', datasourceAdmin: 'real' });
        await new MetadataClusterBridgePlugin().init(h.ctx);
        await h.fire('kernel:ready');

        expect(h.attachDatasource).toHaveBeenCalledTimes(1);
        expect(h.attachDatasource).toHaveBeenCalledWith(h.pubsub, 'node-a');
        // Asserted VERBATIM, like lane 1's and lane 2's lines: the wording is
        // what an operator reads as "datasource fan-out is on".
        expect(infoLines(h)).toContain(
            'MetadataClusterBridgePlugin: bridged datasource.mutated → cluster.pubsub (node=node-a)',
        );
        expect(h.logger.error).not.toHaveBeenCalled();
    });

    it('all three lanes attach together when every owner exposes its seam', async () => {
        const h = makeHarness({ driver: 'redis', metadata: 'manager', protocol: 'real', datasourceAdmin: 'real' });
        await new MetadataClusterBridgePlugin().init(h.ctx);
        await h.fire('kernel:ready');

        expect(h.attachMetadata).toHaveBeenCalledWith(h.pubsub, 'node-a');
        expect(h.attachMutation).toHaveBeenCalledWith(h.pubsub, 'node-a');
        expect(h.attachDatasource).toHaveBeenCalledWith(h.pubsub, 'node-a');
        expect(warnLines(h)).toEqual([]);
    });

    it('skips attach on the in-process memory driver — no peers to reach, nothing said above debug', async () => {
        const h = makeHarness({ driver: 'memory', datasourceAdmin: 'real' });
        await new MetadataClusterBridgePlugin().init(h.ctx);
        await h.fire('kernel:ready');

        // The guard lanes 1 and 2 carry, from birth: on the memory driver a
        // single replica's behaviour stays byte-identical to the pre-bridge
        // one — no subscription, no publisher, no "bridged" claim.
        expect(h.attachDatasource).not.toHaveBeenCalled();
        expect(infoLines(h).some((l) => l.includes('datasource.mutated'))).toBe(false);
        expect(
            debugLines(h).some((l) => l.includes('is in-process') && l.includes('datasource fan-out')),
        ).toBe(true);
    });

    it('skips quietly when no datasource-admin service is registered', async () => {
        const h = makeHarness({ driver: 'redis', datasourceAdmin: 'none' });
        await new MetadataClusterBridgePlugin().init(h.ctx);
        await h.fire('kernel:ready');

        expect(h.attachDatasource).not.toHaveBeenCalled();
        expect(h.logger.error).not.toHaveBeenCalled();
        expect(warnLines(h).some((l) => l.includes('datasource'))).toBe(false);
    });

    it('skips quietly when the service does not expose the seam', async () => {
        const h = makeHarness({ driver: 'redis', datasourceAdmin: 'bare' });
        await new MetadataClusterBridgePlugin().init(h.ctx);
        await h.fire('kernel:ready');

        expect(h.attachDatasource).not.toHaveBeenCalled();
        expect(h.logger.error).not.toHaveBeenCalled();
    });

    it('no cluster service at all skips lane 3 too', async () => {
        const h = makeHarness({ driver: null, datasourceAdmin: 'real' });
        await new MetadataClusterBridgePlugin().init(h.ctx);
        await h.fire('kernel:ready');

        expect(h.attachDatasource).not.toHaveBeenCalled();
    });

    it('a throwing attach is reported and does not take the other lanes down', async () => {
        const h = makeHarness({
            driver: 'redis', metadata: 'manager', protocol: 'real',
            datasourceAdmin: 'real', datasourceAttachThrows: true,
        });
        await new MetadataClusterBridgePlugin().init(h.ctx);
        await h.fire('kernel:ready');

        expect(h.attachMetadata).toHaveBeenCalledTimes(1);
        expect(h.attachMutation).toHaveBeenCalledTimes(1);
        expect(h.logger.error).toHaveBeenCalledWith(
            'MetadataClusterBridgePlugin: datasource-lane attach failed',
            expect.any(Error),
        );
        expect(infoLines(h).some((l) => l.includes('datasource.mutated'))).toBe(false);
    });

    it('kernel:shutdown detaches lane 3, and a throwing lane-2 detach does not strand it', async () => {
        const h = makeHarness({ driver: 'redis', metadata: 'manager', protocol: 'real', datasourceAdmin: 'real' });
        h.detachMutation.mockImplementation(() => { throw new Error('detach exploded'); });
        await new MetadataClusterBridgePlugin().init(h.ctx);
        await h.fire('kernel:ready');
        await h.fire('kernel:shutdown');

        expect(h.detachDatasource).toHaveBeenCalledTimes(1);
        expect(h.logger.error).toHaveBeenCalled();

        // Idempotent: a second shutdown does not detach twice.
        await h.fire('kernel:shutdown');
        expect(h.detachDatasource).toHaveBeenCalledTimes(1);
    });
});

describe('[#27428] lane 4 — the automation service’s connector-credential.mutated fan-out', () => {
    it('⭐ attaches on a cross-process driver with the cluster’s pubsub and node id, and reports it — independently of lanes 1 to 3', async () => {
        const h = makeHarness({ driver: 'redis', metadata: 'none', protocol: 'none', automation: 'real' });
        await new MetadataClusterBridgePlugin().init(h.ctx);
        await h.fire('kernel:ready');

        expect(h.attachCredential).toHaveBeenCalledTimes(1);
        expect(h.attachCredential).toHaveBeenCalledWith(h.pubsub, 'node-a');
        expect(infoLines(h)).toContain(
            'MetadataClusterBridgePlugin: bridged connector-credential.mutated → cluster.pubsub (node=node-a)',
        );
    });

    it('all four lanes attach together when every owner exposes its seam', async () => {
        const h = makeHarness({
            driver: 'redis', metadata: 'manager', protocol: 'real', datasourceAdmin: 'real', automation: 'real',
        });
        await new MetadataClusterBridgePlugin().init(h.ctx);
        await h.fire('kernel:ready');

        expect(h.attachMetadata).toHaveBeenCalledTimes(1);
        expect(h.attachMutation).toHaveBeenCalledTimes(1);
        expect(h.attachDatasource).toHaveBeenCalledTimes(1);
        expect(h.attachCredential).toHaveBeenCalledTimes(1);
    });

    it('skips attach on the in-process memory driver — no peers to reach, nothing said above debug', async () => {
        const h = makeHarness({ driver: 'memory', automation: 'real' });
        await new MetadataClusterBridgePlugin().init(h.ctx);
        await h.fire('kernel:ready');

        expect(h.attachCredential).not.toHaveBeenCalled();
        expect(infoLines(h).some((l) => l.includes('connector-credential.mutated'))).toBe(false);
        expect(
            debugLines(h).some((l) => l.includes('is in-process') && l.includes('connector-credential fan-out')),
        ).toBe(true);
    });

    it('skips quietly when no automation service is registered, or it does not expose the seam', async () => {
        for (const automation of ['none', 'bare'] as const) {
            const h = makeHarness({ driver: 'redis', automation });
            await new MetadataClusterBridgePlugin().init(h.ctx);
            await h.fire('kernel:ready');

            expect(h.attachCredential).not.toHaveBeenCalled();
            expect(h.logger.error).not.toHaveBeenCalled();
            expect(warnLines(h).some((l) => l.includes('connector-credential'))).toBe(false);
        }
    });

    it('a throwing attach is reported and does not take the other lanes down', async () => {
        const h = makeHarness({
            driver: 'redis', metadata: 'manager', protocol: 'real', datasourceAdmin: 'real',
            automation: 'real', automationAttachThrows: true,
        });
        await new MetadataClusterBridgePlugin().init(h.ctx);
        await h.fire('kernel:ready');

        expect(h.attachDatasource).toHaveBeenCalledTimes(1);
        expect(h.logger.error).toHaveBeenCalledWith(
            'MetadataClusterBridgePlugin: connector-credential-lane attach failed',
            expect.any(Error),
        );
        expect(infoLines(h).some((l) => l.includes('connector-credential.mutated'))).toBe(false);
    });

    it('kernel:shutdown detaches lane 4, and a throwing lane-3 detach does not strand it', async () => {
        const h = makeHarness({ driver: 'redis', datasourceAdmin: 'real', automation: 'real' });
        h.detachDatasource.mockImplementation(() => { throw new Error('detach exploded'); });
        await new MetadataClusterBridgePlugin().init(h.ctx);
        await h.fire('kernel:ready');
        await h.fire('kernel:shutdown');

        expect(h.detachCredential).toHaveBeenCalledTimes(1);
        expect(h.logger.error).toHaveBeenCalled();

        // Idempotent: a second shutdown does not detach twice.
        await h.fire('kernel:shutdown');
        expect(h.detachCredential).toHaveBeenCalledTimes(1);
    });
});

describe('cluster.resync — every attached lane re-reads what an outage made it miss', () => {
    /** The harness, with lanes 1, 3 and 4 attached and a driver liveness offered on its cluster. */
    function resyncHarness(opts: { driver?: string; laneThrows?: boolean } = {}) {
        const h = makeHarness({
            driver: opts.driver ?? 'redis', metadata: 'manager', protocol: 'real',
            datasourceAdmin: 'real', automation: 'real',
        });
        const svc = (name: string) => h.ctx.getService<Record<string, unknown>>(name);
        const resyncMetadata = vi.fn();
        const resyncDatasource = vi.fn(async () => {
            if (opts.laneThrows) throw new Error('datasource store unreachable');
        });
        const resyncCredential = vi.fn(async () => {});
        // [#31722] Lane 2's seam, on the protocol.
        const resyncProtocol = vi.fn(async () => {});
        Object.assign(svc('protocol'), { resyncMetadataMutationPubSub: resyncProtocol });
        Object.assign(svc('metadata'), { resyncClusterPubSub: resyncMetadata });
        Object.assign(svc('datasource-admin'), { resyncDatasourceMutationPubSub: resyncDatasource });
        Object.assign(svc('automation'), { resyncConnectorCredentialPubSub: resyncCredential });
        const liveness = new ClusterDriverLiveness({ driver: 'redis', nodeId: 'node-a', logger: { warn: vi.fn(), info: vi.fn() } });
        offerClusterDriverLiveness(svc('cluster'), liveness);
        const outage = async () => {
            liveness.reportUp('command');
            liveness.reportDown('command', new Error('ECONNREFUSED'));
            liveness.reportUp('command');
            await new Promise((r) => setTimeout(r, 0));
        };
        return { ...h, outage, resyncMetadata, resyncProtocol, resyncDatasource, resyncCredential };
    }

    it('calls each attached lane’s resync seam once per recovered outage', async () => {
        const h = resyncHarness();
        await new MetadataClusterBridgePlugin().init(h.ctx);
        await h.fire('kernel:ready');
        expect(h.resyncMetadata).not.toHaveBeenCalled();

        await h.outage();
        expect(h.resyncMetadata).toHaveBeenCalledTimes(1);
        expect(h.resyncProtocol).toHaveBeenCalledTimes(1);
        expect(h.resyncDatasource).toHaveBeenCalledTimes(1);
        expect(h.resyncCredential).toHaveBeenCalledTimes(1);
        expect(infoLines(h).some((l) => l.includes(
            'resynced metadata.changed, metadata.mutated, datasource.mutated, connector-credential.mutated',
        ))).toBe(true);

        await h.outage();
        expect(h.resyncMetadata).toHaveBeenCalledTimes(2);
        expect(h.resyncProtocol).toHaveBeenCalledTimes(2);
    });

    it('one lane failing is a warning and does not stop the others', async () => {
        const h = resyncHarness({ laneThrows: true });
        await new MetadataClusterBridgePlugin().init(h.ctx);
        await h.fire('kernel:ready');
        await h.outage();
        expect(h.resyncMetadata).toHaveBeenCalledTimes(1);
        expect(h.resyncProtocol).toHaveBeenCalledTimes(1);
        expect(h.resyncCredential).toHaveBeenCalledTimes(1);
        expect(warnLines(h).filter((l) => l.includes('datasource.mutated resync after'))).toHaveLength(1);
    });

    it('after kernel:shutdown a later reconnect calls nothing', async () => {
        const h = resyncHarness();
        await new MetadataClusterBridgePlugin().init(h.ctx);
        await h.fire('kernel:ready');
        await h.fire('kernel:shutdown');
        await h.outage();
        expect(h.resyncMetadata).not.toHaveBeenCalled();
        expect(h.resyncProtocol).not.toHaveBeenCalled();
    });

    it('CONTROL — the in-process memory driver attaches no lane, so no resync is wired', async () => {
        const h = resyncHarness({ driver: 'memory' });
        await new MetadataClusterBridgePlugin().init(h.ctx);
        await h.fire('kernel:ready');
        await h.outage();
        expect(h.resyncMetadata).not.toHaveBeenCalled();
        expect(h.resyncProtocol).not.toHaveBeenCalled();
        expect(h.resyncDatasource).not.toHaveBeenCalled();
        expect(h.resyncCredential).not.toHaveBeenCalled();
    });

    it('[#31722] lane 2 — a protocol that predates the seam is bridged and simply not resynced', async () => {
        const h = resyncHarness();
        delete (h.ctx.getService<Record<string, unknown>>('protocol') as Record<string, unknown>).resyncMetadataMutationPubSub;
        await new MetadataClusterBridgePlugin().init(h.ctx);
        await h.fire('kernel:ready');
        expect(h.attachMutation).toHaveBeenCalledTimes(1);

        await h.outage();
        expect(h.resyncProtocol).not.toHaveBeenCalled();
        expect(h.resyncMetadata).toHaveBeenCalledTimes(1);
        expect(infoLines(h).some((l) => l.includes('resynced metadata.changed, datasource.mutated, connector-credential.mutated'))).toBe(true);
    });

    it('[#31722] lane 2 — a rejected protocol resync is a warning; the other lanes still run', async () => {
        const h = resyncHarness();
        h.resyncProtocol.mockRejectedValueOnce(new Error('sys_metadata read failed'));
        await new MetadataClusterBridgePlugin().init(h.ctx);
        await h.fire('kernel:ready');
        await h.outage();
        expect(h.resyncProtocol).toHaveBeenCalledTimes(1);
        expect(h.resyncDatasource).toHaveBeenCalledTimes(1);
        expect(warnLines(h).filter((l) => l.includes('metadata.mutated resync after'))).toHaveLength(1);
    });
});

describe('[#31597] lane 5 — the settings service’s settings.changed fan-out, behind declared replicas over redis', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });
    /** Declare (or not) several replicas, the R3 switch the lane keys on. */
    const declare = (replicas: string) => {
        vi.stubEnv('OS_CLUSTER_REPLICAS', replicas);
        vi.stubEnv('OS_EXPECT_MULTI_NODE', '');
    };

    it('⭐ attaches with the cluster’s pubsub and node id when 2 replicas are declared over redis, and reports it', async () => {
        declare('2');
        const h = makeHarness({ settings: 'real' });
        await new MetadataClusterBridgePlugin().init(h.ctx);
        await h.fire('kernel:ready');
        await h.fire('kernel:bootstrapped');
        expect(h.attachSettings).toHaveBeenCalledTimes(1);
        expect(h.attachSettings).toHaveBeenCalledWith(h.pubsub, 'node-a');
        expect(infoLines(h).some((l) => l.includes('bridged settings.changed'))).toBe(true);
    });

    it('binds at kernel:bootstrapped, after the settings service bound its engine at kernel:ready', async () => {
        declare('2');
        const h = makeHarness({ settings: 'real' });
        await new MetadataClusterBridgePlugin().init(h.ctx);
        await h.fire('kernel:ready');
        expect(h.attachSettings).not.toHaveBeenCalled();
        await h.fire('kernel:bootstrapped');
        expect(h.attachSettings).toHaveBeenCalledTimes(1);
    });

    it('CONTROL — the redis driver with no declaration attaches nothing and says nothing above debug', async () => {
        declare('');
        const h = makeHarness({ settings: 'real' });
        await new MetadataClusterBridgePlugin().init(h.ctx);
        await h.fire('kernel:ready');
        await h.fire('kernel:bootstrapped');
        expect(h.attachSettings).not.toHaveBeenCalled();
        expect(infoLines(h).some((l) => l.includes('settings.changed'))).toBe(false);
        expect(warnLines(h).some((l) => l.includes('settings'))).toBe(false);
        expect(debugLines(h).some((l) => l.includes('settings fan-out skipped'))).toBe(true);
        // The other lanes keep their own guard: lane 2 still attaches on redis.
        expect(h.attachMutation).toHaveBeenCalledTimes(1);
    });

    it('one declared replica is a single node: no lane', async () => {
        declare('1');
        const h = makeHarness({ settings: 'real' });
        await new MetadataClusterBridgePlugin().init(h.ctx);
        await h.fire('kernel:ready');
        await h.fire('kernel:bootstrapped');
        expect(h.attachSettings).not.toHaveBeenCalled();
    });

    it('declared replicas over a driver other than redis: no lane', async () => {
        declare('3');
        const h = makeHarness({ settings: 'real', driver: 'postgres' });
        await new MetadataClusterBridgePlugin().init(h.ctx);
        await h.fire('kernel:ready');
        await h.fire('kernel:bootstrapped');
        expect(h.attachSettings).not.toHaveBeenCalled();
    });

    it('declared replicas over the in-process memory driver: no lane', async () => {
        declare('3');
        const h = makeHarness({ settings: 'real', driver: 'memory' });
        await new MetadataClusterBridgePlugin().init(h.ctx);
        await h.fire('kernel:ready');
        await h.fire('kernel:bootstrapped');
        expect(h.attachSettings).not.toHaveBeenCalled();
    });

    it('skips quietly when no settings service is registered, or it does not expose the seam', async () => {
        declare('2');
        for (const settings of ['none', 'bare'] as const) {
            const h = makeHarness({ settings });
            await new MetadataClusterBridgePlugin().init(h.ctx);
            await h.fire('kernel:ready');
        await h.fire('kernel:bootstrapped');
            expect(h.attachSettings).not.toHaveBeenCalled();
            expect(warnLines(h).some((l) => l.includes('settings'))).toBe(false);
            expect(debugLines(h).some((l) => l.includes('settings fan-out'))).toBe(true);
        }
    });

    it('a throwing attach is reported and does not take the other lanes down', async () => {
        declare('2');
        const h = makeHarness({ settings: 'real', settingsAttachThrows: true, automation: 'real' });
        await new MetadataClusterBridgePlugin().init(h.ctx);
        await h.fire('kernel:ready');
        await h.fire('kernel:bootstrapped');
        expect(h.logger.error).toHaveBeenCalledWith(
            'MetadataClusterBridgePlugin: settings-lane attach failed',
            expect.any(Error),
        );
        expect(h.attachMutation).toHaveBeenCalledTimes(1);
        expect(h.attachCredential).toHaveBeenCalledTimes(1);
    });

    it('kernel:shutdown detaches lane 5, and a throwing lane-4 detach does not strand it', async () => {
        declare('2');
        const h = makeHarness({ settings: 'real', automation: 'real' });
        h.detachCredential.mockImplementation(() => {
            throw new Error('credential detach exploded');
        });
        await new MetadataClusterBridgePlugin().init(h.ctx);
        await h.fire('kernel:ready');
        await h.fire('kernel:bootstrapped');
        await h.fire('kernel:shutdown');
        expect(h.detachSettings).toHaveBeenCalledTimes(1);
    });

    describe('cluster.resync', () => {
        function resyncHarness() {
            const h = makeHarness({ settings: 'real' });
            const resyncSettings = vi.fn(async () => {});
            Object.assign(h.ctx.getService<Record<string, unknown>>('settings'), {
                resyncSettingsChangePubSub: resyncSettings,
            });
            const liveness = new ClusterDriverLiveness({ driver: 'redis', nodeId: 'node-a', logger: { warn: vi.fn(), info: vi.fn() } });
            offerClusterDriverLiveness(h.ctx.getService<object>('cluster'), liveness);
            const outage = async () => {
                liveness.reportUp('command');
                liveness.reportDown('command', new Error('ECONNREFUSED'));
                liveness.reportUp('command');
                await new Promise((r) => setTimeout(r, 0));
            };
            return { ...h, outage, resyncSettings };
        }

        it('the settings lane re-reads once per recovered outage', async () => {
            declare('2');
            const h = resyncHarness();
            await new MetadataClusterBridgePlugin().init(h.ctx);
            await h.fire('kernel:ready');
        await h.fire('kernel:bootstrapped');
            await h.outage();
            expect(h.resyncSettings).toHaveBeenCalledTimes(1);
            expect(infoLines(h).some((l) => l.includes('resynced settings.changed'))).toBe(true);
        });

        it('CONTROL — undeclared, the lane never attached, so a reconnect calls nothing', async () => {
            declare('');
            const h = resyncHarness();
            await new MetadataClusterBridgePlugin().init(h.ctx);
            await h.fire('kernel:ready');
        await h.fire('kernel:bootstrapped');
            await h.outage();
            expect(h.resyncSettings).not.toHaveBeenCalled();
        });
    });
});
