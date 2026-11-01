// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0097 — provider-bound declarative connector instances. A `connectors:`
// entry that names a `provider` is materialized at boot by the automation
// service: it looks up the provider factory a connector plugin registered,
// resolves `auth.credentialRef`, and registers the resulting `{ def, handlers }`
// on the connector registry — so `connector_action` dispatches it and
// `GET /connectors` lists it, indistinguishable from a hand-written connector.
// Boot fails loudly for unknown provider / name conflict / factory failure; a
// credentialRef nothing resolves degrades the instance naming it (#27237).

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, afterAll, afterEach, vi } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import type {
    Connector,
    ConnectorProviderContext,
    ConnectorProviderFactory,
    ConnectorInstanceAuth,
} from '@objectstack/spec/integration';
import { ConnectorUpstreamUnavailableError } from '@objectstack/spec/integration';
import {
    AutomationServicePlugin,
    createPackageFileLoader,
    createPackagePathResolver,
    DECLARATIVE_RETRY_BASE_MS,
    type CredentialResolver,
} from './plugin.js';
import type { AutomationEngine } from './engine.js';
import { computeAliyunAcs3Signature } from './request-signing/aliyun-acs3-hmac-sha256.js';
import { computeAlipayV3Signature, readAlipayPrivateKey } from './request-signing/alipay-v3.js';

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
            } as unknown as Connector,
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
    /** The registration options of {@link providerFactory} (ADR-0143 D4's credential-handle opt-in). */
    providerOptions?: { credentialHandle?: boolean };
    /** Names registered as plugin connectors during init() (for the conflict rule). */
    registerLivePlugin?: string[];
    credentialResolver?: CredentialResolver;
    /** Stack/package root that relative file refs resolve against (#3016). */
    packageRoot?: string;
    /** The package registry's rows by id, as `getPackage` answers them (#28534). */
    packages?: Record<string, { source: string }>;
    /** The engine's residual-owner record by id, as `residualOwnerSource` answers it (#28534). */
    residualOwners?: Record<string, 'code' | 'marketplace'>;
    /**
     * The connectors a package REGISTRATION filed, as `getArtifactItem` answers
     * them (#28594). Absent = a registry double with no registered layer.
     */
    registered?: unknown[];
    /** Collects every `logger.error` record the boot writes (#28594: the soft path's record). */
    logged?: Array<{ msg: string; meta?: unknown }>;
}

/** `SchemaRegistry.getArtifactItem('connector', name, packageId)` over `registered` (#28594). */
function artifactReader(registered: unknown[] | undefined) {
    if (registered === undefined) return undefined;
    return (type: string, name: string, packageId?: string) => (type !== 'connector' ? undefined : registered.find(
        (item) => (item as { name?: unknown }).name === name && (item as { _packageId?: unknown })._packageId === packageId,
    ));
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
    kernel.use(new AutomationServicePlugin({ credentialResolver: opts.credentialResolver, packageRoot: opts.packageRoot }));
    const harness = {
        name: 'test.harness',
        type: 'standard' as const,
        version: '1.0.0',
        dependencies: ['com.objectstack.service-automation'],
        async init(ctx: any) {
            ctx.registerService('objectql', {
                registry: {
                    listItems: (type: string) => (type === 'connector' ? declared : []),
                    getPackage: (id: string) => opts.packages?.[id],
                    getArtifactItem: artifactReader(opts.registered),
                },
                residualOwnerSource: (id: string) => opts.residualOwners?.[id],
            });
            if (opts.logged) {
                // The kernel hands every plugin the same logger, so the
                // automation plugin's records arrive here.
                const logged = opts.logged;
                const original = ctx.logger.error.bind(ctx.logger);
                ctx.logger.error = (msg: string, err?: unknown, meta?: unknown) => {
                    logged.push({ msg, meta });
                    return original(msg, err, meta);
                };
            }
            const automation = ctx.getService('automation');
            if (opts.providerFactory) {
                automation.registerConnectorProvider(opts.providerKey ?? 'fake', opts.providerFactory, opts.providerOptions);
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
            } as unknown as Connector,
            handlers: { ping: async () => ({ ok: true }) },
            close: async () => { closed.push(ctx.name); },
        };
    };
    return { factory, calls, closed };
}

/**
 * Boot with a MUTABLE declared set and expose a `reload(next)` that swaps the
 * registry contents and fires `metadata:reloaded` — the runtime reconcile path
 * (ADR-0097 F1). The harness's ctx is the shared kernel context, so
 * `ctx.trigger('metadata:reloaded')` invokes the automation plugin's hook.
 */
async function bootReloadable(
    initial: unknown[],
    opts: {
        providerFactory: ConnectorProviderFactory;
        credentialResolver?: CredentialResolver;
        packageRoot?: string;
        /** The package registry's rows by id, as `getPackage` answers them (#28534). */
        packages?: Record<string, { source: string }>;
        /** The engine's residual-owner record by id, as `residualOwnerSource` answers it (#28534). */
        residualOwners?: Record<string, 'code' | 'marketplace'>;
        /** The connectors a package registration filed, as `getArtifactItem` answers them (#28594). */
        registered?: unknown[];
    },
) {
    const state = { declared: initial };
    let captured: any;
    const kernel = new LiteKernel({ logger: { level: 'silent' } } as never);
    kernel.use(new AutomationServicePlugin({ credentialResolver: opts.credentialResolver, packageRoot: opts.packageRoot }));
    const harness = {
        name: 'test.harness',
        type: 'standard' as const,
        version: '1.0.0',
        dependencies: ['com.objectstack.service-automation'],
        async init(ctx: any) {
            captured = ctx;
            ctx.registerService('objectql', {
                registry: {
                    listItems: (type: string) => (type === 'connector' ? state.declared : []),
                    getPackage: (id: string) => opts.packages?.[id],
                    getArtifactItem: artifactReader(opts.registered),
                },
                residualOwnerSource: (id: string) => opts.residualOwners?.[id],
            });
            ctx.getService('automation').registerConnectorProvider('fake', opts.providerFactory);
        },
        async start() {},
    };
    kernel.use(harness as never);
    await kernel.bootstrap();
    await flush();
    const reload = async (next: unknown[], payload?: unknown) => {
        state.declared = next;
        await captured.trigger('metadata:reloaded', payload);
        await flush();
    };
    return { kernel, engine: automationOf(kernel), reload };
}

describe('ADR-0097 — declarative connector materialization', () => {
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

    // ── Hard boot failures (ADR-0097 §Decision / §Acceptance) ──────────────

    it('fails boot loudly when the provider has no registered factory', async () => {
        await expect(
            boot([providerConnector('billing', { provider: 'openapi' })], { providerFactory: undefined }),
        ).rejects.toThrow(/provider 'openapi'.*no provider factory/s);
    });

    // [#27237] Ruling A on #27230: an administrator installs the app first and
    // fills the credential after, so a reference no arm of the chain answers
    // for degrades its instance — named — instead of failing the boot.
    it('degrades the instance, naming the reference, when credentialRef does not resolve', async () => {
        const { factory, calls } = makeFakeProvider();
        const kernel = await boot([providerConnector('billing', { auth: { type: 'bearer', credentialRef: 'MISSING' } })], {
            providerFactory: factory,
            credentialResolver: () => undefined,
        });
        const engine = automationOf(kernel);
        expect(calls).toHaveLength(0);
        expect(engine.getConnectorDegradedReason('billing')).toMatch(/credential 'MISSING'/);
        await kernel.shutdown();
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

describe('ADR-0097 — runtime re-materialization on metadata:reloaded (F1)', () => {
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

// ── #3016 — package file refs (loadPackageFile) ─────────────────────────────
//
// The `loadPackageFile` capability lets a provider factory dereference a
// relative file ref (the openapi provider's `providerConfig.spec:
// './billing-openapi.json'`) against the declaring stack/package root, with
// reads CONFINED to that root. Failures follow the reconcile policy above:
// fatal at boot, skipped on reload.

const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'adr96-pkgfile-'));
mkdirSync(path.join(fixtureRoot, 'specs'), { recursive: true });
writeFileSync(path.join(fixtureRoot, 'specs', 'billing.json'), JSON.stringify({ openapi: '3.0.0' }));
afterAll(() => rmSync(fixtureRoot, { recursive: true, force: true }));

/** A provider whose factory reads `providerConfig.spec` via ctx.loadPackageFile. */
function makeFileReadingProvider() {
    const reads: string[] = [];
    const factory: ConnectorProviderFactory = async (ctx) => {
        const text = await ctx.loadPackageFile!(String(ctx.providerConfig.spec));
        reads.push(text);
        return {
            def: { name: ctx.name, label: ctx.label, type: 'api', authentication: { type: 'none' }, actions: [{ key: 'ping', label: 'Ping' }] } as unknown as Connector,
            handlers: { ping: async () => ({ ok: true }) },
        };
    };
    return { factory, reads };
}

describe('#3016 — package file loader (createPackageFileLoader)', () => {
    const load = createPackageFileLoader(fixtureRoot);

    it('reads a root-relative file (happy path)', async () => {
        await expect(load('./specs/billing.json')).resolves.toBe(JSON.stringify({ openapi: '3.0.0' }));
        // Plain relative form (no leading ./) resolves identically.
        await expect(load('specs/billing.json')).resolves.toContain('openapi');
    });

    it('rejects absolute paths (posix and windows-drive)', async () => {
        await expect(load(path.join(fixtureRoot, 'specs', 'billing.json'))).rejects.toThrow(/absolute/);
        await expect(load('C:\\evil\\creds.json')).rejects.toThrow(/absolute/);
    });

    it('rejects paths that escape the package root after resolution', async () => {
        await expect(load('../outside.json')).rejects.toThrow(/escapes the stack\/package root/);
        await expect(load('specs/../../outside.json')).rejects.toThrow(/escapes the stack\/package root/);
    });

    it('rejects empty refs and reports unreadable files with the resolved path', async () => {
        await expect(load('')).rejects.toThrow(/non-empty relative path/);
        await expect(load('./specs/missing.json')).rejects.toThrow(/could not be read/);
    });
});

describe('#3016 — file-ref materialization policy (fatal at boot, soft on reload)', () => {
    it('hands every provider factory a working loadPackageFile anchored to packageRoot', async () => {
        const { factory, reads } = makeFileReadingProvider();
        const kernel = await boot(
            [providerConnector('billing', { providerConfig: { spec: './specs/billing.json' } })],
            { providerFactory: factory, packageRoot: fixtureRoot },
        );
        expect(automationOf(kernel).getRegisteredConnectors()).toContain('billing');
        expect(reads).toEqual([JSON.stringify({ openapi: '3.0.0' })]);
        await kernel.shutdown();
    });

    it('fails boot loudly when the file ref is missing', async () => {
        const { factory } = makeFileReadingProvider();
        await expect(
            boot([providerConnector('billing', { providerConfig: { spec: './specs/missing.json' } })], {
                providerFactory: factory,
                packageRoot: fixtureRoot,
            }),
        ).rejects.toThrow(/failed to materialize connector instance 'billing'.*could not be read/s);
    });

    it('fails boot loudly when the file ref escapes the package root', async () => {
        const { factory } = makeFileReadingProvider();
        await expect(
            boot([providerConnector('billing', { providerConfig: { spec: '../outside.json' } })], {
                providerFactory: factory,
                packageRoot: fixtureRoot,
            }),
        ).rejects.toThrow(/escapes the stack\/package root/);
    });

    it('reload is soft: a bad file ref skips the entry, keeps the old connector serving', async () => {
        const { factory } = makeFileReadingProvider();
        const { engine, reload, kernel } = await bootReloadable(
            [providerConnector('billing', { providerConfig: { spec: './specs/billing.json' } })],
            { providerFactory: factory, packageRoot: fixtureRoot },
        );
        expect(engine.getRegisteredConnectors()).toContain('billing');

        // A publish that points billing at a missing file must not crash the
        // server; the previously materialized connector keeps serving.
        await expect(
            reload([providerConnector('billing', { providerConfig: { spec: './specs/missing.json' } })]),
        ).resolves.toBeUndefined();
        expect(engine.getRegisteredConnectors()).toContain('billing');
        await kernel.shutdown();
    });
});

// ── #22434 — package path refs (resolvePackagePath) ─────────────────────────
//
// The sibling of `loadPackageFile` for a factory that needs a LOCATION — a
// launched process's working directory — rather than file contents. Same root,
// same confinement rule (one shared check), same `process.cwd()` default. It
// reads nothing, so a resolved path need not exist.

/** The rejection a promise settles with, or a fail-loud marker if it resolved. */
async function rejectionOf(p: Promise<unknown>): Promise<Error> {
    return p.then(
        (value) => { throw new Error(`expected a refusal, got ${JSON.stringify(value)}`); },
        (err: unknown) => err as Error,
    );
}

describe('#22434 — package path resolver (createPackagePathResolver)', () => {
    const root = path.resolve(fixtureRoot);
    const resolvePath = createPackagePathResolver(fixtureRoot);

    it('resolves a relative path against the package root, and `.` to the root itself', async () => {
        await expect(resolvePath('.')).resolves.toBe(root);
        await expect(resolvePath('./specs/billing.json')).resolves.toBe(path.join(root, 'specs', 'billing.json'));
        await expect(resolvePath('specs')).resolves.toBe(path.join(root, 'specs'));
        // Judged on the RESOLVED path: a traversal that lands back inside passes.
        await expect(resolvePath('./specs/../specs')).resolves.toBe(path.join(root, 'specs'));
        // A location, not a read: a path that does not exist yet still resolves.
        await expect(resolvePath('./scripts/not-there.mjs')).resolves.toBe(path.join(root, 'scripts', 'not-there.mjs'));
    });

    it('refuses a path that escapes the root, naming the ref and the root it is confined to', async () => {
        for (const ref of ['..', '../outside', 'specs/../../outside']) {
            const err = await rejectionOf(resolvePath(ref));
            expect(err).toBeInstanceOf(Error);
            expect(err).not.toBeInstanceOf(TypeError);
            expect(err.message).toContain(`'${ref}' escapes the stack/package root`);
            expect(err.message).toContain(`confined to '${root}'`);
        }
    });

    it('refuses an absolute path (posix and windows-drive) and an empty ref', async () => {
        for (const ref of [path.join(root, 'specs'), '/etc', 'C:\\evil']) {
            const err = await rejectionOf(resolvePath(ref));
            expect(err).not.toBeInstanceOf(TypeError);
            expect(err.message).toContain(`'${ref}' is absolute`);
        }
        for (const ref of ['', '   ']) {
            expect((await rejectionOf(resolvePath(ref))).message).toContain('non-empty relative path');
        }
    });

    it('shares the loader\'s rule: a ref is refused for confinement by both members or by neither', async () => {
        const load = createPackageFileLoader(fixtureRoot);
        const confinement = /non-empty relative path|is absolute|escapes the stack\/package root/;
        const refs = ['.', 'specs', './specs/billing.json', './specs/../specs/billing.json', '', '..', '../x',
            'specs/../../x', '/etc/hostname', 'C:/evil', 'D:\\evil'];
        for (const ref of refs) {
            const loaderRefused = await load(ref).then(() => false, (e: Error) => confinement.test(e.message));
            const resolverRefused = await resolvePath(ref).then(() => false, (e: Error) => confinement.test(e.message));
            expect(resolverRefused, `ref '${ref}'`).toBe(loaderRefused);
        }
    });

    it('defaults to process.cwd() when no packageRoot is given, as the loader does', async () => {
        await expect(createPackagePathResolver()('.')).resolves.toBe(path.resolve(process.cwd()));
    });
});

describe('#22434 — the materializer hands resolvePackagePath anchored to packageRoot', () => {
    /** A provider whose factory resolves the refs in `providerConfig.paths` before materializing. */
    function makePathResolvingProvider() {
        const resolved: string[] = [];
        const factory: ConnectorProviderFactory = async (ctx) => {
            for (const ref of (ctx.providerConfig.paths as string[]) ?? []) {
                resolved.push(await ctx.resolvePackagePath!(ref));
            }
            return {
                def: { name: ctx.name, label: ctx.label, type: 'api', authentication: { type: 'none' }, actions: [{ key: 'ping', label: 'Ping' }] } as unknown as Connector,
                handlers: { ping: async () => ({ ok: true }) },
            };
        };
        return { factory, resolved };
    }

    it('a factory resolving `.` and a relative path gets locations under packageRoot', async () => {
        const { factory, resolved } = makePathResolvingProvider();
        const kernel = await boot(
            [providerConnector('tools', { providerConfig: { paths: ['.', './scripts/fixture.mjs'] } })],
            { providerFactory: factory, packageRoot: fixtureRoot },
        );
        expect(automationOf(kernel).getRegisteredConnectors()).toContain('tools');
        expect(resolved).toEqual([path.resolve(fixtureRoot), path.join(path.resolve(fixtureRoot), 'scripts', 'fixture.mjs')]);
        await kernel.shutdown();
    });

    it('fails boot loudly when a factory resolves a path that escapes the package root', async () => {
        const { factory, resolved } = makePathResolvingProvider();
        await expect(
            boot([providerConnector('tools', { providerConfig: { paths: ['../outside'] } })], {
                providerFactory: factory,
                packageRoot: fixtureRoot,
            }),
        ).rejects.toThrow(/failed to materialize connector instance 'tools'.*'\.\.\/outside' escapes the stack\/package root/s);
        expect(resolved).toEqual([]);
    });

    it('a factory that never reads it materializes exactly as before', async () => {
        const { factory, calls } = makeFakeProvider();
        const kernel = await boot([providerConnector('billing')], { providerFactory: factory, packageRoot: fixtureRoot });
        const engine = automationOf(kernel);
        expect(engine.getRegisteredConnectors()).toContain('billing');
        // The member is handed (the factory simply ignores it) …
        expect(typeof calls[0]?.resolvePackagePath).toBe('function');
        // … and the connector it materialized is listed exactly as it always was.
        const desc = engine.getConnectorDescriptors().find((d) => d.name === 'billing');
        expect(desc?.actions.map((a) => a.key)).toEqual(['ping']);
        expect(desc?.origin).toBe('declarative');
        expect(calls).toHaveLength(1);
        await kernel.shutdown();
    });
});

// ── #28534 — an INSTALLED package's package-relative refs are refused ───────
//
// `loadPackageFile` / `resolvePackagePath` resolve a relative ref against the
// root of the package that DECLARED the entry. A package installed into the
// runtime (registry source `marketplace`) has no root on disk, and the host's
// root is not its own, so its entries are handed members that refuse every
// ref; the host's own entries keep reading their files exactly as before.

describe('#28534 — an entry an installed package declares is refused its package-relative refs', () => {
    const INSTALLED = 'com.acme.installed';
    const HOST = 'com.acme.host';
    const packages = { [INSTALLED]: { source: 'marketplace' }, [HOST]: { source: 'code' } };
    const HOST_RESIDUAL = 'com.acme.host.stack';
    const INSTALLED_RESIDUAL = 'com.acme.installed.bundle';
    const residualOwners = { [HOST_RESIDUAL]: 'code', [INSTALLED_RESIDUAL]: 'marketplace' } as const;
    const ownedBy = <T extends object>(item: T, packageId: string) => ({ ...item, _packageId: packageId });

    /**
     * A provider that dereferences `providerConfig.spec` through
     * `loadPackageFile` only when it is a string, and resolves each of
     * `providerConfig.paths` through `resolvePackagePath` — so an inline
     * document reaches neither member.
     */
    function makeRefProvider() {
        const reads: string[] = [];
        const resolved: string[] = [];
        const factory: ConnectorProviderFactory = async (ctx) => {
            if (typeof ctx.providerConfig.spec === 'string') reads.push(await ctx.loadPackageFile!(ctx.providerConfig.spec));
            for (const ref of (ctx.providerConfig.paths as string[] | undefined) ?? []) {
                resolved.push(await ctx.resolvePackagePath!(ref));
            }
            return {
                def: { name: ctx.name, label: ctx.label, type: 'api', authentication: { type: 'none' }, actions: [{ key: 'ping', label: 'Ping' }] } as unknown as Connector,
                handlers: { ping: async () => ({ ok: true }) },
            };
        };
        return { factory, reads, resolved };
    }

    it('reload: an installed entry naming a file the host has is not materialized, and nothing is read', async () => {
        const { factory, reads } = makeRefProvider();
        const { engine, reload, kernel } = await bootReloadable([], { providerFactory: factory, packageRoot: fixtureRoot, packages });
        await expect(
            reload([ownedBy(providerConnector('billing', { providerConfig: { spec: './specs/billing.json' } }), INSTALLED)]),
        ).resolves.toBeUndefined();
        expect(engine.getRegisteredConnectors()).not.toContain('billing');
        expect(reads).toEqual([]);
        await kernel.shutdown();
    });

    it('the refusal names the entry, its package, the ref and the remedy (the boot reconcile throws it)', async () => {
        const { factory, reads } = makeRefProvider();
        const err = await rejectionOf(
            boot([ownedBy(providerConnector('billing', { providerConfig: { spec: './specs/billing.json' } }), INSTALLED)], {
                providerFactory: factory,
                packageRoot: fixtureRoot,
                packages,
            }),
        );
        expect(err.message).toContain(`failed to materialize connector instance 'billing'`);
        expect(err.message).toContain(`connector instance 'billing' is declared by package '${INSTALLED}'`);
        expect(err.message).toContain(`file ref './specs/billing.json' is refused`);
        expect(err.message).toContain('`os build`');
        // Never the host's path: the ref was not resolved at all.
        expect(err.message).not.toContain(path.resolve(fixtureRoot));
        expect(reads).toEqual([]);
    });

    it('resolvePackagePath takes the same rule: an installed entry asking for `.` is refused, naming the path ref', async () => {
        const { factory, resolved } = makeRefProvider();
        const err = await rejectionOf(
            boot([ownedBy(providerConnector('tools', { providerConfig: { paths: ['.'] } }), INSTALLED)], {
                providerFactory: factory,
                packageRoot: fixtureRoot,
                packages,
            }),
        );
        expect(err.message).toContain(`connector instance 'tools' is declared by package '${INSTALLED}'`);
        expect(err.message).toContain(`path ref '.' is refused`);
        expect(err.message).not.toContain(path.resolve(fixtureRoot));
        expect(resolved).toEqual([]);
    });

    it('control: an installed entry carrying its document inline materializes — neither member is reached', async () => {
        const { factory, reads, resolved } = makeRefProvider();
        const kernel = await boot([ownedBy(providerConnector('billing', { providerConfig: { spec: { openapi: '3.0.0' } } }), INSTALLED)], {
            providerFactory: factory,
            packageRoot: fixtureRoot,
            packages,
        });
        expect(automationOf(kernel).getRegisteredConnectors()).toContain('billing');
        expect(reads).toEqual([]);
        expect(resolved).toEqual([]);
        await kernel.shutdown();
    });

    it('control: the host\'s own entries read and resolve under its root — a `code` row, the residual owner a `code` door recorded, no stamp', async () => {
        const { factory, reads, resolved } = makeRefProvider();
        const spec = './specs/billing.json';
        const kernel = await boot(
            [
                ownedBy(providerConnector('host_pkg', { providerConfig: { spec, paths: ['.'] } }), HOST),
                // The host artifact's residual owner: no package row, but the
                // `manifest` service recorded the boot door's `code` for it.
                ownedBy(providerConnector('residual', { providerConfig: { spec } }), HOST_RESIDUAL),
                providerConnector('unstamped', { providerConfig: { spec } }),
            ],
            { providerFactory: factory, packageRoot: fixtureRoot, packages, residualOwners },
        );
        const registered = automationOf(kernel).getRegisteredConnectors();
        expect(registered).toEqual(expect.arrayContaining(['host_pkg', 'residual', 'unstamped']));
        expect(reads).toEqual(Array(3).fill(JSON.stringify({ openapi: '3.0.0' })));
        expect(resolved).toEqual([path.resolve(fixtureRoot)]);
        await kernel.shutdown();
    });

    it('a stamp no registration answers for is refused, never read as the host\'s — no row and no residual record', async () => {
        const { factory, reads } = makeRefProvider();
        const err = await rejectionOf(
            boot([ownedBy(providerConnector('billing', { providerConfig: { spec: './specs/billing.json' } }), 'com.acme.nobody')], {
                providerFactory: factory,
                packageRoot: fixtureRoot,
                packages,
                residualOwners,
            }),
        );
        expect(err.message).toContain(`connector instance 'billing' names package 'com.acme.nobody' as its owner`);
        expect(err.message).toContain(`file ref './specs/billing.json' is refused`);
        expect(err.message).not.toContain(path.resolve(fixtureRoot));
        expect(reads).toEqual([]);
    });

    it('an installed bundle\'s residual owner (recorded by an install, no row) is installed: refused', async () => {
        const { factory, reads } = makeRefProvider();
        const err = await rejectionOf(
            boot([ownedBy(providerConnector('billing', { providerConfig: { spec: './specs/billing.json' } }), INSTALLED_RESIDUAL)], {
                providerFactory: factory,
                packageRoot: fixtureRoot,
                packages,
                residualOwners,
            }),
        );
        expect(err.message).toContain(`connector instance 'billing' is declared by package '${INSTALLED_RESIDUAL}', which was installed`);
        expect(reads).toEqual([]);
    });

    it('control: one installed entry refused on reload leaves the host\'s entry beside it serving', async () => {
        const { factory } = makeRefProvider();
        const host = ownedBy(providerConnector('host_pkg', { providerConfig: { spec: './specs/billing.json' } }), HOST);
        const { engine, reload, kernel } = await bootReloadable([host], { providerFactory: factory, packageRoot: fixtureRoot, packages });
        await reload([host, ownedBy(providerConnector('installed', { providerConfig: { spec: './specs/billing.json' } }), INSTALLED)]);
        expect(engine.getRegisteredConnectors()).toContain('host_pkg');
        expect(engine.getRegisteredConnectors()).not.toContain('installed');
        await kernel.shutdown();
    });
});

// ── #28594 — a STORED definition's package-relative refs are refused ────────
//
// The post-boot declaration is the protocol's execution view: the registry's
// items with the environment's stored rows (`sys_metadata`, the metadata door)
// served over and beside them. A stored row is no package's declaration and has
// no root on disk, so only what a registering door filed (`getArtifactItem`,
// with the same provider binding) or the host's own artifact carried reads the
// host's root. Here a row in `declared` that `registered` does not hold is a
// stored row.

describe('#28594 — a definition stored in this environment is refused its package-relative refs', () => {
    const HOST = 'com.acme.host';
    const AUTHORED = 'com.acme.authored';
    const HOST_RESIDUAL = 'com.acme.host.stack';
    const packages = { [HOST]: { source: 'code' }, [AUTHORED]: { source: 'authored' } };
    const residualOwners = { [HOST_RESIDUAL]: 'code' } as const;
    const ownedBy = <T extends object>(item: T, packageId: string) => ({ ...item, _packageId: packageId });
    const spec = './specs/billing.json';

    function makeRefProvider() {
        const reads: string[] = [];
        const resolved: string[] = [];
        const factory: ConnectorProviderFactory = async (ctx) => {
            if (typeof ctx.providerConfig.spec === 'string') reads.push(await ctx.loadPackageFile!(ctx.providerConfig.spec));
            for (const ref of (ctx.providerConfig.paths as string[] | undefined) ?? []) {
                resolved.push(await ctx.resolvePackagePath!(ref));
            }
            return {
                def: { name: ctx.name, label: ctx.label, type: 'api', authentication: { type: 'none' }, actions: [{ key: 'ping', label: 'Ping' }] } as unknown as Connector,
                handlers: { ping: async () => ({ ok: true }) },
            };
        };
        return { factory, reads, resolved };
    }

    /** The host's registered entry, as both the registry and its declaration hold it. */
    const hostEntry = ownedBy(providerConnector('host_pkg', { providerConfig: { spec, paths: ['.'] } }), HOST);
    const residualEntry = ownedBy(providerConnector('residual', { providerConfig: { spec } }), HOST_RESIDUAL);
    const registered = [hostEntry, residualEntry];

    /**
     * Boot over `declared` (the registry as a restart leaves it, a stored row
     * hydrated beside the host's registrations). The boot must START: a stored
     * entry's refused ref is logged and the entry skipped, never a failed boot.
     */
    async function bootOverStored(declared: unknown[], opts: BootOptions) {
        const logged: Array<{ msg: string; meta?: unknown }> = [];
        const kernel = await boot(declared, { ...opts, logged });
        const recordOf = (name: string): string => {
            const record = logged.find((l) => l.msg.includes(`connector instance '${name}'`));
            return record === undefined ? '' : `${record.msg} ${JSON.stringify(record.meta)}`;
        };
        return { kernel, engine: automationOf(kernel), recordOf };
    }

    it('an environment-wide stored row (no package) naming a file is refused, naming the entry, the ref and the remedy', async () => {
        const { factory, reads } = makeRefProvider();
        const { kernel, engine, recordOf } = await bootOverStored([providerConnector('stored', { providerConfig: { spec } })], {
            providerFactory: factory, packageRoot: fixtureRoot, packages, registered,
        });
        expect(engine.getRegisteredConnectors()).not.toContain('stored');
        const record = recordOf('stored');
        expect(record).toContain(`failed to materialize connector instance 'stored'`);
        expect(record).toContain(`connector instance 'stored' is stored in this environment, not declared by the host's own stack`);
        expect(record).toContain(`file ref '${spec}' is refused`);
        expect(record).toContain('Carry the document inline in the definition, or name it by an http(s) URL.');
        expect(record).not.toContain(path.resolve(fixtureRoot));
        expect(reads).toEqual([]);
        await kernel.shutdown();
    });

    it('a row of an `authored` package is refused, naming its package', async () => {
        const { factory, reads } = makeRefProvider();
        const { kernel, engine, recordOf } = await bootOverStored(
            [ownedBy(providerConnector('authored', { providerConfig: { spec } }), AUTHORED)],
            { providerFactory: factory, packageRoot: fixtureRoot, packages, registered },
        );
        expect(engine.getRegisteredConnectors()).not.toContain('authored');
        expect(recordOf('authored')).toContain(`connector instance 'authored' is stored in this environment (package '${AUTHORED}')`);
        expect(recordOf('authored')).toContain(`file ref '${spec}' is refused`);
        expect(reads).toEqual([]);
        await kernel.shutdown();
    });

    it('a row of an `authored` package whose package row the boot has not read yet is stored too, not unrecorded', async () => {
        // On a restart the package's rows reach the boot reconcile before its
        // package row does: no row, no residual record, nothing filed.
        const { factory, reads } = makeRefProvider();
        const { kernel, engine, recordOf } = await bootOverStored(
            [ownedBy(providerConnector('authored_early', { providerConfig: { spec } }), 'com.acme.authored.unread')],
            { providerFactory: factory, packageRoot: fixtureRoot, packages, residualOwners, registered },
        );
        expect(engine.getRegisteredConnectors()).not.toContain('authored_early');
        expect(recordOf('authored_early')).toContain(
            `connector instance 'authored_early' is stored in this environment (package 'com.acme.authored.unread')`,
        );
        expect(reads).toEqual([]);
        await kernel.shutdown();
    });

    it('a row claiming the host\'s package that no registration filed is refused', async () => {
        const { factory, reads } = makeRefProvider();
        const { kernel, engine, recordOf } = await bootOverStored(
            [ownedBy(providerConnector('claims_host', { providerConfig: { spec } }), HOST)],
            { providerFactory: factory, packageRoot: fixtureRoot, packages, registered },
        );
        expect(engine.getRegisteredConnectors()).not.toContain('claims_host');
        expect(recordOf('claims_host')).toContain(`connector instance 'claims_host' is stored in this environment (package '${HOST}')`);
        expect(reads).toEqual([]);
        await kernel.shutdown();
    });

    it('a row served under the host\'s registered name with another binding is refused (reload: not materialized)', async () => {
        const { factory, reads } = makeRefProvider();
        const { engine, reload, kernel } = await bootReloadable([], { providerFactory: factory, packageRoot: fixtureRoot, packages, registered });
        await reload([ownedBy(providerConnector('host_pkg', { providerConfig: { spec: './specs/../specs/billing.json' } }), HOST)]);
        expect(engine.getRegisteredConnectors()).not.toContain('host_pkg');
        expect(reads).toEqual([]);
        await kernel.shutdown();
    });

    it('resolvePackagePath takes the same rule: a stored entry asking for `.` is refused', async () => {
        const { factory, resolved } = makeRefProvider();
        const { kernel, engine, recordOf } = await bootOverStored([providerConnector('tools', { providerConfig: { paths: ['.'] } })], {
            providerFactory: factory, packageRoot: fixtureRoot, packages, registered,
        });
        expect(engine.getRegisteredConnectors()).not.toContain('tools');
        const record = recordOf('tools');
        expect(record).toContain(`connector instance 'tools' is stored in this environment`);
        expect(record).toContain(`path ref '.' is refused`);
        expect(record).toContain('cannot serve a stored entry');
        expect(record).not.toContain(path.resolve(fixtureRoot));
        expect(resolved).toEqual([]);
        await kernel.shutdown();
    });

    it('a restart over stored rows at rest starts: each refused row is skipped, and the host\'s entries beside them serve', async () => {
        const { factory, reads, resolved } = makeRefProvider();
        const { kernel, engine, recordOf } = await bootOverStored(
            [
                { ...hostEntry },
                providerConnector('stored_file', { providerConfig: { spec } }),
                providerConnector('stored_path', { providerConfig: { paths: ['.'] } }),
                ownedBy(providerConnector('stored_authored', { providerConfig: { spec } }), AUTHORED),
                providerConnector('stored_inline', { providerConfig: { spec: { openapi: '3.0.0' } } }),
            ],
            { providerFactory: factory, packageRoot: fixtureRoot, packages, registered },
        );
        const served = engine.getRegisteredConnectors();
        expect(served).toEqual(expect.arrayContaining(['host_pkg', 'stored_inline']));
        for (const name of ['stored_file', 'stored_path', 'stored_authored']) {
            expect(served).not.toContain(name);
            expect(recordOf(name)).toContain('is refused');
        }
        // Only the host's entry read and resolved its root.
        expect(reads).toEqual([JSON.stringify({ openapi: '3.0.0' })]);
        expect(resolved).toEqual([path.resolve(fixtureRoot)]);
        await kernel.shutdown();
    });

    it('control: the host\'s own entry with a configuration fault (an unknown provider) still fails the boot', async () => {
        // The soft path is a stored entry's alone (#28698): the host's
        // registered declaration, faulty as filed, keeps the fail-loud contract.
        const { factory } = makeRefProvider();
        const faulty = { ...hostEntry, provider: 'no_such_provider' };
        const err = await rejectionOf(
            boot([{ ...faulty }], { providerFactory: factory, packageRoot: fixtureRoot, packages, registered: [faulty] }),
        );
        expect(err.message).toContain(`connector instance 'host_pkg' declares provider 'no_such_provider'`);
    });

    it('control: a stored entry carrying its document inline materializes — neither member is reached', async () => {
        const { factory, reads, resolved } = makeRefProvider();
        const kernel = await boot([providerConnector('inline', { providerConfig: { spec: { openapi: '3.0.0' } } })], {
            providerFactory: factory, packageRoot: fixtureRoot, packages, registered,
        });
        expect(automationOf(kernel).getRegisteredConnectors()).toContain('inline');
        expect(reads).toEqual([]);
        expect(resolved).toEqual([]);
        await kernel.shutdown();
    });

    it('control: the host\'s registered entries read and resolve under its root — a `code` package and a `code` residual', async () => {
        const { factory, reads, resolved } = makeRefProvider();
        // Equal bindings, distinct objects: the judgment is the binding, not identity.
        const kernel = await boot([{ ...hostEntry }, { ...residualEntry }], {
            providerFactory: factory, packageRoot: fixtureRoot, packages, residualOwners, registered,
        });
        expect(automationOf(kernel).getRegisteredConnectors()).toEqual(expect.arrayContaining(['host_pkg', 'residual']));
        expect(reads).toEqual(Array(2).fill(JSON.stringify({ openapi: '3.0.0' })));
        expect(resolved).toEqual([path.resolve(fixtureRoot)]);
        await kernel.shutdown();
    });

    it('control: an entry the host\'s own artifact reload carries reads its root, stamped or not', async () => {
        const { factory, reads } = makeRefProvider();
        const { engine, reload, kernel } = await bootReloadable([], { providerFactory: factory, packageRoot: fixtureRoot, packages, registered });
        // An edit the registry was never re-told: only the reload payload holds it.
        const edited = ownedBy(providerConnector('host_pkg', { providerConfig: { spec: './specs/../specs/billing.json' } }), HOST);
        const unstamped = providerConnector('host_unstamped', { providerConfig: { spec } });
        await reload([], { metadata: { manifest: { id: HOST }, connectors: [edited, unstamped] } });
        expect(engine.getRegisteredConnectors()).toEqual(expect.arrayContaining(['host_pkg', 'host_unstamped']));
        expect(reads).toHaveLength(2);
        await kernel.shutdown();
    });
});

// ── #28698 — every configuration fault of a STORED entry is soft at boot ────
//
// #28594 made a stored entry's refused ref soft at boot. Every other
// configuration fault the boot reconcile meets on a stored entry takes the same
// path (#28698): logged with the record a reload writes, the entry skipped,
// the host's entries beside it served. The host's own entry with the same fault
// keeps failing the boot.

describe('#28698 — a stored entry\'s configuration fault never fails the boot; the host\'s still does', () => {
    const HOST = 'com.acme.host';
    const packages = { [HOST]: { source: 'code' } };
    const ownedBy = <T extends object>(item: T, packageId: string) => ({ ...item, _packageId: packageId });
    const bearer = { type: 'bearer', credentialRef: 'OS_TEST_28698_VAULT_REF' } as ConnectorInstanceAuth;

    /** A factory that materializes every entry, except one whose providerConfig asks it to refuse. */
    function makeProvider() {
        const calls: string[] = [];
        const factory: ConnectorProviderFactory = (ctx) => {
            calls.push(ctx.name);
            if (ctx.providerConfig.refuse === true) throw new Error(`providerConfig of '${ctx.name}' is not valid: refuse is set`);
            return {
                def: { name: ctx.name, label: ctx.label, type: 'api', authentication: { type: 'none' }, actions: [{ key: 'ping', label: 'Ping' }] } as unknown as Connector,
                handlers: { ping: async () => ({ ok: true }) },
            };
        };
        return { factory, calls };
    }
    const throwingResolver: CredentialResolver = () => { throw new Error('the vault could not be reached'); };

    /** The host's entry served beside every stored fault: registered, so it is the host's. */
    const hostServed = ownedBy(providerConnector('host_served'), HOST);

    /**
     * One fault, spelled for an entry `name`: what the entry carries, the boot
     * options it needs, and the record text that names it.
     */
    const FAULTS: Array<{
        fault: string;
        entry: (name: string) => Record<string, unknown>;
        opts?: Partial<BootOptions>;
        livePlugin?: boolean;
        record: (name: string) => string;
    }> = [
        {
            fault: 'a provider no plugin offers',
            entry: (name) => providerConnector(name, { provider: 'no_such_provider' }),
            record: (name) => `connector instance '${name}' declares provider 'no_such_provider', but no provider factory is registered`,
        },
        {
            fault: 'an invalid retryConfig',
            entry: (name) => ({ ...providerConnector(name), retryConfig: { maxAttempts: -3 } }),
            record: (name) => `connector instance '${name}' (provider 'fake'): retryConfig is not a valid connector retry policy`,
        },
        {
            fault: 'a credential resolver that throws',
            entry: (name) => providerConnector(name, { auth: bearer }),
            opts: { credentialResolver: throwingResolver },
            record: (name) => `connector instance '${name}' (provider 'fake'): auth resolution failed`,
        },
        {
            fault: 'a name a plugin connector holds',
            entry: (name) => providerConnector(name),
            livePlugin: true,
            record: (name) => `declarative provider-bound instance '${name}' collides with a plugin-registered connector`,
        },
        {
            fault: 'a providerConfig its provider refuses',
            entry: (name) => providerConnector(name, { providerConfig: { refuse: true } }),
            record: (name) => `failed to materialize connector instance '${name}' via provider 'fake'`,
        },
    ];

    it.each(FAULTS.map((f) => [f.fault, f] as const))('a stored entry with %s: the boot starts, the entry is skipped with its record, the host\'s entry serves', async (_fault, f) => {
        const { factory } = makeProvider();
        const logged: Array<{ msg: string; meta?: unknown }> = [];
        const name = 'stored_faulty';
        const kernel = await boot([{ ...hostServed }, f.entry(name)], {
            providerFactory: factory, packages, registered: [hostServed], logged,
            ...(f.livePlugin ? { registerLivePlugin: [name] } : {}),
            ...f.opts,
        });
        const engine = automationOf(kernel);
        expect(engine.getRegisteredConnectors()).toContain('host_served');
        // Skipped: nothing declarative serves the name (a plugin connector may).
        expect(engine.getConnectorOrigin(name)).not.toBe('declarative');
        const record = logged.find((l) => l.msg.includes(f.record(name)));
        expect(record, `no record names '${name}': ${JSON.stringify(logged.map((l) => l.msg))}`).toBeDefined();
        await kernel.shutdown();
    });

    it.each(FAULTS.map((f) => [f.fault, f] as const))('control: the host\'s own entry with %s still fails the boot', async (_fault, f) => {
        const { factory } = makeProvider();
        const name = 'host_faulty';
        const faulty = ownedBy(f.entry(name), HOST);
        const err = await rejectionOf(boot([{ ...faulty }], {
            providerFactory: factory, packages, registered: [faulty],
            ...(f.livePlugin ? { registerLivePlugin: [name] } : {}),
            ...f.opts,
        }));
        expect(err.message).toContain(f.record(name));
    });

    it('a stored entry duplicating the host\'s name is skipped with its record; the host\'s entry serves', async () => {
        const { factory, calls } = makeProvider();
        const logged: Array<{ msg: string; meta?: unknown }> = [];
        const kernel = await boot(
            [{ ...hostServed }, providerConnector('host_served', { providerConfig: { other: true } })],
            { providerFactory: factory, packages, registered: [hostServed], logged },
        );
        expect(automationOf(kernel).getRegisteredConnectors()).toContain('host_served');
        expect(calls).toEqual(['host_served']);
        expect(logged.some((l) => l.msg.includes(`duplicate declarative connector instance name 'host_served'`))).toBe(true);
        await kernel.shutdown();
    });

    it('control: two host entries of one name still fail the boot', async () => {
        const { factory } = makeProvider();
        const err = await rejectionOf(boot([{ ...hostServed }, { ...hostServed }], {
            providerFactory: factory, packages, registered: [hostServed],
        }));
        expect(err.message).toContain(`duplicate declarative connector instance name 'host_served'`);
    });

    it('control: an INSTALLED package\'s entry with a configuration fault still fails the boot (#28534 unchanged)', async () => {
        const { factory } = makeProvider();
        const installed = ownedBy(providerConnector('installed_faulty', { provider: 'no_such_provider' }), 'com.acme.installed');
        const err = await rejectionOf(boot([installed], {
            providerFactory: factory, packages: { ...packages, 'com.acme.installed': { source: 'marketplace' } }, registered: [installed],
        }));
        expect(err.message).toContain(`connector instance 'installed_faulty' declares provider 'no_such_provider'`);
    });
});

// ── #3017 — upstream unavailable: degrade + retry, never a dead boot ─────────
//
// A provider factory that throws the CONNECTOR_UPSTREAM_UNAVAILABLE marker
// (connector-mcp does, when its MCP server is unreachable) is an *operational*
// fault: the instance is registered as a degraded, action-less husk — visible
// via GET /connectors, dispatch fails with a pointed error — and retried with
// exponential backoff plus on every reconcile. Configuration faults (plain
// throws) keep the ADR-0097 fail-loud contract, asserted above.

/**
 * A provider factory whose availability is a switch: while `down`, it throws
 * the unavailable marker (as connector-mcp does for an unreachable server);
 * once up, it materializes a one-action connector. Counts invocations and
 * records closes.
 */
function makeFlakyUpstreamProvider(opts: { down: boolean }) {
    const state = { down: opts.down, calls: 0 };
    const closed: string[] = [];
    const factory: ConnectorProviderFactory = (ctx) => {
        state.calls++;
        if (state.down) {
            throw new ConnectorUpstreamUnavailableError(
                `connector '${ctx.name}' could not reach its MCP server: connect ECONNREFUSED`,
            );
        }
        return {
            def: {
                name: ctx.name,
                label: ctx.label,
                type: 'api',
                authentication: { type: 'none' },
                actions: [{ key: 'ping', label: 'Ping' }],
            } as unknown as Connector,
            handlers: { ping: async () => ({ ok: true }) },
            close: async () => { closed.push(ctx.name); },
        };
    };
    return { factory, state, closed };
}

/**
 * Like {@link bootReloadable} but with NO real-timer flushes, so it can run
 * entirely under `vi.useFakeTimers()` — the boot reconcile is awaited inside
 * the plugin's start() and the reload reconcile inside the hook trigger, so
 * nothing here depends on a timer tick.
 */
async function bootDegradable(initial: unknown[], factory: ConnectorProviderFactory) {
    const state = { declared: initial };
    let captured: any;
    const kernel = new LiteKernel({ logger: { level: 'silent' } } as never);
    kernel.use(new AutomationServicePlugin());
    kernel.use({
        name: 'test.harness',
        type: 'standard' as const,
        version: '1.0.0',
        dependencies: ['com.objectstack.service-automation'],
        async init(ctx: any) {
            captured = ctx;
            ctx.registerService('objectql', {
                registry: { listItems: (type: string) => (type === 'connector' ? state.declared : []) },
            });
            ctx.getService('automation').registerConnectorProvider('fake', factory);
        },
        async start() {},
    } as never);
    await kernel.bootstrap();
    const reload = async (next: unknown[]) => {
        state.declared = next;
        await captured.trigger('metadata:reloaded');
    };
    return { kernel, engine: automationOf(kernel), reload };
}

describe('#3017 — upstream-unavailable degrade + retry', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('boot survives an unreachable upstream: the instance registers DEGRADED, not dead, not fatal', async () => {
        const { factory, state } = makeFlakyUpstreamProvider({ down: true });
        const { kernel, engine } = await bootDegradable([providerConnector('gh_mcp')], factory);

        // Boot did not throw; the husk is visible and honest.
        const desc = engine.getConnectorDescriptors().find((d) => d.name === 'gh_mcp');
        expect(desc?.state).toBe('degraded');
        expect(desc?.origin).toBe('declarative');
        expect(desc?.actions).toEqual([]);
        expect(desc?.degradedReason).toContain('ECONNREFUSED');
        expect(engine.getConnectorDegradedReason('gh_mcp')).toContain('ECONNREFUSED');
        // No handlers exist yet — dispatch cannot resolve an action on the husk.
        expect(engine.resolveConnectorAction('gh_mcp', 'ping')).toBeUndefined();
        expect(state.calls).toBe(1);

        await kernel.shutdown();
    });

    it('a connector_action against a degraded instance fails with the reason, not the generic wiring hint', async () => {
        const { factory } = makeFlakyUpstreamProvider({ down: true });
        const { kernel, engine } = await bootDegradable([providerConnector('gh_mcp')], factory);

        engine.registerFlow('call_mcp', {
            name: 'call_mcp',
            label: 'Call MCP',
            type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                {
                    id: 'call',
                    type: 'connector_action',
                    label: 'Ping',
                    connectorConfig: { connectorId: 'gh_mcp', actionId: 'ping', input: {} },
                },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'call' },
                { id: 'e2', source: 'call', target: 'end' },
            ],
        } as never);

        const result = await engine.execute('call_mcp');
        expect(result.success).toBe(false);
        expect(JSON.stringify(result)).toMatch(/is degraded/);
        expect(JSON.stringify(result)).toMatch(/ECONNREFUSED/);

        await kernel.shutdown();
    });

    it('recovers on the backoff timer once the upstream is back', async () => {
        vi.useFakeTimers();
        const { factory, state } = makeFlakyUpstreamProvider({ down: true });
        const { kernel, engine } = await bootDegradable([providerConnector('gh_mcp')], factory);
        expect(state.calls).toBe(1);
        expect(engine.getConnectorDegradedReason('gh_mcp')).toBeDefined();

        state.down = false;
        await vi.advanceTimersByTimeAsync(DECLARATIVE_RETRY_BASE_MS);

        expect(state.calls).toBe(2); // the retry ran
        const desc = engine.getConnectorDescriptors().find((d) => d.name === 'gh_mcp');
        expect(desc?.state).toBe('ready');
        expect(desc?.degradedReason).toBeUndefined();
        expect(desc?.actions.map((a) => a.key)).toEqual(['ping']);
        expect(engine.getConnectorDegradedReason('gh_mcp')).toBeUndefined();
        expect(engine.resolveConnectorAction('gh_mcp', 'ping')).toBeDefined();

        await kernel.shutdown();
    });

    it('backs off exponentially while the upstream stays down', async () => {
        vi.useFakeTimers();
        const { factory, state } = makeFlakyUpstreamProvider({ down: true });
        const { kernel } = await bootDegradable([providerConnector('gh_mcp')], factory);
        expect(state.calls).toBe(1); // boot attempt

        // Retry 1 fires after BASE.
        await vi.advanceTimersByTimeAsync(DECLARATIVE_RETRY_BASE_MS);
        expect(state.calls).toBe(2);

        // Retry 2 is now scheduled at 2·BASE: not yet at +BASE …
        await vi.advanceTimersByTimeAsync(DECLARATIVE_RETRY_BASE_MS);
        expect(state.calls).toBe(2);
        // … but fires by +2·BASE.
        await vi.advanceTimersByTimeAsync(DECLARATIVE_RETRY_BASE_MS);
        expect(state.calls).toBe(3);

        await kernel.shutdown();
    });

    it('a metadata reload retries a degraded instance immediately and can recover it', async () => {
        const { factory, state } = makeFlakyUpstreamProvider({ down: true });
        const { kernel, engine, reload } = await bootDegradable([providerConnector('gh_mcp')], factory);
        expect(engine.getConnectorDegradedReason('gh_mcp')).toBeDefined();

        state.down = false;
        await reload([providerConnector('gh_mcp')]); // unchanged entry — but degraded, so retried
        expect(state.calls).toBe(2);
        expect(engine.getConnectorDegradedReason('gh_mcp')).toBeUndefined();
        expect(engine.getConnectorDescriptors().find((d) => d.name === 'gh_mcp')?.state).toBe('ready');

        await kernel.shutdown();
    });

    it('a degraded instance removed from the stack is dropped entirely (husk + pending retry)', async () => {
        vi.useFakeTimers();
        const { factory, state } = makeFlakyUpstreamProvider({ down: true });
        const { kernel, engine, reload } = await bootDegradable([providerConnector('gh_mcp')], factory);
        expect(engine.getRegisteredConnectors()).toContain('gh_mcp');

        await reload([]);
        expect(engine.getRegisteredConnectors()).not.toContain('gh_mcp');
        // No zombie retries: the upstream coming back must not re-register it.
        state.down = false;
        await vi.advanceTimersByTimeAsync(DECLARATIVE_RETRY_BASE_MS * 10);
        expect(engine.getRegisteredConnectors()).not.toContain('gh_mcp');

        await kernel.shutdown();
    });

    it('a changed entry whose new upstream is unreachable keeps the OLD connector serving, then swaps on recovery', async () => {
        vi.useFakeTimers();
        const { factory, state, closed } = makeFlakyUpstreamProvider({ down: false });
        const { kernel, engine, reload } = await bootDegradable(
            [providerConnector('gh_mcp', { providerConfig: { url: 'https://old' } })],
            factory,
        );
        expect(engine.getConnectorDescriptors().find((d) => d.name === 'gh_mcp')?.state).toBe('ready');

        // Publish a config change while the new upstream is down.
        state.down = true;
        await reload([providerConnector('gh_mcp', { providerConfig: { url: 'https://new' } })]);

        // The old connector keeps serving — never degraded out from under a flow.
        const desc = engine.getConnectorDescriptors().find((d) => d.name === 'gh_mcp');
        expect(desc?.state).toBe('ready');
        expect(engine.resolveConnectorAction('gh_mcp', 'ping')).toBeDefined();
        expect(closed).toEqual([]); // old connection untouched

        // Upstream recovers → the pending retry swaps in the new materialization.
        state.down = false;
        await vi.advanceTimersByTimeAsync(DECLARATIVE_RETRY_BASE_MS);
        expect(closed).toEqual(['gh_mcp']); // old torn down only after the new one succeeded
        expect(engine.getConnectorDescriptors().find((d) => d.name === 'gh_mcp')?.state).toBe('ready');

        await kernel.shutdown();
    });

    it('reverting a pending change back to the live configuration cancels the retry', async () => {
        vi.useFakeTimers();
        const { factory, state } = makeFlakyUpstreamProvider({ down: false });
        const { kernel, engine, reload } = await bootDegradable(
            [providerConnector('gh_mcp', { providerConfig: { url: 'https://old' } })],
            factory,
        );
        const callsAfterBoot = state.calls;

        state.down = true;
        await reload([providerConnector('gh_mcp', { providerConfig: { url: 'https://new' } })]);
        const callsAfterFailedChange = state.calls;
        expect(callsAfterFailedChange).toBe(callsAfterBoot + 1);

        // Revert to the exact live config: the live connector already IS the
        // desired state — the pending retry must be cancelled, not fired.
        await reload([providerConnector('gh_mcp', { providerConfig: { url: 'https://old' } })]);
        await vi.advanceTimersByTimeAsync(DECLARATIVE_RETRY_BASE_MS * 10);
        expect(state.calls).toBe(callsAfterFailedChange); // no further attempts
        expect(engine.getConnectorDescriptors().find((d) => d.name === 'gh_mcp')?.state).toBe('ready');

        await kernel.shutdown();
    });

    it('shutdown cancels any pending retry', async () => {
        vi.useFakeTimers();
        const { factory, state } = makeFlakyUpstreamProvider({ down: true });
        const { kernel } = await bootDegradable([providerConnector('gh_mcp')], factory);
        expect(state.calls).toBe(1);

        await kernel.shutdown();
        await vi.advanceTimersByTimeAsync(DECLARATIVE_RETRY_BASE_MS * 10);
        expect(state.calls).toBe(1); // destroyed plugin never retried
    });

    it('a PLAIN factory throw at boot is still fatal — the carve-out is only for the unavailable marker', async () => {
        const factory: ConnectorProviderFactory = () => {
            throw new Error('providerConfig.transport is malformed');
        };
        await expect(bootDegradable([providerConnector('gh_mcp')], factory)).rejects.toThrow(
            /failed to materialize connector instance 'gh_mcp'/,
        );
    });
});

// ── ADR-0049 · #18975 — the declared resilience policy reaches the factory ────
//
// The three keys were parsed and then reached nothing: `ConnectorProviderContext`
// carried none of them, so a provider factory had no way to honour what the
// author wrote. These pins are on the MATERIALIZER's half of that — the values
// arriving on the context, resolved — while the executing half is pinned in
// `packages/connectors/connector-rest/src/rest-provider.test.ts`.
describe('ADR-0097 — the entry\'s resilience policy on ConnectorProviderContext (#18975)', () => {
    it('hands the factory a RESOLVED retryConfig — schema defaults applied', async () => {
        const { factory, calls } = makeFakeProvider();
        const kernel = await boot(
            [{ ...providerConnector('billing'), retryConfig: { maxAttempts: 5, retryableStatusCodes: [429] } }],
            { providerFactory: factory },
        );

        // Authored values survive…
        expect(calls[0]?.retryConfig?.maxAttempts).toBe(5);
        expect(calls[0]?.retryConfig?.retryableStatusCodes).toEqual([429]);
        // …and the keys the author left unstated arrive with the schema's
        // defaults already applied, which is what "resolved" buys a factory:
        // it reads real values instead of re-deriving the defaults itself.
        expect(calls[0]?.retryConfig?.strategy).toBe('exponential_backoff');
        expect(calls[0]?.retryConfig?.initialDelayMs).toBe(1000);
        expect(calls[0]?.retryConfig?.jitter).toBe(true);

        await kernel.shutdown();
    });

    it('carries the declared request timeout verbatim', async () => {
        const { factory, calls } = makeFakeProvider();
        const kernel = await boot(
            [{ ...providerConnector('billing'), requestTimeoutMs: 12000 }],
            { providerFactory: factory },
        );

        expect(calls[0]?.requestTimeoutMs).toBe(12000);

        await kernel.shutdown();
    });

    it('⛔ does NOT carry a stored connectionTimeoutMs onto the context — the carry is retired', async () => {
        // ADR-0049: the key was handed to factories as a pure carry and no
        // provider ever applied it, so the member left `ConnectorProviderContext`
        // with the spec key. A row that still spells it (written before the
        // retirement, or by a seam that bypasses the parse) must reach a factory
        // with nothing extra — the host does not resurrect the carry.
        const { factory, calls } = makeFakeProvider();
        const kernel = await boot(
            [{ ...providerConnector('billing'), connectionTimeoutMs: 5000, requestTimeoutMs: 12000 } as Record<string, unknown>],
            { providerFactory: factory },
        );

        expect((calls[0] as unknown as Record<string, unknown>).connectionTimeoutMs).toBeUndefined();
        // The lit control on the same context object and the same boot: the
        // surviving timeout does arrive, so an empty reading above is the
        // retirement and not a dead harness.
        expect(calls[0]?.requestTimeoutMs).toBe(12000);

        await kernel.shutdown();
    });

    it('leaves both undefined when the entry declares none — absence stays absence', async () => {
        const { factory, calls } = makeFakeProvider();
        const kernel = await boot([providerConnector('billing')], { providerFactory: factory });

        expect(calls[0]?.retryConfig).toBeUndefined();
        expect(calls[0]?.requestTimeoutMs).toBeUndefined();

        await kernel.shutdown();
    });

    it('fails boot by name on an unparseable retryConfig rather than materializing an inert policy', async () => {
        const { factory } = makeFakeProvider();
        // `maxAttempts` is bounded max(10) on the schema.
        await expect(
            boot([{ ...providerConnector('billing'), retryConfig: { maxAttempts: 99 } }], {
                providerFactory: factory,
            }),
        ).rejects.toThrow(/retryConfig is not a valid connector retry policy/);
    });

    it('an edit to the policy re-materializes the instance', async () => {
        // The policy is baked into the transport the bundle closes over, so it
        // is a materialization input: without it in the signature the old
        // policy keeps serving until the process restarts.
        const { factory, calls } = makeClosableProvider();
        const { kernel, reload } = await bootReloadable(
            [{ ...providerConnector('billing'), retryConfig: { maxAttempts: 2 } }],
            { providerFactory: factory },
        );
        expect(calls).toHaveLength(1);

        await reload([{ ...providerConnector('billing'), retryConfig: { maxAttempts: 4 } }]);
        expect(calls).toHaveLength(2);
        expect(calls[1]?.retryConfig?.maxAttempts).toBe(4);

        // An unchanged policy is NOT a change — the control for the assertion above.
        await reload([{ ...providerConnector('billing'), retryConfig: { maxAttempts: 4 } }]);
        expect(calls).toHaveLength(2);

        await kernel.shutdown();
    });
});

// ADR-0143 D2.2, D4 — a grant-bearing instance is served only through the
// per-dispatch credential handle, by a provider registered as asking it on
// every request. Anything this server cannot serve yet is held degraded with a
// named reason and its factory is never invoked — never materialized without
// its credential, never called upstream unauthenticated. A boot does not fail
// on it: it is not an authoring fault.
describe('ADR-0143 D4 — a grant-bearing instance is served through its credential handle, or held degraded', () => {
    const CLIENT_CREDENTIALS: ConnectorInstanceAuth = {
        type: 'oauth2', grant: 'client_credentials', tokenUrl: 'https://idp.example.com/token', clientId: 'c', credentialRef: 'SECRET',
    };
    const AUTHORIZATION_CODE: ConnectorInstanceAuth = {
        type: 'oauth2',
        grant: 'authorization_code',
        authorizationUrl: 'https://idp.example.com/authorize',
        tokenUrl: 'https://idp.example.com/token',
        clientId: 'c',
        credentialRef: 'SECRET',
    };

    function expectHeld(engine: AutomationEngine, calls: unknown[], ...reason: string[]) {
        expect(calls).toHaveLength(0);
        const desc = engine.getConnectorDescriptors().find((d) => d.name === 'vendor');
        expect(desc?.state).toBe('degraded');
        expect(desc?.actions).toEqual([]);
        for (const r of reason) expect(engine.getConnectorDegradedReason('vendor')).toContain(r);
        expect(engine.resolveConnectorAction('vendor', 'ping')).toBeUndefined();
    }

    it('serves an `app-credential` instance through its credential handle on an opted-in provider, with no static auth (ADR-0143 D2.2)', async () => {
        const { factory, calls } = makeFakeProvider();
        const kernel = await boot(
            [providerConnector('vendor', { auth: { type: 'app-credential', vendor: 'feishu', appId: 'cli_x', credentialRef: 'SECRET' } })],
            { providerFactory: factory, providerOptions: { credentialHandle: true }, credentialResolver: () => 'resolved-secret' },
        );
        const engine = automationOf(kernel);
        expect(calls).toHaveLength(1);
        expect(calls[0].auth).toBeUndefined();
        expect(calls[0].credentialHandle).toMatchObject({ connector: 'vendor' });
        expect(engine.getConnectorDegradedReason('vendor')).toBeUndefined();
        // ⛔ The app secret never reaches the provider: only the handle does.
        expect(JSON.stringify(calls[0])).not.toContain('resolved-secret');
        await kernel.shutdown();
    });

    it('⛔ holds an `app-credential` instance degraded on a provider that does not ask the credential handle', async () => {
        const { factory, calls } = makeFakeProvider();
        const kernel = await boot(
            [providerConnector('vendor', { auth: { type: 'app-credential', vendor: 'wecom', appId: 'ww_x', credentialRef: 'SECRET' } })],
            { providerFactory: factory, credentialResolver: () => 'resolved-secret' },
        );
        expectHeld(automationOf(kernel), calls, "auth type 'app-credential', but provider 'fake' does not yet ask the per-dispatch credential handle", 'never called without its credential');
        await kernel.shutdown();
    });

    it('holds an `app-credential` instance whose app secret does not resolve, naming the reference', async () => {
        const { factory, calls } = makeFakeProvider();
        const kernel = await boot(
            [providerConnector('vendor', { auth: { type: 'app-credential', vendor: 'dingtalk', appId: 'ding_x', credentialRef: 'DING_SECRET' } })],
            { providerFactory: factory, providerOptions: { credentialHandle: true }, credentialResolver: () => undefined },
        );
        expect(calls).toHaveLength(0);
        expect(automationOf(kernel).getConnectorDegradedReason('vendor')).toContain('DING_SECRET');
        await kernel.shutdown();
    });

    it('holds an `oauth2` instance degraded on a provider that does not ask the credential handle', async () => {
        const { factory, calls } = makeFakeProvider();
        const kernel = await boot([providerConnector('vendor', { auth: CLIENT_CREDENTIALS })], {
            providerFactory: factory,
            credentialResolver: () => 'resolved-secret',
        });
        expectHeld(automationOf(kernel), calls, "provider 'fake' does not yet ask the per-dispatch credential handle", 'never called without its credential');
        await kernel.shutdown();
    });

    it('holds an `oauth2` instance degraded when it declares no endpoints or client to send a token request with', async () => {
        const { factory, calls } = makeFakeProvider();
        const kernel = await boot(
            [providerConnector('vendor', { auth: { type: 'oauth2', grant: 'authorization_code', credentialRef: 'SECRET' } })],
            { providerFactory: factory, providerOptions: { credentialHandle: true }, credentialResolver: () => 'resolved-secret' },
        );
        expectHeld(automationOf(kernel), calls, '`tokenUrl`, `clientId`, `authorizationUrl`', 'not served');
        await kernel.shutdown();
    });

    it.each([
        ['tokenUrl', { tokenUrl: 'http://idp.example.com/token' }],
        ['authorizationUrl', { authorizationUrl: 'http://idp.example.com/authorize' }],
        ['tokenUrl', { tokenUrl: 'ftp://idp.example.com/token' }],
    ] as const)('⛔ holds an `oauth2` instance degraded when its `%s` is not https off loopback, naming the field', async (field, over) => {
        const { factory, calls } = makeFakeProvider();
        const kernel = await boot([providerConnector('vendor', { auth: { ...AUTHORIZATION_CODE, ...over } as ConnectorInstanceAuth })], {
            providerFactory: factory,
            providerOptions: { credentialHandle: true },
            credentialResolver: () => 'resolved-secret',
        });
        expectHeld(automationOf(kernel), calls, `\`${field}\` not over https`, 'not served');
        // The reason names the field, never the URL it was given.
        expect(automationOf(kernel).getConnectorDegradedReason('vendor')).not.toContain('idp.example.com');
        await kernel.shutdown();
    });

    it('serves an `oauth2` instance whose token endpoint is plain http on a loopback host', async () => {
        const { factory, calls } = makeFakeProvider();
        const kernel = await boot([providerConnector('vendor', { auth: { ...CLIENT_CREDENTIALS, tokenUrl: 'http://127.0.0.1:8080/token' } as ConnectorInstanceAuth })], {
            providerFactory: factory,
            providerOptions: { credentialHandle: true },
            credentialResolver: () => 'resolved-secret',
        });
        expect(calls).toHaveLength(1);
        expect(automationOf(kernel).getConnectorDescriptors().find((d) => d.name === 'vendor')?.state).toBe('ready');
        await kernel.shutdown();
    });

    it('serves a `client_credentials` instance on an opted-in provider: a credential handle, and no static auth', async () => {
        const { factory, calls } = makeFakeProvider();
        const kernel = await boot([providerConnector('vendor', { auth: CLIENT_CREDENTIALS })], {
            providerFactory: factory,
            providerOptions: { credentialHandle: true },
            credentialResolver: () => 'resolved-secret',
        });
        expect(calls).toHaveLength(1);
        expect(calls[0].auth).toBeUndefined();
        expect(calls[0].credentialHandle).toMatchObject({ connector: 'vendor' });
        expect(typeof calls[0].credentialHandle?.get).toBe('function');
        expect(automationOf(kernel).getConnectorDescriptors().find((d) => d.name === 'vendor')?.state).toBe('ready');
        await kernel.shutdown();
    });

    it("holds an `authorization_code` instance nobody connected degraded \"not connected\" — the boot does not fail", async () => {
        const { factory, calls } = makeFakeProvider();
        const kernel = await boot([providerConnector('vendor', { auth: AUTHORIZATION_CODE })], {
            providerFactory: factory,
            providerOptions: { credentialHandle: true },
            credentialResolver: () => 'resolved-secret',
        });
        expectHeld(automationOf(kernel), calls, "connector instance 'vendor' is not connected", '/connectors/vendor/connection');
        await kernel.shutdown();
    });

    it('CONTROL: the four static kinds still materialize, each handed its resolved credential', async () => {
        const { factory, calls } = makeFakeProvider();
        const kernel = await boot(
            [
                providerConnector('k_none', { auth: { type: 'none' } }),
                providerConnector('k_bearer', { auth: { type: 'bearer', credentialRef: 'TOKEN' } }),
                providerConnector('k_key', { auth: { type: 'api-key', credentialRef: 'TOKEN' } }),
                providerConnector('k_basic', { auth: { type: 'basic', username: 'u', credentialRef: 'TOKEN' } }),
            ],
            { providerFactory: factory, credentialResolver: () => 'resolved-secret' },
        );
        expect(Object.fromEntries(calls.map((c) => [c.name, c.auth?.type]))).toEqual({
            k_none: 'none', k_bearer: 'bearer', k_key: 'api-key', k_basic: 'basic',
        });
        expect(automationOf(kernel).getConnectorDescriptors().filter((d) => d.state === 'degraded')).toEqual([]);
        await kernel.shutdown();
    });
});

// ADR-0143 D2.3, D4 — a `signed` instance's key is bound to the signer its
// scheme names by the host, and the provider receives only the signer. It is
// served only by a provider that says it applies the signer to every request;
// any other is a configuration fault, so the instance is never called unsigned.
describe('ADR-0143 D2.3 — a `signed` instance is handed a request signer, never its key', () => {
    const SIGNING_KEY = 'resolved-signing-key';
    const signed: ConnectorInstanceAuth = {
        type: 'signed',
        scheme: 'aliyun-acs3-hmac-sha256',
        keyId: 'YourAccessKeyId',
        credentialRef: 'ALIYUN_SECRET',
    };

    /** A provider that applies the signer it is handed (and says so), recording each ctx. */
    function makeSigningProvider(applied: boolean | undefined) {
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
                } as unknown as Connector,
                handlers: { ping: async () => ({ ok: true }) },
                close: async () => { closed.push(ctx.name); },
                ...(applied === undefined ? {} : { requestSignerApplied: applied }),
            };
        };
        return { factory, calls, closed };
    }

    it('materializes it with `requestSigner` bound to the resolved key, `auth` unset, and no key in the context', async () => {
        const { factory, calls } = makeSigningProvider(true);
        const kernel = await boot([providerConnector('aliyun_ecs', { auth: signed })], {
            providerFactory: factory,
            credentialResolver: (ref) => (ref === 'ALIYUN_SECRET' ? SIGNING_KEY : undefined),
        });
        expect(calls).toHaveLength(1);
        const ctx = calls[0]!;
        expect(ctx.auth).toBeUndefined();
        expect([ctx.requestSigner?.connector, ctx.requestSigner?.scheme]).toEqual(['aliyun_ecs', 'aliyun-acs3-hmac-sha256']);
        expect(JSON.stringify(ctx)).not.toContain(SIGNING_KEY);

        // The signer signs with the key the reference resolved to: recompute
        // its signature from the instant and nonce it chose.
        const request = { method: 'GET', url: 'https://ecs.cn-shanghai.aliyuncs.com/?RegionId=cn-shanghai', headers: {} };
        const signature = await ctx.requestSigner!.sign(request);
        const expected = computeAliyunAcs3Signature(request, 'YourAccessKeyId', SIGNING_KEY, {
            date: signature.headers['x-acs-date']!,
            nonce: signature.headers['x-acs-signature-nonce']!,
        });
        expect(signature.headers.authorization).toBe(expected.headers.authorization);

        const engine = automationOf(kernel);
        expect(engine.getConnectorDescriptors().find((d) => d.name === 'aliyun_ecs')?.state).not.toBe('degraded');
        expect(engine.resolveConnectorAction('aliyun_ecs', 'ping')).toBeDefined();
        await kernel.shutdown();
    });

    it.each([
        ['does not say it applies the signer', undefined],
        ['says it does not apply the signer', false],
    ] as const)('fails boot when the provider %s, and lets its connection go', async (_why, applied) => {
        const { factory, closed } = makeSigningProvider(applied);
        await expect(boot([providerConnector('aliyun_ecs', { auth: signed })], {
            providerFactory: factory,
            credentialResolver: () => SIGNING_KEY,
        })).rejects.toThrow(/auth type 'signed'.*did not say it signs every request.*unsigned/s);
        expect(closed).toEqual(['aliyun_ecs']);
    });

    it('degrades the instance naming the reference when the signing key does not resolve, without calling its factory', async () => {
        const { factory, calls } = makeSigningProvider(true);
        const kernel = await boot([providerConnector('aliyun_ecs', { auth: signed })], {
            providerFactory: factory,
            credentialResolver: () => undefined,
        });
        expect(calls).toHaveLength(0);
        const engine = automationOf(kernel);
        expect(engine.getConnectorDescriptors().find((d) => d.name === 'aliyun_ecs')?.state).toBe('degraded');
        expect(engine.getConnectorDegradedReason('aliyun_ecs')).toContain('ALIYUN_SECRET');
        await kernel.shutdown();
    });

    // `alipay-v3` names the Alipay public key beside the private key; it
    // resolves through the same chain, and a response is never accepted
    // unverified for want of it.
    describe('alipay-v3: the vendor public key is a second reference', () => {
        const vectors = new URL('../test-vectors/alipay-v3/', import.meta.url);
        const PRIVATE_KEY = readFileSync(new URL('PLACEHOLDER-test-only-rsa2048-private-key.pkcs8.b64', vectors), 'ascii').trim();
        const PUBLIC_KEY = readFileSync(new URL('PLACEHOLDER-test-only-rsa2048-public-key.spki.b64', vectors), 'ascii').trim();
        const alipay: ConnectorInstanceAuth = {
            type: 'signed',
            scheme: 'alipay-v3',
            keyId: '2021000000000000',
            credentialRef: 'ALIPAY_APP_PRIVATE_KEY',
            vendorPublicKeyRef: 'ALIPAY_PUBLIC_KEY',
        };
        const both = (ref: string) => ({ ALIPAY_APP_PRIVATE_KEY: PRIVATE_KEY, ALIPAY_PUBLIC_KEY: PUBLIC_KEY } as Record<string, string>)[ref];

        it('binds a signer that signs with the private key and verifies with the public key; neither key is in the context', async () => {
            const { factory, calls } = makeSigningProvider(true);
            const kernel = await boot([providerConnector('alipay_pay', { auth: alipay })], { providerFactory: factory, credentialResolver: both });
            const ctx = calls[0]!;
            expect([ctx.requestSigner?.scheme, typeof ctx.requestSigner?.verifyResponse]).toEqual(['alipay-v3', 'function']);
            expect(JSON.stringify(ctx)).not.toContain(PRIVATE_KEY.slice(40, 120));

            const request = { method: 'POST', url: 'https://openapi.alipay.com/v3/alipay/trade/query', headers: {}, body: '{}' };
            const { authorization } = (await ctx.requestSigner!.sign(request)).headers;
            const [, nonce, timestamp] = /nonce=([^,]+),timestamp=(\d+),/.exec(authorization!)!;
            expect(authorization).toBe(
                computeAlipayV3Signature(request, '2021000000000000', readAlipayPrivateKey(PRIVATE_KEY), nonce!, Number(timestamp)).headers.authorization,
            );
            // An unsigned 2xx is refused: the public key is in force.
            await expect(ctx.requestSigner!.verifyResponse!({ status: 200, headers: { get: () => null }, body: '{}' })).rejects.toThrow(/no complete Alipay signature/);
            await kernel.shutdown();
        });

        it('degrades the instance naming the public-key reference when only it does not resolve, without calling its factory', async () => {
            const { factory, calls } = makeSigningProvider(true);
            const kernel = await boot([providerConnector('alipay_pay', { auth: alipay })], {
                providerFactory: factory,
                credentialResolver: (ref) => (ref === 'ALIPAY_APP_PRIVATE_KEY' ? PRIVATE_KEY : undefined),
            });
            expect(calls).toHaveLength(0);
            const engine = automationOf(kernel);
            expect(engine.getConnectorDegradedReason('alipay_pay')).toContain('ALIPAY_PUBLIC_KEY');
            await kernel.shutdown();
        });

        it('fails boot when the public key is not a key: a configuration fault, its value not echoed', async () => {
            const { factory } = makeSigningProvider(true);
            const boot26710 = boot([providerConnector('alipay_pay', { auth: alipay })], {
                providerFactory: factory,
                credentialResolver: (ref) => (ref === 'ALIPAY_PUBLIC_KEY' ? 'not-a-public-key-26710' : both(ref)),
            });
            await expect(boot26710).rejects.toThrow(/a key it names cannot sign or verify/);
            await expect(boot26710).rejects.not.toThrow(/not-a-public-key-26710/);
        });
    });

    it('CONTROL: a static kind is handed its credential and no signer', async () => {
        const { factory, calls } = makeFakeProvider();
        const kernel = await boot([providerConnector('k_bearer', { auth: { type: 'bearer', credentialRef: 'TOKEN' } })], {
            providerFactory: factory,
            credentialResolver: () => 'resolved-secret',
        });
        expect(calls[0]!.auth).toEqual({ type: 'bearer', token: 'resolved-secret' });
        expect(calls[0]!.requestSigner).toBeUndefined();
        await kernel.shutdown();
    });
});
