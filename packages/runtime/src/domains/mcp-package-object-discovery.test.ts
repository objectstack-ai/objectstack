// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25120] The `/mcp` bridge sees the objects a PACKAGE contributes: listed,
 * described, and refused by every data verb when the package declares their
 * API exposure off — on every kernel shape, the `environmentId` kernel
 * included.
 *
 * ## The defect
 *
 * `buildMcpBridge` answered `list_objects` / `describe_object` from the
 * `metadata` service (`listObjects()` / `getObject()`), and the data verbs'
 * exposure gate (`refuseUnexposedDataAction`) read the same service. That
 * service holds a copy of an object only where something put one there. On a
 * kernel with an `environmentId` — `createStandaloneStack`'s composition
 * (`os dev` as `env_local`, `os serve`, `os start`) and the cloud
 * single-environment runtime — the full boot bridge is off, so an object a
 * package or a plugin registers in the `SchemaRegistry` during the boot gets
 * no copy. `GET /api/v1/meta/object` reads the registry through the protocol's
 * merged read and lists it; the data door serves it. Measured on this file's
 * rig at the base tree (`4e2c42f363`), a package of two objects (one declared
 * `apiEnabled: false`):
 *
 * | shape · when the package registered | `metadata.getObject` | REST lists | bridge lists | describe | gated `query` | gated `create` |
 * | :-- | :-- | :-- | :-- | :-- | :-- | :-- |
 * | `env_local` · during the boot | absent | 2 | **0** | **null** | **served** | **reached the driver** |
 * | `env_local` · installed after the boot | copied | 2 | 2 | served | refused 404 | refused 404 |
 * | no `environmentId` · during the boot | copied | 2 | 2 | served | refused 404 | refused 404 |
 * | no `environmentId` · installed after the boot | copied | 2 | 2 | served | refused 404 | refused 404 |
 *
 * The first row is the card's live reading (`list_objects` answering only the
 * environment-authored objects as a complete `totalCount`, `describe_object`
 * "not found" for every package object, `query_records` served). The other
 * three are the CONTROLS: the boot bridge (no `environmentId`) and the
 * late-manifest bridge (a marketplace install, on any shape) copy the package's
 * objects, so they were already right and must stay right.
 *
 * The same split showed the other way round for a DISABLED package on the
 * shape that copies: the copy outlives the disable, so the bridge listed and
 * described both objects while `GET /meta/object` listed neither.
 *
 * ## The fix, and where these pins sit
 *
 * The bridge reads the protocol's MERGED listing (`getMetaItems`), the read
 * REST serves, and the gate reads the protocol's by-name object read, the read
 * `RestServer`'s own exposure gate makes. ⛔ Not a copy of every package
 * object in the `metadata` service: a second copy is a second thing to keep in
 * sync. The pins read the bridge the dispatcher hands the MCP service, driven
 * through the real `/mcp` entry (`HttpDispatcher.handleMcp`): `list_objects`
 * renders `totalCount` as the count of the non-`sys_` objects in
 * `listObjectsDiagnosed().objects` (`packages/mcp`, unchanged), and each data
 * tool calls the bridge verb of its name.
 *
 * ## The rig
 *
 * Real kernels: `ObjectKernel` with `MetadataPlugin` and `ObjectQLPlugin` over
 * a better-sqlite3 `:memory:` `SqlDriver`, in the two shapes the
 * `mcp-stdio-runtime-object-exposure` dogfood suite pins (the `environmentId`
 * one with its options verbatim from `createStandaloneStack`). The package is
 * registered through the kernel's `manifest` service, either from a plugin's
 * `init()` (during the boot, the way capability plugins register their
 * objects) or after the boot with `{ source: 'marketplace' }` (the way
 * marketplace install registers a package). The one seam not real is the MCP
 * service, which records the bridge it is handed.
 *
 * The negative control (red with the fix ablated) is a one-time ablation,
 * cited in the PR, not a permanent case.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectKernel } from '@objectstack/core';
import { MetadataPlugin } from '@objectstack/metadata';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { HttpDispatcher } from '../http-dispatcher.js';

const CALLER = { userId: 'u_mcp', isSystem: false, positions: [], permissions: [], systemPermissions: [] };

/** A package of two objects, one of them declared off the API. */
function packageOf(prefix: string) {
    const open = `${prefix}_open`;
    const gated = `${prefix}_gated`;
    return {
        open,
        gated,
        artifact: () => ({
            id: `com.qa.${prefix}`,
            name: `${prefix} package`,
            version: '1.0.0',
            type: 'app',
            objects: [
                { name: open, label: 'Open', fields: { name: { name: 'name', type: 'text', label: 'Name' } } },
                {
                    name: gated,
                    label: 'Gated',
                    enable: { apiEnabled: false },
                    fields: { name: { name: 'name', type: 'text', label: 'Name' } },
                },
            ],
        }),
    };
}

interface Booted {
    kernel: ObjectKernel;
    engine: ObjectQL;
    root: string;
}

/**
 * One kernel in the shape under test, with `pkg` registered through the
 * `manifest` service `when` asked. `mcp` is the recording MCP service, given to
 * this kernel unless a host serves it.
 */
async function bootKernel(
    environmentId: string | undefined,
    when: 'boot' | 'install',
    pkg: ReturnType<typeof packageOf>,
    mcp?: unknown,
): Promise<Booted> {
    const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
    const root = mkdtempSync(join(tmpdir(), 'os-mcp-package-objects-'));
    const engine = new ObjectQL();
    engine.registerDriver(new SqlDriver({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
    }) as any, true);
    if (environmentId === undefined) {
        await kernel.use(new MetadataPlugin({ watch: false, rootDir: root }));
        await kernel.use(new ObjectQLPlugin({ ql: engine }));
    } else {
        const artifact = join(root, 'objectstack.json');
        writeFileSync(artifact, JSON.stringify({
            manifest: { id: 'com.qa.empty', name: 'empty', version: '0.0.0', type: 'app' },
            objects: [], views: [], apps: [], flows: [], requires: [],
        }));
        await kernel.use(new MetadataPlugin({
            watch: false, artifactWatch: false, environmentId,
            artifactSource: { mode: 'local-file', path: artifact }, rootDir: root,
        } as any));
        await kernel.use(new ObjectQLPlugin({ ql: engine, environmentId, hydrateMetadataFromDb: true }));
    }
    await kernel.use({
        name: 'qa.package-host',
        dependencies: ['com.objectstack.engine.objectql'],
        init: async (ctx: any) => {
            if (mcp) ctx.registerService('mcp', mcp);
            if (when === 'boot') ctx.getService('manifest').register(pkg.artifact());
        },
    } as any);
    await kernel.bootstrap();
    if (when === 'install') {
        await (kernel.getService('manifest') as any).register(pkg.artifact(), { source: 'marketplace' });
    }
    await engine.syncSchemas();
    return { kernel, engine, root };
}

async function shutdown(booted: Booted | undefined): Promise<void> {
    if (!booted) return;
    if (booted.kernel.getState() === 'running') await booted.kernel.shutdown();
    rmSync(booted.root, { recursive: true, force: true });
}

/** The MCP service: records the bridge the dispatcher hands it. */
function recordingMcp() {
    const mcp: any = {
        lastOpts: undefined,
        handleHttpRequest: async (_req: Request, opts: any) => {
            mcp.lastOpts = opts;
            return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
        },
    };
    return mcp;
}

function requestContext(environmentId?: string): any {
    return {
        request: new Request('http://localhost/api/v1/mcp', {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
            body: '{}',
        }),
        response: {},
        environmentId,
        executionContext: { ...CALLER },
    };
}

/** The bridge the real `/mcp` entry builds for `CALLER` and hands the MCP service. */
async function bridgeFor(dispatcher: HttpDispatcher, mcp: any, environmentId?: string): Promise<any> {
    const res = await dispatcher.handleMcp({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, requestContext(environmentId));
    expect(res.response?.status, 'precondition: the /mcp entry served the request').toBe(200);
    return mcp.lastOpts.bridge;
}

const nonSystem = (names: readonly string[]) => names.filter((n) => !/^sys_/i.test(n));

/** The object names `GET /meta/object` serves `CALLER`, `sys_` objects left out as `list_objects` leaves them out. */
async function restObjectNames(dispatcher: HttpDispatcher, environmentId?: string): Promise<string[]> {
    const res = await dispatcher.handleMetadata('/object', requestContext(environmentId), 'GET');
    expect(res.response?.status, 'precondition: GET /meta/object answered').toBe(200);
    const items = res.response?.body?.data?.items;
    expect(Array.isArray(items), 'precondition: GET /meta/object served a list').toBe(true);
    return nonSystem((items as any[]).map((o) => o?.name));
}

/** The six MCP data verbs, each as its tool calls the bridge. */
const DATA_VERBS: ReadonlyArray<readonly [string, (bridge: any, object: string) => Promise<unknown>]> = [
    ['query_records', (b, o) => b.query(o, {})],
    ['get_record', (b, o) => b.get(o, 'r_any')],
    ['aggregate_records', (b, o) => b.aggregate(o, { aggregations: [{ function: 'count', alias: 'n' }] })],
    ['create_record', (b, o) => b.create(o, { name: 'written' })],
    ['update_record', (b, o) => b.update(o, 'r_any', { name: 'written' })],
    ['delete_record', (b, o) => b.remove(o, 'r_any')],
];

/** Every protocol / engine call a data verb could reach the store through. */
function storeSpies(kernel: ObjectKernel, engine: ObjectQL) {
    const protocol: any = kernel.getService('protocol');
    return [
        ...(['findData', 'getData', 'createData', 'updateData', 'deleteData'] as const)
            .map((m) => vi.spyOn(protocol, m)),
        vi.spyOn(engine as any, 'aggregate'),
    ];
}

/** The ADR-0112 envelope a refusal carries, or `'SERVED'`. */
async function outcome(call: () => Promise<unknown>): Promise<{ code?: unknown; status?: unknown } | 'SERVED'> {
    try {
        await call();
        return 'SERVED';
    } catch (e: any) {
        return { code: e?.code, status: e?.status };
    }
}

const SHAPES = [
    { shape: 'environmentId env_local (createStandaloneStack)', environmentId: 'env_local' },
    { shape: 'no environmentId', environmentId: undefined },
] as const;
const REGISTRATIONS = [
    { label: 'registered during the boot', when: 'boot' },
    { label: 'installed after the boot, as marketplace install registers it', when: 'install' },
] as const;

for (const { shape, environmentId } of SHAPES) {
    for (const { label, when } of REGISTRATIONS) {
        describe(`[#25120] the /mcp bridge and a package's objects — ${shape}, ${label}`, () => {
            const pkg = packageOf('qa_pkg');
            const mcp = recordingMcp();
            let booted: Booted | undefined;
            let dispatcher: HttpDispatcher;

            beforeAll(async () => {
                booted = await bootKernel(environmentId, when, pkg, mcp);
                dispatcher = new HttpDispatcher(booted.kernel as any, undefined, { enforceProjectMembership: false });
            }, 60_000);
            afterAll(async () => {
                vi.restoreAllMocks();
                await shutdown(booted);
            }, 60_000);

            it('list_objects lists the package\'s objects, its count the non-sys_ count GET /meta/object serves the same caller', async () => {
                const bridge = await bridgeFor(dispatcher, mcp);
                const listing = await bridge.listObjectsDiagnosed();
                const listed: string[] = nonSystem(listing.objects.map((o: any) => o.name));
                const served = await restObjectNames(dispatcher);

                expect(served, 'precondition: REST lists both package objects').toEqual(expect.arrayContaining([pkg.open, pkg.gated]));
                expect(listed).toEqual(expect.arrayContaining([pkg.open, pkg.gated]));
                // `totalCount` is this count (`list_objects` renders the non-`sys_` objects it was handed).
                expect(listed.length).toBe(served.length);
                expect([...listed].sort()).toEqual([...served].sort());
                expect(listing.degraded, 'a complete read: totalCount is rendered, not partial').toBe(false);
            });

            it('describe_object answers each package object, its declared exposure included', async () => {
                const bridge = await bridgeFor(dispatcher, mcp);
                const open = await bridge.describeObject(pkg.open);
                const gated = await bridge.describeObject(pkg.gated);

                expect(open?.name).toBe(pkg.open);
                expect(open?.fields?.map((f: any) => f.name)).toContain('name');
                expect(gated?.name).toBe(pkg.gated);
                expect(gated?.enableFeatures?.apiEnabled).toBe(false);
                // The control: a name nothing serves is still "not found".
                expect(await bridge.describeObject('qa_pkg_nowhere')).toBeNull();
            });

            for (const [tool, call] of DATA_VERBS) {
                it(`${tool} refuses the object the package declared apiEnabled: false — 404 OBJECT_API_DISABLED, the store never asked`, async () => {
                    const bridge = await bridgeFor(dispatcher, mcp);
                    const spies = storeSpies(booted!.kernel, booted!.engine);
                    try {
                        expect(await outcome(() => call(bridge, pkg.gated))).toEqual({ code: 'OBJECT_API_DISABLED', status: 404 });
                        for (const spy of spies) expect(spy).not.toHaveBeenCalled();
                    } finally {
                        for (const spy of spies) spy.mockRestore();
                    }
                });
            }

            it('CONTROL: query_records serves the package\'s exposed object', async () => {
                const bridge = await bridgeFor(dispatcher, mcp);
                expect(await outcome(() => bridge.query(pkg.open, {}))).toBe('SERVED');
            });
        });
    }
}

describe('[#25120] a DISABLED package\'s objects: the bridge omits them as GET /meta/object does', () => {
    // No `environmentId`, so the boot bridge HAS copied both objects into the
    // `metadata` service: the copy outlives the disable, and the bridge used to
    // list and describe both while REST listed neither.
    const pkg = packageOf('qa_off');
    const mcp = recordingMcp();
    let booted: Booted | undefined;
    let dispatcher: HttpDispatcher;

    beforeAll(async () => {
        booted = await bootKernel(undefined, 'boot', pkg, mcp);
        expect((booted.engine as any).registry.disablePackage('com.qa.qa_off'), 'precondition: disabled').toBeTruthy();
        expect(
            await (booted.kernel.getService('metadata') as any).getObject(pkg.open),
            'precondition: the metadata service still holds its copy',
        ).toBeTruthy();
        dispatcher = new HttpDispatcher(booted.kernel as any, undefined, { enforceProjectMembership: false });
    }, 60_000);
    afterAll(async () => {
        await shutdown(booted);
    }, 60_000);

    it('neither listed nor described', async () => {
        const bridge = await bridgeFor(dispatcher, mcp);
        const listed = nonSystem((await bridge.listObjectsDiagnosed()).objects.map((o: any) => o.name));

        expect(await restObjectNames(dispatcher), 'precondition: REST omits them').not.toContain(pkg.open);
        expect(listed).not.toContain(pkg.open);
        expect(listed).not.toContain(pkg.gated);
        expect(await bridge.describeObject(pkg.open)).toBeNull();
    });
});

describe('[#25120] two environments behind one host: each bridge reads its own environment\'s merged view', () => {
    const pkgA = packageOf('qa_a');
    const pkgB = packageOf('qa_b');
    const mcp = recordingMcp();
    const envs = new Map<string, Booted>();
    let dispatcher: HttpDispatcher;

    beforeAll(async () => {
        envs.set('env_a', await bootKernel('env_a', 'boot', pkgA));
        envs.set('env_b', await bootKernel('env_b', 'boot', pkgB));
        // The shared host resolves each request's services on its environment's
        // kernel, the way the dispatcher's scoped lookup asks a multi-environment
        // host (`getServiceAsync(name, scopeId)`).
        const service = (name: string, scopeId?: string): unknown => {
            if (name === 'mcp') return mcp;
            const env = scopeId ? envs.get(scopeId) : undefined;
            if (!env) return undefined;
            try {
                return env.kernel.getService(name);
            } catch {
                return undefined;
            }
        };
        const host: any = {
            getService: (name: string) => service(name),
            getServiceAsync: async (name: string, scopeId?: string) => service(name, scopeId),
        };
        dispatcher = new HttpDispatcher(host, undefined, { enforceProjectMembership: false });
    }, 120_000);
    afterAll(async () => {
        for (const env of envs.values()) await shutdown(env);
    }, 60_000);

    for (const [envId, own, other] of [['env_a', pkgA, pkgB], ['env_b', pkgB, pkgA]] as const) {
        it(`${envId} lists and describes its own package's objects and none of the other environment's`, async () => {
            const bridge = await bridgeFor(dispatcher, mcp, envId);
            const listed = nonSystem((await bridge.listObjectsDiagnosed()).objects.map((o: any) => o.name));

            expect(listed).toEqual(expect.arrayContaining([own.open, own.gated]));
            expect(listed).not.toContain(other.open);
            expect(listed).not.toContain(other.gated);
            expect((await bridge.describeObject(own.open))?.name).toBe(own.open);
            expect(await bridge.describeObject(other.open)).toBeNull();
        });

        it(`${envId} refuses its own package's apiEnabled: false object and serves its exposed one`, async () => {
            const bridge = await bridgeFor(dispatcher, mcp, envId);
            expect(await outcome(() => bridge.query(own.gated, {}))).toEqual({ code: 'OBJECT_API_DISABLED', status: 404 });
            expect(await outcome(() => bridge.query(own.open, {}))).toBe('SERVED');
        });
    }
});
