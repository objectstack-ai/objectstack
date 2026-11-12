// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#31722] Two kernels, one database, one cluster bus: an object authored on A
 * while A's `metadata.mutated` hint is lost is served by B once B's cluster
 * driver reconnects and emits `cluster.resync`.
 *
 * Each kernel is a replica: its own ObjectQL engine and registry, its own
 * metadata protocol, over its own connection to ONE SQLite file (the shared
 * `sys_metadata` and the object tables), with a cluster service whose driver
 * crosses a process boundary as far as the bridge can tell (`test-bus`, not the
 * in-process `memory` driver) and offers a driver liveness, the way the redis
 * driver does. `MetadataClusterBridgePlugin` is the real one: it attaches lane 2
 * at `kernel:ready` and calls each lane's resync seam on `cluster.resync`.
 *
 * The bus drops every publish while `down`: the hint a real store outage loses.
 *
 * Directions declared before running: without lane 2's resync seam the ⭐ case
 * stays red (B answers the object as unknown after the reconnect); the CONTROL
 * case on the in-process `memory` driver never runs the seam at all.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import {
    ClusterDriverLiveness,
    MetadataClusterBridgePlugin,
    offerClusterDriverLiveness,
} from '@objectstack/service-cluster';
import {
    SysMetadataAuditObject,
    SysMetadataHistoryObject,
    SysMetadataObject,
} from '@objectstack/metadata-core';
import type { IPubSub, PubSubHandler } from '@objectstack/spec/contracts';

const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => {
    for (const c of cleanup.splice(0).reverse()) await c();
    vi.restoreAllMocks();
});

/** A bus every replica shares; every publish is lost while `state.down`. */
function lossyBus() {
    const subs = new Map<string, Set<PubSubHandler<unknown>>>();
    const state = { down: false };
    const bus: IPubSub = {
        async publish(channel, payload) {
            if (state.down) return;
            for (const h of [...(subs.get(channel) ?? [])]) {
                await h({ channel, payload, publishedAt: Date.now() } as never);
            }
        },
        subscribe(channel, handler) {
            const set = subs.get(channel) ?? new Set();
            subs.set(channel, set);
            set.add(handler as PubSubHandler<unknown>);
            return () => set.delete(handler as PubSubHandler<unknown>);
        },
        async close() {},
    };
    return { bus, state };
}

const METADATA_OBJECTS = [SysMetadataObject, SysMetadataHistoryObject, SysMetadataAuditObject] as never[];

/** One replica: a kernel with its own engine and protocol over `file`, a cluster on `bus`, and the real bridge. */
async function replica(file: string, nodeId: string, bus: IPubSub, driverName = 'test-bus') {
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: file }, useNullAsDefault: true });
    await driver.initObjects(METADATA_OBJECTS);
    const engine = new ObjectQL();
    engine.registerDriver(driver as never, true);
    await engine.init();
    for (const o of METADATA_OBJECTS) engine.registry.registerObject(o, '@objectstack/platform-objects');
    const protocol = new ObjectStackProtocolImplementation(engine as never, () => new Map(), 'env_prod');

    const liveness = new ClusterDriverLiveness({ driver: driverName, nodeId, logger: { warn() {}, info() {} } });
    const cluster = { nodeId, driver: driverName, pubsub: bus, lock: {}, kv: {}, counter: {}, async close() {} };
    if (driverName !== 'memory') offerClusterDriverLiveness(cluster, liveness);
    liveness.reportUp('command');

    const kernel = new LiteKernel({ logger: { level: 'error', format: 'json' } } as never);
    kernel.use({
        name: `test.replica.${nodeId}`,
        type: 'standard' as const,
        version: '1.0.0',
        async init(ctx: any) {
            ctx.registerService('cluster', cluster);
            ctx.registerService('protocol', protocol);
        },
        async start() {},
    } as never);
    kernel.use(new MetadataClusterBridgePlugin());
    await kernel.bootstrap();
    cleanup.push(async () => {
        await kernel.shutdown().catch(() => {});
        await engine.destroy().catch(() => {});
    });

    /** The connection drops and returns: the driver emits one `cluster.resync`. */
    const outageEnds = () => {
        liveness.reportDown('command', new Error('ECONNRESET'));
        liveness.reportUp('command');
    };
    return { engine, protocol, outageEnds };
}

/** Two replicas over one fresh SQLite file and one lossy bus. */
async function twoReplicas(driverName?: string) {
    const dir = mkdtempSync(join(tmpdir(), 'os-31722-'));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const file = join(dir, 'shared.sqlite');
    const { bus, state } = lossyBus();
    const a = await replica(file, 'node-a', bus, driverName);
    const b = await replica(file, 'node-b', bus, driverName);
    return { a, b, outage: state };
}

const gadget = {
    name: 'gadget',
    label: 'Gadget',
    sharingModel: 'private',
    fields: { title: { type: 'text', label: 'Title' } },
};

/** What B's data plane answers for `gadget`: its rows, or the refusal's code. */
async function readOnB(b: Awaited<ReturnType<typeof replica>>): Promise<unknown> {
    try {
        return await b.engine.find('gadget', { context: { isSystem: true } } as never);
    } catch (err) {
        return (err as { code?: string }).code ?? String(err);
    }
}

describe('[#31722] lane 2 on cluster.resync — two kernels, one database', () => {
    it('⭐ an object authored on A while its hint was lost is served by B after B’s cluster.resync', async () => {
        const { a, b, outage } = await twoReplicas();

        outage.down = true;
        const saved = await a.protocol.saveMetaItem({ type: 'object', name: 'gadget', item: gadget, mode: 'publish' });
        expect(saved.success).toBe(true);
        await a.engine.insert('gadget', { title: 'first', organization_id: 'org_1' }, { context: { isSystem: true } } as never);
        outage.down = false;

        // The loss: A serves the object, B does not know it.
        expect(a.engine.registry.getObject('gadget')).toBeDefined();
        expect(b.engine.registry.getObject('gadget')).toBeUndefined();

        b.outageEnds();
        await vi.waitFor(() => expect(b.engine.registry.getObject('gadget')).toBeDefined());
        const rows = await readOnB(b);
        expect(Array.isArray(rows) ? (rows as Array<{ title?: string }>).map((r) => r.title) : rows).toEqual(['first']);
    });

    it('CONTROL — a delivered hint still converges B per item, with no resync', async () => {
        const { a, b } = await twoReplicas();
        await a.protocol.saveMetaItem({ type: 'object', name: 'gadget', item: gadget, mode: 'publish' });
        await vi.waitFor(() => expect(b.engine.registry.getObject('gadget')).toBeDefined());
    });

    it('CONTROL — on the in-process memory driver no lane attaches and no resync runs', async () => {
        const { a, b } = await twoReplicas('memory');
        const seam = vi.spyOn(b.protocol, 'resyncMetadataMutationPubSub');
        await a.protocol.saveMetaItem({ type: 'object', name: 'gadget', item: gadget, mode: 'publish' });
        b.outageEnds();
        await new Promise((r) => setTimeout(r, 20));
        expect(seam).not.toHaveBeenCalled();
        expect(b.engine.registry.getObject('gadget')).toBeUndefined();
    });
});

/**
 * [#32145] A peer that learns of an object through a DELIVERED lane-2 hint
 * prepares it the way the authoring replica's save did: the driver's own
 * per-object registries (the autonumber counter, the organization column it
 * stamps and scopes on) are built by the object's schema sync, which the save
 * door runs on the writer and nothing ran on a peer — the table already
 * exists in the shared database, the peer's driver just never synced it.
 *
 * Directions declared before running: without the peer-side preparation the
 * two ⭐ cases are red (B issues no number; B stamps no organization); the
 * CONTROL — the same writes on the authoring replica — is green either way.
 */
const ticket = {
    name: 'ticket',
    label: 'Ticket',
    sharingModel: 'private',
    fields: {
        title: { type: 'text', label: 'Title' },
        ticket_number: { type: 'autonumber', label: 'Number', format: 'TK-{0000}' },
    },
};

/** A tenant member's write: the engine threads `tenantId` to the driver's native stamp. */
const memberCtx = { context: { userId: 'usr_1', tenantId: 'org_1', roles: [], permissions: [] } } as never;

describe('[#32145] a delivered lane-2 hint prepares the object on the peer — two kernels, one database', () => {
    it('⭐ B numbers the autonumber of an object authored on A', async () => {
        const { a, b } = await twoReplicas();
        const saved = await a.protocol.saveMetaItem({ type: 'object', name: 'ticket', item: ticket, mode: 'publish' });
        expect(saved.success).toBe(true);
        await vi.waitFor(() => expect(b.engine.registry.getObject('ticket')).toBeDefined());

        const row = await b.engine.insert('ticket', { title: 'on b', organization_id: 'org_1' }, { context: { isSystem: true } } as never);
        expect((row as { ticket_number?: unknown }).ticket_number).toBe('TK-0001');
    });

    it('⭐ B stamps the organization of a member write to an object authored on A', async () => {
        const { a, b } = await twoReplicas();
        await a.protocol.saveMetaItem({ type: 'object', name: 'ticket', item: ticket, mode: 'publish' });
        await vi.waitFor(() => expect(b.engine.registry.getObject('ticket')).toBeDefined());

        const row = await b.engine.insert('ticket', { title: 'on b' }, memberCtx);
        expect((row as { organization_id?: unknown }).organization_id).toBe('org_1');
    });

    it('CONTROL — the authoring replica numbers and stamps the same writes', async () => {
        const { a } = await twoReplicas();
        await a.protocol.saveMetaItem({ type: 'object', name: 'ticket', item: ticket, mode: 'publish' });

        const row = await a.engine.insert('ticket', { title: 'on a' }, memberCtx);
        expect(row).toMatchObject({ ticket_number: 'TK-0001', organization_id: 'org_1' });
    });
});
