// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0096 — provider-bound declarative connector instances. A `connectors:`
// entry that names a `provider` is materialized at boot by the automation
// service: it looks up the provider factory a connector plugin registered,
// resolves `auth.credentialRef`, and registers the resulting `{ def, handlers }`
// on the connector registry — so `connector_action` dispatches it and
// `GET /connectors` lists it, indistinguishable from a hand-written connector.
// Boot fails loudly for unknown provider / unresolvable credentialRef / name
// conflict / factory failure.

import { describe, it, expect } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import type {
    ConnectorProviderContext,
    ConnectorProviderFactory,
    ConnectorInstanceAuth,
} from '@objectstack/spec/integration';
import { AutomationServicePlugin, type CredentialResolver } from './plugin.js';
import type { AutomationEngine } from './engine.js';

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

/** A provider-bound declarative connector entry — the raw shape registerApp stores. */
function providerConnector(
    name: string,
    opts: {
        provider?: string;
        providerConfig?: Record<string, unknown>;
        auth?: ConnectorInstanceAuth;
        enabled?: boolean;
        label?: string;
    } = {},
) {
    return {
        name,
        label: opts.label ?? name,
        type: 'api',
        provider: opts.provider ?? 'fake',
        providerConfig: opts.providerConfig ?? {},
        ...(opts.auth ? { auth: opts.auth } : {}),
        ...(opts.enabled === undefined ? {} : { enabled: opts.enabled }),
    };
}

/**
 * A fake provider factory that records every ctx it is invoked with and returns
 * a one-action connector whose `ping` handler echoes the input and the resolved
 * auth type. Lets tests assert what the automation service handed the factory.
 */
function makeFakeProvider() {
    const calls: ConnectorProviderContext[] = [];
    const factory: ConnectorProviderFactory = (ctx) => {
        calls.push(ctx);
        return {
            def: {
                name: ctx.name,
                label: ctx.label,
                type: 'api',
                description: ctx.description,
                authentication: { type: 'none' },
                actions: [{ key: 'ping', label: 'Ping' }],
            },
            handlers: {
                ping: async (input: Record<string, unknown>) => ({
                    ok: true,
                    echo: input,
                    authType: ctx.auth?.type ?? null,
                    // Surface the resolved secret so a test can prove credentialRef resolution.
                    token: ctx.auth?.type === 'bearer' ? ctx.auth.token : undefined,
                }),
            },
        };
    };
    return { factory, calls };
}

interface BootOptions {
    providerKey?: string;
    providerFactory?: ConnectorProviderFactory;
    /** Names registered as plugin connectors during init() (for the conflict rule). */
    registerLivePlugin?: string[];
    credentialResolver?: CredentialResolver;
}

/**
 * Boot a LiteKernel with the automation plugin, a fake objectql registry serving
 * `declared` connector metadata, and (optionally) a provider factory + live
 * plugin connectors. Returns the booted kernel. Under LiteKernel a throw during
 * the automation plugin's start() (materialization) rejects `bootstrap()`, which
 * is exactly the "fail loudly" contract these tests assert.
 */
async function boot(declared: unknown[], opts: BootOptions = {}): Promise<LiteKernel> {
    const kernel = new LiteKernel({ logger: { level: 'silent' } } as never);
    kernel.use(new AutomationServicePlugin({ credentialResolver: opts.credentialResolver }));
    const harness = {
        name: 'test.harness',
        type: 'standard' as const,
        version: '1.0.0',
        dependencies: ['com.objectstack.service-automation'],
        async init(ctx: any) {
            ctx.registerService('objectql', {
                registry: {
                    listItems: (type: string) => (type === 'connector' ? declared : []),
                },
            });
            const automation = ctx.getService('automation');
            if (opts.providerFactory) {
                automation.registerConnectorProvider(opts.providerKey ?? 'fake', opts.providerFactory);
            }
            for (const name of opts.registerLivePlugin ?? []) {
                automation.registerConnector(
                    { name, label: name, type: 'api', authentication: { type: 'none' }, actions: [{ key: 'a', label: 'A' }] },
                    { a: async () => ({ ok: true }) },
                );
            }
        },
        async start() {},
    };
    kernel.use(harness as never);
    await kernel.bootstrap();
    await flush();
    return kernel;
}

function automationOf(kernel: LiteKernel): AutomationEngine {
    return kernel.getService('automation') as AutomationEngine;
}

/**
 * A fake provider whose materialized connectors carry a `close`, so reload tests
 * can assert teardown. Records the ctx of every invocation (`calls`) and the
 * names whose `close()` ran (`closed`).
 */
function makeClosableProvider() {
    const calls: ConnectorProviderContext[] = [];
    const closed: string[] = [];
    const factory: ConnectorProviderFactory = (ctx) => {
        calls.push(ctx);
        return {
            def: {
                name: ctx.name,
                label: ctx.label,
                type: 'api',
                authentication: { type: 'none' },
                actions: [{ key: 'ping', label: 'Ping' }],
            },
            handlers: { ping: async () => ({ ok: true }) },
            close: async () => { closed.push(ctx.name); },
        };
    };
    return { factory, calls, closed };
}

/**
 * Boot with a MUTABLE declared set and expose a `reload(next)` that swaps the
 * registry contents and fires `metadata:reloaded` — the runtime reconcile path
 * (ADR-0096 F1). The harness's ctx is the shared kernel context, so
 * `ctx.trigger('metadata:reloaded')` invokes the automation plugin's hook.
 */
async function bootReloadable(
    initial: unknown[],
    opts: { providerFactory: ConnectorProviderFactory; credentialResolver?: CredentialResolver },
) {
    const state = { declared: initial };
    let captured: any;
    const kernel = new LiteKernel({ logger: { level: 'silent' } } as never);
    kernel.use(new AutomationServicePlugin({ credentialResolver: opts.credentialResolver }));
    const harness = {
        name: 'test.harness',
        type: 'standard' as const,
        version: '1.0.0',
        dependencies: ['com.objectstack.service-automation'],
        async init(ctx: any) {
            captured = ctx;
            ctx.registerService('objectql', {
                registry: { listItems: (type: string) => (type === 'connector' ? state.declared : []) },
            });
            ctx.getService('automation').registerConnectorProvider('fake', opts.providerFactory);
        },
        async start() {},
    };
    kernel.use(harness as never);
    await kernel.bootstrap();
    await flush();
    const reload = async (next: unknown[]) => {
        state.declared = next;
        await captured.trigger('metadata:reloaded');
        await flush();
    };
    return { kernel, engine: automationOf(kernel), reload };
}

describe('ADR-0096 — declarative connector materialization', () => {
    it('materializes a provider-bound instance into a live, listed connector', async () => {
        const { factory, calls } = makeFakeProvider();
        const kernel = await boot([providerConnector('billing')], { providerFactory: factory });

        const engine = automationOf(kernel);
        // Registered under the declared name.
        expect(engine.getRegisteredConnectors()).toContain('billing');
        // Listed by GET /connectors with the provider-derived action.
        const desc = engine.getConnectorDescriptors().find((d) => d.name === 'billing');
        expect(desc).toBeDefined();
        expect(desc?.actions.map((a) => a.key)).toEqual(['ping']);
        // Origin is 'declarative', not 'plugin' — surfaced on the descriptor so a
        // designer can distinguish a materialized instance from a plugin connector.
        expect(desc?.origin).toBe('declarative');
        expect(engine.getConnectorOrigin('billing')).toBe('declarative');
        // The factory saw the declared identity.
        expect(calls[0]?.name).toBe('billing');

        await kernel.shutdown();
    });

    it('dispatches a materialized connector end-to-end through a flow connector_action', async () => {
        const { factory } = makeFakeProvider();
        const kernel = await boot([providerConnector('billing')], { providerFactory: factory });
        const engine = automationOf(kernel);

        engine.registerFlow('call_billing', {
            name: 'call_billing',
            label: 'Call Billing',
            type: 'autolaunched',
            variables: [{ name: 'call.ok', type: 'boolean', isOutput: true }],
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                {
                    id: 'call',
                    type: 'connector_action',
                    label: 'Ping Billing',
                    connectorConfig: { connectorId: 'billing', actionId: 'ping', input: { message: 'hi' } },
                },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'call' },
                { id: 'e2', source: 'call', target: 'end' },
            ],
        });

        const result = await engine.execute('call_billing');
        expect(result.success).toBe(true);
        expect(result.output).toMatchObject({ 'call.ok': true });

        await kernel.shutdown();
    });

    it('resolves auth.credentialRef through the credential resolver before handing it to the factory', async () => {
        const { factory, calls } = makeFakeProvider();
        const resolver: CredentialResolver = (ref) => (ref === 'BILLING_TOKEN' ? 'sk-live-123' : undefined);
        const kernel = await boot(
            [providerConnector('billing', { auth: { type: 'bearer', credentialRef: 'BILLING_TOKEN' } })],
            { providerFactory: factory, credentialResolver: resolver },
        );

        // The factory received the RESOLVED secret, never the raw reference.
        expect(calls[0]?.auth).toEqual({ type: 'bearer', token: 'sk-live-123' });
        await kernel.shutdown();
    });

    it('falls back to environment variables for credentialRef (open tier)', async () => {
        const { factory, calls } = makeFakeProvider();
        process.env.OS_TEST_ADR96_TOKEN = 'from-env';
        try {
            const kernel = await boot(
                [providerConnector('billing', { auth: { type: 'bearer', credentialRef: 'OS_TEST_ADR96_TOKEN' } })],
                { providerFactory: factory },
            );
            expect(calls[0]?.auth).toEqual({ type: 'bearer', token: 'from-env' });
            await kernel.shutdown();
        } finally {
            delete process.env.OS_TEST_ADR96_TOKEN;
        }
    });

    it('maps api-key and basic auth into the resolved static shape', async () => {
        const { factory, calls } = makeFakeProvider();
        const resolver: CredentialResolver = (ref) =>
            ({ API: 'key-xyz', PW: 'p@ss' } as Record<string, string>)[ref];
        const kernel = await boot(
            [
                providerConnector('svc_key', { auth: { type: 'api-key', credentialRef: 'API', headerName: 'X-Key' } }),
                providerConnector('svc_basic', { auth: { type: 'basic', username: 'alice', credentialRef: 'PW' } }),
            ],
            { providerFactory: factory, credentialResolver: resolver },
        );
        const byName = Object.fromEntries(calls.map((c) => [c.name, c.auth]));
        expect(byName.svc_key).toEqual({ type: 'api-key', key: 'key-xyz', headerName: 'X-Key', paramName: undefined });
        expect(byName.svc_basic).toEqual({ type: 'basic', username: 'alice', password: 'p@ss' });
        await kernel.shutdown();
    });

    it('skips a provider-bound instance marked enabled:false (declared, not materialized)', async () => {
        const { factory, calls } = makeFakeProvider();
        const kernel = await boot([providerConnector('billing', { enabled: false })], { providerFactory: factory });
        expect(automationOf(kernel).getRegisteredConnectors()).not.toContain('billing');
        expect(calls).toHaveLength(0);
        await kernel.shutdown();
    });

    it('leaves plain descriptors (no provider) untouched', async () => {
        const { factory } = makeFakeProvider();
        const descriptor = { name: 'catalog_only', label: 'Catalog', type: 'api', authentication: { type: 'none' } };
        const kernel = await boot([descriptor], { providerFactory: factory });
        expect(automationOf(kernel).getRegisteredConnectors()).not.toContain('catalog_only');
        await kernel.shutdown();
    });

    // ── Hard boot failures (ADR-0096 §Decision / §Acceptance) ──────────────

    it('fails boot loudly when the provider has no registered factory', async () => {
        await expect(
            boot([providerConnector('billing', { provider: 'openapi' })], { providerFactory: undefined }),
        ).rejects.toThrow(/provider 'openapi'.*no provider factory/s);
    });

    it('fails boot loudly when credentialRef does not resolve', async () => {
        const { factory } = makeFakeProvider();
        await expect(
            boot([providerConnector('billing', { auth: { type: 'bearer', credentialRef: 'MISSING' } })], {
                providerFactory: factory,
                credentialResolver: () => undefined,
            }),
        ).rejects.toThrow(/credentialRef 'MISSING' did not resolve/);
    });

    it('fails boot loudly when a provider factory throws (invalid providerConfig)', async () => {
        const factory: ConnectorProviderFactory = () => {
            throw new Error('providerConfig.spec is required');
        };
        await expect(
            boot([providerConnector('billing')], { providerFactory: factory }),
        ).rejects.toThrow(/failed to materialize connector instance 'billing'.*providerConfig\.spec is required/s);
    });

    it('fails boot loudly on a name conflict with a plugin-registered connector (§4)', async () => {
        const { factory } = makeFakeProvider();
        await expect(
            boot([providerConnector('rest')], { providerFactory: factory, registerLivePlugin: ['rest'] }),
        ).rejects.toThrow(/conflict.*'rest'/s);
    });

    it('fails boot loudly on two declarative instances sharing a name', async () => {
        const { factory } = makeFakeProvider();
        await expect(
            boot([providerConnector('dup'), providerConnector('dup')], { providerFactory: factory }),
        ).rejects.toThrow(/duplicate declarative connector instance name 'dup'/);
    });
});

describe('ADR-0096 — runtime re-materialization on metadata:reloaded (F1)', () => {
    it('materializes an instance published after boot', async () => {
        const { factory, calls } = makeClosableProvider();
        const { engine, reload, kernel } = await bootReloadable([], { providerFactory: factory });
        expect(engine.getRegisteredConnectors()).not.toContain('billing');

        await reload([providerConnector('billing')]);
        expect(engine.getRegisteredConnectors()).toContain('billing');
        expect(engine.getConnectorOrigin('billing')).toBe('declarative');
        expect(calls).toHaveLength(1);
        await kernel.shutdown();
    });

    it('unregisters and tears down an instance removed after boot', async () => {
        const { factory, closed } = makeClosableProvider();
        const { engine, reload, kernel } = await bootReloadable([providerConnector('billing')], { providerFactory: factory });
        expect(engine.getRegisteredConnectors()).toContain('billing');

        await reload([]); // billing deleted from the stack
        expect(engine.getRegisteredConnectors()).not.toContain('billing');
        expect(closed).toEqual(['billing']); // close() ran on teardown
        await kernel.shutdown();
    });

    it('tears down an instance newly marked enabled:false', async () => {
        const { factory, closed } = makeClosableProvider();
        const { engine, reload, kernel } = await bootReloadable([providerConnector('billing')], { providerFactory: factory });
        await reload([providerConnector('billing', { enabled: false })]);
        expect(engine.getRegisteredConnectors()).not.toContain('billing');
        expect(closed).toEqual(['billing']);
        await kernel.shutdown();
    });

    it('leaves an UNCHANGED instance untouched (no reconnect on unrelated reload)', async () => {
        const { factory, calls, closed } = makeClosableProvider();
        const { reload, kernel } = await bootReloadable(
            [providerConnector('billing', { providerConfig: { baseUrl: 'https://x' } })],
            { providerFactory: factory },
        );
        expect(calls).toHaveLength(1);

        // A reload that does not change billing's inputs must not re-invoke the factory.
        await reload([providerConnector('billing', { providerConfig: { baseUrl: 'https://x' } })]);
        expect(calls).toHaveLength(1);
        expect(closed).toEqual([]);
        await kernel.shutdown();
    });

    it('re-materializes a CHANGED instance and tears down the old connection', async () => {
        const { factory, calls, closed } = makeClosableProvider();
        const { engine, reload, kernel } = await bootReloadable(
            [providerConnector('billing', { providerConfig: { baseUrl: 'https://old' } })],
            { providerFactory: factory },
        );
        expect(calls).toHaveLength(1);

        await reload([providerConnector('billing', { providerConfig: { baseUrl: 'https://new' } })]);
        expect(calls).toHaveLength(2); // re-materialized
        expect(closed).toEqual(['billing']); // old connection torn down
        expect(engine.getRegisteredConnectors()).toContain('billing');
        expect((calls[1].providerConfig as { baseUrl?: string }).baseUrl).toBe('https://new');
        await kernel.shutdown();
    });

    it('reload is soft: an unknown-provider entry is skipped, not fatal, and other connectors survive', async () => {
        const { factory } = makeClosableProvider();
        const { engine, reload, kernel } = await bootReloadable([providerConnector('billing')], { providerFactory: factory });

        // A bad publish must NOT crash the running server (no throw), and the
        // healthy connector keeps serving.
        await expect(
            reload([providerConnector('billing'), providerConnector('ghost', { provider: 'nonexistent' })]),
        ).resolves.toBeUndefined();
        expect(engine.getRegisteredConnectors()).toContain('billing');
        expect(engine.getRegisteredConnectors()).not.toContain('ghost');
        await kernel.shutdown();
    });
});
