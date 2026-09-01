// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13904] The SHIPPED `objectQLProvider` no longer collapses three
 * distinguishable registry facts into one `undefined`.
 *
 * ## The defect this file exists to refuse
 *
 * `rest-api-plugin.ts` used to hand `RestServer` an engine provider shaped
 * `try { return ctx.getService('objectql'); } catch { return undefined; }`.
 * `ctx.getService` throws for THREE distinguishable conditions — never
 * registered (the supported no-data-plane embedder), registered as a factory
 * (wrong accessor for it), and a registration that failed to build — and the
 * catch-all answered all three with the `undefined` that the seam contract
 * (correctly) reads as "no engine is wired". So #13476's transport repair
 * (`wiredEngineOrLoud`, which turns a provider REJECTION into the loud
 * outage) could never fire on the shipped single-kernel wiring: the provider
 * absorbed one layer before the transport could see the fact.
 *
 * ## What the repair is, and what this file drives
 *
 * The provider now resolves through `kernel.getServiceAsync` →
 * `PluginLoader.getService` and absorbs ONLY the branded "never registered"
 * rejection (`isServiceNotRegisteredError`, #13905). That classification is
 * the REGISTRY's own, not message text, and its set is closed with a LOUD
 * default: everything unbranded re-raises.
 *
 * ⛔ No condition here is simulated by throwing a hand-made error into a
 * stub. Every scenario REGISTERS (or withholds) the service on a real kernel
 * — `ObjectKernel` with its real `PluginLoader`, and `LiteKernel` for the
 * KernelBase-shaped host — boots the REAL `createRestApiPlugin()` on it, and
 * drives the provider instance the plugin actually handed to `RestServer`
 * (captured at the constructor, the slot-lookups technique). A test that only
 * proved "a failure now surfaces" could not tell this three-way split from a
 * binary one; the three conditions are therefore asserted SIDE BY SIDE, each
 * with a distinct answer:
 *
 *   | registry fact (driven for real)        | provider answer            |
 *   |:---------------------------------------|:---------------------------|
 *   | nothing registered under `objectql`    | resolves `undefined` ⭐ PIN |
 *   | instance registered (shipped wiring)   | resolves THAT instance     |
 *   | factory registered, constructs         | resolves the built engine  |
 *   | factory registered, THROWS             | REJECTS with that error    |
 *
 * ⭐ The first row is the POSITIVE CONTROL for the whole change: an embedder
 * that never wired a data plane keeps the quiet answer, byte-for-byte — that
 * is the supported shape #13476 refused to break, pinned so this repair (and
 * any future "simplification" to a binary) cannot break it either.
 *
 * ## The door-level half
 *
 * Section 2 chains the same real providers into the transport seam #13910
 * pinned with hand-made providers, and reads the WIRE answer at the package
 * door: 403 FORBIDDEN (unwired, unchanged) / 200 (factory-built engine
 * granting the capabilities) / 503 SERVICE_UNAVAILABLE (engine wired and
 * broken). Three registry facts, three wire answers — the collapse is gone
 * end to end, not just at the provider boundary.
 */

import { describe, it, expect, vi } from 'vitest';
import {
    ObjectKernel,
    LiteKernel,
    ServiceLifecycle,
    isServiceNotRegisteredError,
    AUTHZ_STORE_UNAVAILABLE_CODE,
    AUTHZ_STORE_UNAVAILABLE_STATUS,
} from '@objectstack/core';
import type { PluginContext } from '@objectstack/core';
import type { RouteHandler } from '@objectstack/spec/contracts';
import { registerPackageRoutes } from './package-routes.js';

const captured = vi.hoisted(() => ({ ctorArgs: [] as unknown[][] }));

// Capture RestServer's constructor arguments without registering ~hundreds of
// routes — the same double `rest-api-plugin-slot-lookups.test.ts` uses: the
// subclass EXTENDS the real class, so every method the composition root and
// the door harness call stays the production one, and only `registerRoutes`
// is suppressed.
vi.mock('./rest-server.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./rest-server.js')>();
    return {
        ...actual,
        RestServer: class extends actual.RestServer {
            constructor(...args: unknown[]) {
                super(...(args as ConstructorParameters<typeof actual.RestServer>));
                captured.ctorArgs.push(args);
            }
            override registerRoutes(): void {
                /* routes are not under test here */
            }
        },
    };
});

const { createRestApiPlugin } = await import('./rest-api-plugin.js');
const { RestServer } = await import('./rest-server.js');

/** `objectQLProvider`'s position in the `RestServer` constructor (B4 map). */
const OBJECTQL_SLOT_INDEX = 7;

type EngineProvider = (environmentId?: string) => Promise<unknown>;

function mockHttpServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
        use: vi.fn(),
        listen: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
    };
}

function makeObjectKernel(): ObjectKernel {
    return new ObjectKernel({
        logger: { level: 'error' },
        gracefulShutdown: false,
        skipSystemValidation: true,
    });
}

/**
 * Boot the REAL rest plugin on a real kernel and hand back the REAL
 * `objectQLProvider` it wired — the closure under test, never a re-creation
 * of it. `wire` runs in a host plugin's init BEFORE the rest plugin starts,
 * which is where a real composition registers its services.
 */
async function bootRealPluginOn(
    kernel: { use(p: unknown): unknown; bootstrap(): Promise<void> },
    wire?: (ctx: PluginContext) => void,
): Promise<EngineProvider> {
    captured.ctorArgs.length = 0;
    await kernel.use({
        name: 'test.host.wiring',
        version: '1.0.0',
        init: async (ctx: PluginContext) => {
            ctx.registerService('http.server', mockHttpServer());
            ctx.registerService('protocol', {});
            wire?.(ctx);
        },
    });
    await kernel.use(createRestApiPlugin());
    await kernel.bootstrap();
    expect(captured.ctorArgs, 'the plugin must construct exactly one RestServer').toHaveLength(1);
    const provider = captured.ctorArgs[0]![OBJECTQL_SLOT_INDEX] as EngineProvider;
    expect(typeof provider).toBe('function');
    return provider;
}

// ---------------------------------------------------------------------------
// Section 1 — the provider's own answers, one real registry fact at a time.
// ---------------------------------------------------------------------------

describe('[#13904] the shipped objectQLProvider, driven against a real ObjectKernel', () => {
    it('⭐ PIN: a kernel where NOTHING registered objectql resolves undefined — the supported shape, quiet', async () => {
        // The composition the plugin itself declares supported:
        // `optionalDependencies: ['com.objectstack.engine.objectql']`, nothing
        // registers the engine. This is the POSITIVE CONTROL: the repair (and
        // any later "simplification") must leave this row untouched.
        const kernel = makeObjectKernel();
        const provider = await bootRealPluginOn(kernel);

        await expect(provider()).resolves.toBeUndefined();
        // …and quiet twice, because the door asks per request, not per boot.
        await expect(provider('env_1')).resolves.toBeUndefined();

        await kernel.shutdown();
    });

    it('an INSTANCE-registered engine (the shipped `pnpm dev:crm` wiring) resolves as that same instance', async () => {
        // `ObjectQLPlugin.init` registers the engine as a plain instance:
        // `ctx.registerService('objectql', this.ql)`. The provider moved from
        // the sync accessor to the async one — this row proves the move loses
        // no instance registration (every registration path writes both maps).
        const engine = { find: async () => [] };
        const kernel = makeObjectKernel();
        const provider = await bootRealPluginOn(kernel, (ctx) => {
            ctx.registerService('objectql', engine);
        });

        await expect(provider()).resolves.toBe(engine);

        await kernel.shutdown();
    });

    it('a FACTORY-registered engine now RESOLVES — the "is async - use await" condition dissolves instead of reading as "no engine"', async () => {
        // Under the superseded shape the sync accessor could only throw
        // `Service 'objectql' is async - use await` for this registration, and
        // the catch-all read that as "no engine is wired" — an engine that was
        // wired AND constructible, answered as absent. The async accessor
        // constructs it.
        const engine = { find: async () => [] };
        const kernel = makeObjectKernel();
        kernel.registerServiceFactory('objectql', () => engine, ServiceLifecycle.SINGLETON);
        const provider = await bootRealPluginOn(kernel);

        await expect(provider()).resolves.toBe(engine);

        await kernel.shutdown();
    });

    it('a registration that FAILS TO BUILD rejects with the factory\'s own error — loud, and NOT branded', async () => {
        // The multi-tenant host from the family's filings: the engine IS wired
        // and broke. The rejection is produced by the real loader running the
        // real factory — not thrown into a stub by hand.
        const kernel = makeObjectKernel();
        kernel.registerServiceFactory(
            'objectql',
            () => { throw new Error('driver handshake failed'); },
            ServiceLifecycle.SINGLETON,
        );
        const provider = await bootRealPluginOn(kernel);

        await expect(provider()).rejects.toThrow('driver handshake failed');
        // The re-raise discipline: only the branded "never registered"
        // rejection is absorbed; this one must not carry the brand, or the
        // closed set has leaked.
        const err = await provider().then(
            () => { throw new Error('provider unexpectedly fulfilled'); },
            (e: unknown) => e,
        );
        expect(isServiceNotRegisteredError(err)).toBe(false);

        await kernel.shutdown();
    });

    it('a KernelBase-shaped host (LiteKernel, no async accessor) keeps both of its answers', async () => {
        // LiteKernel has no `getServiceAsync` and cannot hold factories at all
        // (`registerServiceFactory` throws '[KernelBase] … not supported'), so
        // its accessor has exactly ONE fault to report — never registered —
        // and the provider's sync leg absorbs exactly that.
        const bare = new LiteKernel({ logger: { level: 'error' } });
        const bareProvider = await bootRealPluginOn(bare);
        await expect(bareProvider()).resolves.toBeUndefined();
        await bare.shutdown();

        const engine = { find: async () => [] };
        const wired = new LiteKernel({ logger: { level: 'error' } });
        const wiredProvider = await bootRealPluginOn(wired, (ctx) => {
            ctx.registerService('objectql', engine);
        });
        await expect(wiredProvider()).resolves.toBe(engine);
        await wired.shutdown();
    });
});

// ---------------------------------------------------------------------------
// Section 2 — the WIRE consequence: the same real providers, chained into the
// transport seam #13910 pinned, read at the package door.
// ---------------------------------------------------------------------------

/** A better-auth-shaped service that resolves a real session. */
const AUTH_OK = async () => ({ api: { getSession: async () => ({ user: { id: 'u_admin' } }) } });

/**
 * An engine that actually grants the package capabilities through the SHIPPED
 * aggregation (`sys_user_permission_set` → `sys_permission_set` →
 * `system_permissions`) — the healthy fixture
 * `package-door-execctx-fault-reachability.test.ts` established.
 */
const engineGranting = () => ({
    find: async (object: string) => {
        if (object === 'sys_user_permission_set') return [{ permission_set_id: 'ps_pkg' }];
        if (object === 'sys_permission_set') {
            return [{ id: 'ps_pkg', name: 'pkg_admin', system_permissions: ['manage_metadata', 'studio.access'] }];
        }
        return [];
    },
});

/** A `RestServer` wired at its constructor seams — nothing private replaced. */
function serverWith(objectQLProvider: EngineProvider | undefined): InstanceType<typeof RestServer> {
    return new RestServer(
        { get: () => {}, post: () => {}, put: () => {}, delete: () => {}, patch: () => {}, use: () => {} } as never,
        {} as never,
        {} as never,
        undefined, // kernelManager — absent, so the PROVIDER branch of the engine seam runs
        undefined,
        undefined,
        AUTH_OK,
        objectQLProvider,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        undefined,
        undefined,
        undefined,
        undefined,
    );
}

/** Mount the package routes as `rest-api-plugin.ts` mounts them. */
function mountDoor(rest: InstanceType<typeof RestServer>): Map<string, RouteHandler> {
    const routes = new Map<string, RouteHandler>();
    const server = {
        get: (p: string, h: RouteHandler) => { routes.set(`GET:${p}`, h); },
        post: (p: string, h: RouteHandler) => { routes.set(`POST:${p}`, h); },
        put: (p: string, h: RouteHandler) => { routes.set(`PUT:${p}`, h); },
        delete: (p: string, h: RouteHandler) => { routes.set(`DELETE:${p}`, h); },
        patch: () => {}, use: () => {}, listen: async () => {}, close: async () => {},
    } as never;
    registerPackageRoutes(
        server,
        () => ({ list: async () => [], publish: async () => ({}), delete: async () => ({}) }) as never,
        '/api/v1',
        { resolveExecutionContext: (req: unknown) => rest.resolvePackageRouteExecutionContext(req) } as never,
    );
    return routes;
}

async function driveDoor(routes: Map<string, RouteHandler>): Promise<{ status: number; body: any }> {
    const handler = routes.get('GET:/api/v1/packages');
    if (!handler) throw new Error('no handler for GET /api/v1/packages');
    const capturedRes: { status: number; body: any } = { status: 0, body: undefined };
    const res: any = {
        json(data: unknown) { capturedRes.body = data; },
        send() {},
        status(code: number) { capturedRes.status = code; return res; },
        header() { return res; },
    };
    await handler({ params: {}, query: {}, body: undefined, headers: {}, method: 'GET', path: '/api/v1/packages' } as never, res);
    return capturedRes;
}

describe('[#13904] three registry facts, three WIRE answers at the package door', () => {
    it('⭐ PIN: no engine registered → 403 FORBIDDEN, unchanged — the quiet embedder answer survives the repair', async () => {
        const kernel = makeObjectKernel();
        const provider = await bootRealPluginOn(kernel);

        const answer = await driveDoor(mountDoor(serverWith(provider)));
        expect(answer.status).toBe(403);
        expect(answer.body?.error?.code).toBe('FORBIDDEN');

        await kernel.shutdown();
    });

    it('a factory-built engine that grants the capabilities → 200 — previously this wiring was refused as "no engine"', async () => {
        const kernel = makeObjectKernel();
        kernel.registerServiceFactory('objectql', engineGranting, ServiceLifecycle.SINGLETON);
        const provider = await bootRealPluginOn(kernel);

        const answer = await driveDoor(mountDoor(serverWith(provider)));
        expect(answer.status).toBe(200);

        await kernel.shutdown();
    });

    it('an engine wired and BROKEN → 503 SERVICE_UNAVAILABLE — the outage reaches the seam instead of degrading to 403', async () => {
        const kernel = makeObjectKernel();
        kernel.registerServiceFactory(
            'objectql',
            () => { throw new Error('driver handshake failed'); },
            ServiceLifecycle.SINGLETON,
        );
        const provider = await bootRealPluginOn(kernel);

        const answer = await driveDoor(mountDoor(serverWith(provider)));
        // ADR-0112 envelope discipline: code AND status, never a bare throw.
        expect(answer.status).toBe(AUTHZ_STORE_UNAVAILABLE_STATUS);
        expect(answer.body?.error?.code).toBe(AUTHZ_STORE_UNAVAILABLE_CODE);

        await kernel.shutdown();
    });
});
