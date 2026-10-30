// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27428] Cross-replica convergence of a connector credential written
 * through the door — lane 4 of the cluster-invalidation family
 * (`content/docs/kernel/cluster.mdx` §6.2), measured over the topology the
 * card describes: two `AutomationServicePlugin` boots ("replicas") over ONE
 * shared database, each with its OWN materialized connectors, joined by a bus
 * that delivers every publish to every subscriber (publisher included — what
 * a real remote driver does, and what the `originNode` loopback guard exists
 * for). Each replica is attached through `attachConnectorCredentialPubSub()`,
 * the seam `MetadataClusterBridgePlugin` calls at `kernel:ready`; that
 * bridge's own lane-4 cases live in `@objectstack/service-cluster`.
 *
 * The defect: the door reconciled the replica that took the request. An
 * instance whose STORED value its upstream refused is held — no retry timer,
 * and its signature is recomputed only on `metadata:reloaded` or at restart —
 * so a corrected credential reached every other replica only after a publish
 * or a restart.
 *
 * Directions declared before running:
 *  • lane attached on both replicas: a PUT on A re-materializes B's held
 *    instance with the new value, and a DELETE on A degrades B's live one,
 *    with no reload on B                                           -> GREEN
 *  • control, B not attached: the same PUT leaves B held — the pre-fix
 *    production shape, so the convergence above is the lane's doing and not
 *    a harness artifact sharing state between the replicas         -> GREEN
 *
 * The values below are obvious dummies.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysSecret } from '@objectstack/platform-objects';
import type { CryptoContext, CryptoHandle, ICryptoProvider, IPubSub, PubSubHandler } from '@objectstack/spec/contracts';
import {
    ConnectorCredentialRejectedError,
    type Connector,
    type ConnectorProviderContext,
    type ConnectorProviderFactory,
} from '@objectstack/spec/integration';

import { AutomationServicePlugin } from './plugin.js';
import type { AutomationEngine } from './engine.js';
import { SysConnectorCredential } from './sys-connector-credential.object.js';
import { SysFlowCredential } from './sys-flow-credential.object.js';
import { CONNECTOR_CREDENTIAL_MUTATION_CLUSTER_CHANNEL } from './connector-credentials.js';

const REF = 'DUMMY_BILLING_TOKEN_27428';
const DUMMY_VALUE = 'dummy-value-aaaa-0001';
const DUMMY_VALUE_2 = 'dummy-value-bbbb-0002';
const ADMIN = { userId: 'usr_admin_27428' } as never;

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

/** Reversible stand-in cipher — the seam's behaviour is the engine's, not the cipher's. */
function fakeCrypto(): ICryptoProvider {
    let n = 0;
    return {
        async encrypt(plain: string, _ctx: CryptoContext): Promise<CryptoHandle> {
            n += 1;
            return { id: `sec_${n}`, kmsKeyId: 'test', alg: 'test-rev', version: 1, ciphertext: [...plain].reverse().join('') };
        },
        async decrypt(handle: CryptoHandle): Promise<string> {
            return [...handle.ciphertext].reverse().join('');
        },
        async rotateKey(handle: CryptoHandle): Promise<CryptoHandle> {
            return { ...handle, version: handle.version + 1 };
        },
        digest: (plain: string) => `d:${plain.length}`,
        keyedDigest: async (plain: string) => `k:${plain.length}`,
    };
}

/** A provider-bound instance naming {@link REF}. */
function billing() {
    return {
        name: 'billing',
        label: 'billing',
        type: 'api',
        provider: 'fake',
        providerConfig: {},
        auth: { type: 'bearer', credentialRef: REF },
        _packageId: 'com.example.billing',
    };
}

/** One replica's upstream: it refuses at materialization (the mcp shape) while `reject` is set. */
function fakeProvider() {
    const state = { materialized: [] as ConnectorProviderContext[], reject: false };
    const tokenOf = (ctx: ConnectorProviderContext) => (ctx.auth?.type === 'bearer' ? ctx.auth.token : undefined);
    const factory: ConnectorProviderFactory = (ctx) => {
        state.materialized.push(ctx);
        if (state.reject) {
            throw new ConnectorCredentialRejectedError(`fake provider: connector '${ctx.name}' was refused by its server (HTTP 401)`, 401);
        }
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
    return { factory, state, last: () => tokenOf(state.materialized[state.materialized.length - 1]) };
}

/**
 * The shared bus: every publish reaches every subscriber on the channel,
 * publisher included, one hop later — the at-most-once remote driver shape.
 */
function sharedBus() {
    const handlers = new Map<string, Set<PubSubHandler<any>>>();
    const published: Array<{ channel: string; payload: unknown; partitionKey?: string }> = [];
    const bus: IPubSub = {
        async publish(channel, payload, opts) {
            published.push({ channel, payload, partitionKey: opts?.partitionKey });
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
    return { bus, published };
}

const engines: ObjectQL[] = [];
const kernels: LiteKernel[] = [];
afterEach(async () => {
    for (const k of kernels.splice(0)) await k.shutdown().catch(() => {});
    for (const e of engines.splice(0)) {
        try { await (e as any).destroy?.(); } catch { /* noop */ }
    }
    vi.restoreAllMocks();
});

/** Everything the process prints while a test runs (the kernel logger writes JSON to stdout / stderr). */
function captureOutput(): { text: () => string } {
    const chunks: string[] = [];
    const keep = ((c: string | Uint8Array) => { chunks.push(String(c)); return true; }) as never;
    vi.spyOn(process.stdout, 'write').mockImplementation(keep);
    vi.spyOn(process.stderr, 'write').mockImplementation(keep);
    for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) {
        vi.spyOn(console, m).mockImplementation((...args: unknown[]) => { chunks.push(args.map(String).join(' ')); });
    }
    return { text: () => chunks.join('\n') };
}

/** The ONE database both replicas read and write. */
async function sharedDatabase(): Promise<ObjectQL> {
    const ql = new ObjectQL();
    engines.push(ql);
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    await driver.connect();
    ql.registerDriver(driver, true);
    await ql.init();
    (ql as any).registry.registerObject(SysSecret as never, 'test');
    (ql as any).registry.registerObject(SysConnectorCredential as never, 'test');
    (ql as any).registry.registerObject(SysFlowCredential as never, 'test');
    await ql.syncSchemas();
    ql.setCryptoProvider(fakeCrypto());
    return ql;
}

/** One replica: its own kernel, plugin and provider over the shared database; attached to `bus` unless told not to. */
async function replica(ql: ObjectQL, nodeId: string, bus: IPubSub | undefined) {
    const provider = fakeProvider();
    const kernel = new LiteKernel({ logger: { level: 'debug', format: 'json' } } as never);
    kernels.push(kernel);
    kernel.use(new AutomationServicePlugin({ suspendedRunStore: 'memory', credentialResolver: () => undefined }));
    kernel.use({
        name: `test.harness.${nodeId}`,
        type: 'standard' as const,
        version: '1.0.0',
        dependencies: ['com.objectstack.service-automation'],
        async init(ctx: any) {
            ctx.registerService('objectql', { registry: { listItems: (t: string) => (t === 'connector' ? [billing()] : []) } });
            ctx.registerService('data', ql);
            ctx.getService('automation').registerConnectorProvider('fake', provider.factory);
        },
        async start() {},
    } as never);
    await kernel.bootstrap();
    await flush();
    const engine = kernel.getService('automation') as AutomationEngine;
    // What `MetadataClusterBridgePlugin`'s lane 4 does at `kernel:ready` on a cross-process driver.
    if (bus) engine.attachConnectorCredentialPubSub(bus, nodeId);
    const held = () => engine.getConnectorDegradedReason('billing');
    return { engine, provider, held };
}

describe('[#27428] a credential written on one replica converges every replica', () => {
    it('⭐ a PUT on A re-materializes the instance B holds, with the new value and no reload on B', async () => {
        const ql = await sharedDatabase();
        const { bus } = sharedBus();
        const a = await replica(ql, 'node-a', bus);
        const b = await replica(ql, 'node-b', bus);
        a.provider.state.reject = true;
        b.provider.state.reject = true;

        // The first value is refused by the upstream on both replicas: each
        // holds its instance (a stored value — no retry timer).
        await a.engine.setConnectorCredential({ ref: REF, value: DUMMY_VALUE, context: ADMIN });
        await vi.waitFor(() => expect(b.provider.state.materialized).toHaveLength(1));
        await vi.waitFor(() => expect(b.held()).toContain('refused'));
        expect(b.provider.last()).toBe(DUMMY_VALUE);
        expect(a.held()).toContain('refused');

        // The administrator corrects it on A. B, which holds its instance,
        // re-materializes with the new value — no `metadata:reloaded`, no restart.
        a.provider.state.reject = false;
        b.provider.state.reject = false;
        await a.engine.setConnectorCredential({ ref: REF, value: DUMMY_VALUE_2, context: ADMIN });
        expect(a.held()).toBeUndefined();
        await vi.waitFor(() => expect(b.held()).toBeUndefined());
        expect(b.provider.last()).toBe(DUMMY_VALUE_2);
        expect(b.engine.getRegisteredConnectors()).toContain('billing');
    });

    it('a DELETE on A degrades the live instance on B, naming the reference', async () => {
        const ql = await sharedDatabase();
        const { bus } = sharedBus();
        const a = await replica(ql, 'node-a', bus);
        const b = await replica(ql, 'node-b', bus);

        await a.engine.setConnectorCredential({ ref: REF, value: DUMMY_VALUE, context: ADMIN });
        await vi.waitFor(() => expect(b.held()).toBeUndefined());
        expect(b.provider.last()).toBe(DUMMY_VALUE);

        await a.engine.clearConnectorCredential({ ref: REF, context: ADMIN });
        await vi.waitFor(() => expect(b.held()).toContain(`credential '${REF}'`));
        expect(a.held()).toContain(`credential '${REF}'`);
    });

    it('control: a replica with no transport attached keeps holding its instance — the pre-fix shape', async () => {
        const ql = await sharedDatabase();
        const { bus } = sharedBus();
        const a = await replica(ql, 'node-a', bus);
        const b = await replica(ql, 'node-b', undefined);
        a.provider.state.reject = true;
        b.provider.state.reject = true;
        await b.engine.setConnectorCredential({ ref: REF, value: DUMMY_VALUE, context: ADMIN });
        expect(b.held()).toContain('refused');

        a.provider.state.reject = false;
        b.provider.state.reject = false;
        await a.engine.setConnectorCredential({ ref: REF, value: DUMMY_VALUE_2, context: ADMIN });
        expect(a.held()).toBeUndefined();
        for (let i = 0; i < 5; i++) await flush();
        expect(b.held()).toContain('refused');
        expect(b.provider.state.materialized).toHaveLength(1);
    });
});

describe('[#27428] the lane carries an address, and the publisher drops its own', () => {
    it('publishes `{ originNode, ref }` after a set and after a clear, never a value; a refused write publishes nothing', async () => {
        const ql = await sharedDatabase();
        const { bus, published } = sharedBus();
        const a = await replica(ql, 'node-a', bus);

        await expect(a.engine.setConnectorCredential({ ref: REF, value: '', context: ADMIN }))
            .rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
        await expect(a.engine.clearConnectorCredential({ ref: REF, context: ADMIN }))
            .rejects.toMatchObject({ status: 404, code: 'RESOURCE_NOT_FOUND' });
        expect(published).toHaveLength(0);

        await a.engine.setConnectorCredential({ ref: REF, value: DUMMY_VALUE, context: ADMIN });
        await a.engine.clearConnectorCredential({ ref: REF, context: ADMIN });
        expect(published).toEqual([
            { channel: CONNECTOR_CREDENTIAL_MUTATION_CLUSTER_CHANNEL, payload: { originNode: 'node-a', ref: REF }, partitionKey: `connector-credential:${REF}` },
            { channel: CONNECTOR_CREDENTIAL_MUTATION_CLUSTER_CHANNEL, payload: { originNode: 'node-a', ref: REF }, partitionKey: `connector-credential:${REF}` },
        ]);
        expect(JSON.stringify(published).includes(DUMMY_VALUE)).toBe(false);
    });

    it("A's own publish is dropped on A and followed on B; the lane runs in both directions", async () => {
        const out = captureOutput();
        const ql = await sharedDatabase();
        const { bus } = sharedBus();
        const a = await replica(ql, 'node-a', bus);
        const b = await replica(ql, 'node-b', bus);

        await a.engine.setConnectorCredential({ ref: REF, value: DUMMY_VALUE, context: ADMIN });
        await vi.waitFor(() => expect(out.text()).toContain(`reconciling the connectors on node 'node-b'`));
        for (let i = 0; i < 5; i++) await flush();
        expect(out.text()).not.toContain(`reconciling the connectors on node 'node-a'`);

        // B writes; A follows.
        await b.engine.setConnectorCredential({ ref: REF, value: DUMMY_VALUE_2, context: ADMIN });
        await vi.waitFor(() => expect(a.provider.last()).toBe(DUMMY_VALUE_2));
        expect(out.text()).toContain(`connector credential '${REF}' was written on node 'node-b'; reconciling the connectors on node 'node-a'`);
    });
});
