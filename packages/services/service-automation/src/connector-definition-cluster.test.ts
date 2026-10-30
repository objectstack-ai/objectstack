// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27977] Cross-replica reach of a connector DEFINITION published through the
 * per-item publish door — measured, and since #28002 pinned converging, over
 * the topology of
 * `connector-credential-cluster.test.ts`: two kernels ("replicas") over ONE
 * shared database, each with its own materialized connectors, joined by a bus
 * that delivers every publish to every subscriber (publisher included).
 *
 * Each replica runs the real write path — ObjectKernel, ObjectQLPlugin's
 * metadata protocol, driver-sql on one better-sqlite3 file both replicas open
 * — and is attached the way `MetadataClusterBridgePlugin` attaches it at
 * `kernel:ready`: lane 2 (`attachMetadataMutationPubSub`, `metadata.mutated`)
 * and lane 4 (`attachConnectorCredentialPubSub`). Lane 1 (`metadata.changed`)
 * replays into a `MetadataManager`'s caches; the connector reconcile reads the
 * ObjectQL registry and the protocol's execution view, never that manager, so
 * attaching it could not change what is read here.
 *
 * Directions declared before running:
 *  • A publishes a changed definition: A re-materializes it (its own
 *    `metadata:reloaded`, announced by ObjectQLPlugin)               -> GREEN
 *  • lane 2 carries the mutation to B: B's protocol replays it into B's
 *    mutation listeners                                              -> GREEN
 *  • B's live instance follows the new definition with no reload on B
 *                                                                    -> GREEN
 *    (measured RED by #27977: the automation plugin's mutation listener took
 *    `flow` only, and `metadata:reloaded` is a kernel-local hook. #28002
 *    widens that listener: a `connector` mutation, lane 2's replay included,
 *    queues the reconcile `metadata:reloaded` runs)
 *  • control: a `metadata:reloaded` on B converges B from its OWN read of the
 *    shared store, so the gap is the trigger and not the store or the read
 *                                                                    -> GREEN
 *
 * [#28002] Added beside them:
 *  • A publishes, so A reconciles from its own `metadata:reloaded` AND its own
 *    mutation listener: the provider still runs once per changed definition
 *                                                                    -> GREEN
 *  • a direct active save (`PUT /api/v1/meta/connector/:name`, no publish
 *    door) re-materializes the writing replica and converges the peer
 *                                                                    -> GREEN
 *  • a deleted connector is torn down on both replicas               -> GREEN
 *  • controls: a draft save and a flow save run no connector reconcile; the
 *    flow save still arms the flow                                   -> GREEN
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin, type ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { IPubSub, PubSubHandler } from '@objectstack/spec/contracts';
import type { Connector, ConnectorProviderContext, ConnectorProviderFactory } from '@objectstack/spec/integration';

import { AutomationServicePlugin } from './plugin.js';
import type { AutomationEngine } from './engine.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

const NAME = 'billing_27977';
const V1 = 'https://v1.billing.example.test';
const V2 = 'https://v2.billing.example.test';

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

/** A provider-bound connector instance; `endpoint` is the definition change under test. */
const definition = (endpoint: string) => ({
    name: NAME,
    label: 'Billing',
    type: 'api',
    provider: 'fake',
    providerConfig: { endpoint },
});

/** A minimal start → end flow, saved active: the control's other metadata type. */
const plainFlow = (name: string) => ({
    name,
    label: name,
    type: 'autolaunched',
    status: 'active',
    nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'end' }],
});

/** The protocol surface this suite drives: the doors `PUT /meta/:type/:name`, `POST …/publish` and `DELETE` call. */
interface Protocol {
    saveMetaItem(request: { type: string; name: string; item: unknown; mode?: 'draft' | 'publish' }): Promise<unknown>;
    publishMetaItem(request: { type: string; name: string }): Promise<unknown>;
    deleteMetaItem(request: { type: string; name: string }): Promise<unknown>;
    onMetadataMutation(listener: (evt: { type: string; name: string; state?: string }) => void): () => void;
    attachMetadataMutationPubSub(pubsub: IPubSub, nodeId: string): () => void;
}

/** One replica's upstream: records each materialization's endpoint. */
function fakeProvider() {
    const endpoints: unknown[] = [];
    const factory: ConnectorProviderFactory = (ctx: ConnectorProviderContext) => {
        endpoints.push((ctx.providerConfig as Record<string, unknown> | undefined)?.endpoint);
        return {
            def: {
                name: ctx.name,
                label: ctx.label,
                type: 'api',
                authentication: { type: 'none' },
                actions: [{ key: 'request', label: 'Request' }],
            } as unknown as Connector,
            handlers: { request: async () => ({ status: 200, ok: true, body: {} }) },
        };
    };
    return { factory, endpoints, last: () => endpoints[endpoints.length - 1] };
}

/** The shared bus: every publish reaches every subscriber on the channel, publisher included, one hop later. */
function sharedBus(): IPubSub {
    const handlers = new Map<string, Set<PubSubHandler<any>>>();
    return {
        async publish(channel, payload) {
            for (const h of [...(handlers.get(channel) ?? [])]) {
                setTimeout(() => void h({ channel, payload, publishedAt: Date.now() }), 0);
            }
        },
        subscribe(channel, handler) {
            const set = handlers.get(channel) ?? new Set();
            set.add(handler as PubSubHandler<any>);
            handlers.set(channel, set);
            return () => set.delete(handler as PubSubHandler<any>);
        },
        async close() {},
    };
}

/** Every connector reconcile, attributed to its plugin instance through `mock.contexts`. */
const reconcileSpy = vi.spyOn(
    AutomationServicePlugin.prototype as unknown as { reconcileDeclaredConnectors(...args: unknown[]): Promise<void> },
    'reconcileDeclaredConnectors',
);

const kernels: ObjectKernel[] = [];
const dirs: string[] = [];
afterEach(async () => {
    for (const k of kernels.splice(0)) {
        if (k.getState() === 'running') await k.shutdown().catch(() => {});
    }
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
    reconcileSpy.mockClear();
});

/** The ONE database file both replicas open. */
function sharedDatabaseFile(): string {
    const dir = mkdtempSync(join(tmpdir(), 'os-27977-'));
    dirs.push(dir);
    return join(dir, 'shared.sqlite');
}

/**
 * One replica over the shared file, attached to `bus` the way the cluster
 * bridge attaches it. `lane2: false` leaves lane 2 off, the reach #27977
 * measured a peer as having for this signal.
 */
async function replica(file: string, nodeId: string, bus: IPubSub, opts: { lane2?: boolean } = {}) {
    const provider = fakeProvider();
    let hooks: { trigger(event: string, payload?: unknown): Promise<void> } | undefined;
    const kernel = new ObjectKernel({ logger: { level: 'fatal' }, gracefulShutdown: false } as never);
    kernels.push(kernel);
    await kernel.use(new ObjectQLPlugin());
    const plugin = new AutomationServicePlugin({ suspendedRunStore: 'memory', credentialResolver: () => undefined });
    await kernel.use(plugin);
    await kernel.use({
        name: `test.harness.${nodeId}`,
        type: 'standard' as const,
        version: '1.0.0',
        dependencies: ['com.objectstack.service-automation'],
        async init(ctx: any) {
            hooks = ctx;
            ctx.getService('automation').registerConnectorProvider('fake', provider.factory);
        },
        async start() {},
    } as never);
    await kernel.bootstrap();

    const ql = kernel.getService<ObjectQL>('objectql');
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: file }, useNullAsDefault: true });
    await driver.connect();
    ql.registerDriver(driver as never, true);
    await ql.syncSchemas();
    await installDefaultOrganization(ql);

    const protocol = kernel.getService<Protocol>('protocol');
    const automation = kernel.getService<AutomationEngine>('automation');
    // What `MetadataClusterBridgePlugin`'s lanes 2 and 4 do at `kernel:ready` on a cross-process driver.
    if (opts.lane2 !== false) protocol.attachMetadataMutationPubSub(bus, nodeId);
    automation.attachConnectorCredentialPubSub(bus, nodeId);

    const heard: string[] = [];
    protocol.onMetadataMutation((evt) => heard.push(`${evt.type}/${evt.name}`));

    /** The per-item publish door: a draft save, then `POST /api/v1/meta/connector/:name/publish`. */
    const publish = async (item: unknown) => {
        await protocol.saveMetaItem({ type: 'connector', name: NAME, item, mode: 'draft' });
        await protocol.publishMetaItem({ type: 'connector', name: NAME });
    };
    /** The direct door: `PUT /api/v1/meta/connector/:name`, saved active. */
    const save = (item: unknown) => protocol.saveMetaItem({ type: 'connector', name: NAME, item });
    const saveDraft = (item: unknown) => protocol.saveMetaItem({ type: 'connector', name: NAME, item, mode: 'draft' });
    const remove = () => protocol.deleteMetaItem({ type: 'connector', name: NAME });
    const saveFlow = (name: string) => protocol.saveMetaItem({ type: 'flow', name, item: plainFlow(name) });
    const reload = () => hooks!.trigger('metadata:reloaded', { changed: [`connector/${NAME}`] });
    const live = () => automation.getRegisteredConnectors().includes(NAME);
    /** Connector reconciles this replica ran — the run `metadata:reloaded` queues. */
    const reconciles = () => reconcileSpy.mock.contexts.filter((c) => c === plugin).length;
    return { provider, publish, save, saveDraft, remove, saveFlow, reload, live, heard, reconciles, automation };
}

describe('[#27977] a connector definition published on one replica', () => {
    it('re-materializes on the publishing replica, and lane 2 carries the mutation to the peer', async () => {
        const file = sharedDatabaseFile();
        const bus = sharedBus();
        const a = await replica(file, 'node-a', bus);
        const b = await replica(file, 'node-b', bus);

        await a.publish(definition(V1));
        expect(a.live()).toBe(true);
        expect(a.provider.last()).toBe(V1);

        await a.publish(definition(V2));
        expect(a.provider.last()).toBe(V2);
        await vi.waitFor(() => expect(b.heard).toContain(`connector/${NAME}`));
    });

    // Measured RED by #27977 (pinned `it.fails`); converges since #28002.
    it('[#28002] converges the peer with no reload on the peer', async () => {
        const file = sharedDatabaseFile();
        const bus = sharedBus();
        const a = await replica(file, 'node-a', bus);
        const b = await replica(file, 'node-b', bus);

        await a.publish(definition(V1));
        await a.publish(definition(V2));
        await vi.waitFor(() => expect(b.heard).toContain(`connector/${NAME}`));
        await vi.waitFor(() => expect(b.provider.last()).toBe(V2), { timeout: 500 });
    });

    it('[#28002] the publishing replica materializes each changed definition once, though both its signals reconcile', async () => {
        const file = sharedDatabaseFile();
        const bus = sharedBus();
        const a = await replica(file, 'node-a', bus);
        const b = await replica(file, 'node-b', bus);
        const before = a.reconciles();

        await a.publish(definition(V1));
        await a.publish(definition(V2));
        await vi.waitFor(() => expect(b.provider.last()).toBe(V2), { timeout: 2000 });
        for (let i = 0; i < 5; i++) await flush();

        // Two reconciles per publish on A — its own `metadata:reloaded` and its
        // own mutation listener (lane 2's loopback guard drops the bus echo) —
        // and the second finds the signature unchanged.
        expect(a.reconciles() - before).toBe(4);
        expect(a.provider.endpoints).toEqual([V1, V2]);
        expect(a.live()).toBe(true);
    });

    it('[#28002] a direct active save re-materializes the writing replica and converges the peer', async () => {
        const file = sharedDatabaseFile();
        const bus = sharedBus();
        const a = await replica(file, 'node-a', bus);
        const b = await replica(file, 'node-b', bus);

        await a.save(definition(V1));
        await vi.waitFor(() => expect(a.provider.last()).toBe(V1), { timeout: 2000 });
        await vi.waitFor(() => expect(b.provider.last()).toBe(V1), { timeout: 2000 });

        await a.save(definition(V2));
        await vi.waitFor(() => expect(a.provider.last()).toBe(V2), { timeout: 2000 });
        await vi.waitFor(() => expect(b.provider.last()).toBe(V2), { timeout: 2000 });
        expect(a.live()).toBe(true);
        expect(b.live()).toBe(true);
    });

    it('[#28002] a deleted connector is torn down on both replicas', async () => {
        const file = sharedDatabaseFile();
        const bus = sharedBus();
        const a = await replica(file, 'node-a', bus);
        const b = await replica(file, 'node-b', bus);

        await a.publish(definition(V1));
        await vi.waitFor(() => expect(b.live()).toBe(true), { timeout: 2000 });

        await a.remove();
        await vi.waitFor(() => expect(a.live()).toBe(false), { timeout: 2000 });
        await vi.waitFor(() => expect(b.live()).toBe(false), { timeout: 2000 });
    });

    it('[#28002] control: a draft connector save and a flow save run no connector reconcile; the flow still arms', async () => {
        const file = sharedDatabaseFile();
        const bus = sharedBus();
        const a = await replica(file, 'node-a', bus);
        const b = await replica(file, 'node-b', bus);
        await a.publish(definition(V1));
        await vi.waitFor(() => expect(b.provider.last()).toBe(V1), { timeout: 2000 });
        for (let i = 0; i < 5; i++) await flush();
        const [beforeA, beforeB] = [a.reconciles(), b.reconciles()];

        await a.saveDraft(definition(V2));
        await a.saveFlow('flow_28002');
        await vi.waitFor(async () => expect(await a.automation.getFlow('flow_28002')).not.toBeNull(), { timeout: 2000 });
        await vi.waitFor(async () => expect(await b.automation.getFlow('flow_28002')).not.toBeNull(), { timeout: 2000 });
        for (let i = 0; i < 5; i++) await flush();

        expect([a.reconciles() - beforeA, b.reconciles() - beforeB]).toEqual([0, 0]);
        expect([a.provider.endpoints, b.provider.endpoints]).toEqual([[V1], [V1]]);
    });

    it('control: a reload on the peer converges it from its own read of the shared store', async () => {
        const file = sharedDatabaseFile();
        const bus = sharedBus();
        const a = await replica(file, 'node-a', bus);
        // Lane 2 off on the peer: the reload is then its only trigger.
        const b = await replica(file, 'node-b', bus, { lane2: false });

        await a.publish(definition(V1));
        await a.publish(definition(V2));
        for (let i = 0; i < 5; i++) await flush();
        // The state before the reload: the peer never materialized the instance.
        expect(b.heard).toEqual([]);
        expect(b.live()).toBe(false);
        expect(b.provider.endpoints).toEqual([]);

        await b.reload();
        expect(b.live()).toBe(true);
        expect(b.provider.last()).toBe(V2);
    });
});
