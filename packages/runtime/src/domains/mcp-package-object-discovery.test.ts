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
 * A disabled package's object is refused by the data plane `404
 * OBJECT_PACKAGE_DISABLED` on every REST route, and on five of `callData`'s six
 * arms. The sixth, `aggregate`, asks the engine and never the protocol, and the
 * engine serves a disabled package's objects: `aggregate_records` served the
 * package's exposed object on every shape, and once the gate read the protocol
 * (which refuses the by-name read of such an object) its `apiEnabled: false`
 * object too, where the copy had refused it `OBJECT_API_DISABLED`. The gate
 * `callData` asks now refuses that object itself, with the protocol's own
 * error, so every verb answers what REST answers. The dispatcher's `/data`
 * door asks the same gate earlier too, before its request gate, as the twin of
 * REST's `enforceApiAccess`; there it reads that refusal as REST's gate does,
 * so a body that is not a record is answered by the request gate first, on
 * both doors.
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
 * service, which records the bridge it is handed. What the two `/data` doors
 * answer a disabled package's objects is read off a `RestServer` and the
 * runtime dispatcher, both served over the same kernel's protocol.
 *
 * The negative control (red with the fix ablated) is a one-time ablation,
 * cited in the PR, not a permanent case.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectKernel, type Plugin, type PluginContext } from '@objectstack/core';
import type { IMetadataService } from '@objectstack/spec/contracts';
import { MetadataPlugin } from '@objectstack/metadata';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { RestServer } from '@objectstack/rest';
import { resolveThrownHttpError } from '@objectstack/types';
import { HttpDispatcher } from '../http-dispatcher.js';
import { AppPlugin } from '../app-plugin.js';
import { loadArtifactBundle } from '../load-artifact-bundle.js';

const CALLER = { userId: 'u_mcp', isSystem: false, positions: [], permissions: [], systemPermissions: [] };

/** The `manifest` service door a package registers through (`ObjectQLPlugin`'s `register`). */
interface ManifestDoor {
    register(artifact: unknown, options?: { source?: 'code' | 'marketplace' }): Promise<void> | void;
}

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
    const host: Plugin = {
        name: 'qa.package-host',
        dependencies: ['com.objectstack.engine.objectql'],
        init: async (ctx: PluginContext) => {
            if (mcp) ctx.registerService('mcp', mcp);
            if (when === 'boot') await ctx.getService<ManifestDoor>('manifest').register(pkg.artifact());
        },
    };
    await kernel.use(host);
    await kernel.bootstrap();
    if (when === 'install') {
        await kernel.getService<ManifestDoor>('manifest').register(pkg.artifact(), { source: 'marketplace' });
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

function requestContext(environmentId?: string, caller: Record<string, unknown> = CALLER): any {
    return {
        request: new Request('http://localhost/api/v1/mcp', {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
            body: '{}',
        }),
        response: {},
        environmentId,
        executionContext: { ...caller },
    };
}

/** The bridge the real `/mcp` entry builds for `caller` (`CALLER` unless named) and hands the MCP service. */
async function bridgeFor(dispatcher: HttpDispatcher, mcp: any, environmentId?: string, caller: Record<string, unknown> = CALLER): Promise<any> {
    const res = await dispatcher.handleMcp({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, requestContext(environmentId, caller));
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

/** The refusal the data plane answers an object of a disabled package (`@objectstack/metadata-protocol`). */
const PACKAGE_DISABLED = { code: 'OBJECT_PACKAGE_DISABLED', status: 404 } as const;

/**
 * The `/data` record requests both data doors serve: the five well-formed ones
 * (REST has no aggregate route, so they are its whole data face), and three
 * whose body is not what the request schema declares, which each door's
 * request gate answers.
 */
const DATA_REQUESTS: ReadonlyArray<{ method: string; route: string; id?: string; body: unknown; wellFormed: boolean }> = [
    { method: 'GET', route: '/data/:object', body: undefined, wellFormed: true },
    { method: 'GET', route: '/data/:object/:id', id: 'r_any', body: undefined, wellFormed: true },
    { method: 'POST', route: '/data/:object/query', body: {}, wellFormed: true },
    { method: 'POST', route: '/data/:object', body: { name: 'written' }, wellFormed: true },
    { method: 'PATCH', route: '/data/:object/:id', id: 'r_any', body: { name: 'written' }, wellFormed: true },
    { method: 'DELETE', route: '/data/:object/:id', id: 'r_any', body: undefined, wellFormed: true },
    { method: 'POST', route: '/data/:object', body: [{ name: 'written' }], wellFormed: false },
    { method: 'PATCH', route: '/data/:object/:id', id: 'r_any', body: [{ name: 'written' }], wellFormed: false },
    { method: 'POST', route: '/data/:object/query', body: { limit: 'ten' }, wellFormed: false },
];

/** The refusal's `code` in either door's envelope: nested under `error`, or beside a string `error`. */
const codeOf = (body: any): unknown => (body?.error && typeof body.error === 'object' ? body.error.code : body?.code);

/**
 * What each data door answers `object` on each of {@link DATA_REQUESTS}, both
 * served over this kernel's own protocol: `RestServer` through its registered
 * handler, and the runtime dispatcher's `/data` door through `dispatch()`, the
 * way `data-write-request-gate.test.ts` drives the two.
 */
async function dataDoorAnswers(kernel: ObjectKernel, object: string) {
    const noop = () => {};
    const server = { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
    const rest: any = new RestServer(server as any, kernel.getService('protocol') as any, { api: { requireAuth: false } } as any);
    rest.resolveExecCtx = async () => ({ ...CALLER });
    rest.registerRoutes();
    const dispatcher = new HttpDispatcher(kernel as any, undefined, { enforceProjectMembership: false });
    (dispatcher as any).timedResolveExecutionContext = async () => ({ ...CALLER });

    const answers: Array<{ request: string; wellFormed: boolean; rest: unknown; dispatcher: unknown }> = [];
    for (const { method, route, id, body, wellFormed } of DATA_REQUESTS) {
        const path = `/data/${object}${route.endsWith('/query') ? '/query' : id ? `/${id}` : ''}`;
        const handler = rest.getRoutes().find((r: any) => r.method === method && r.path === `/api/v1${route}`)?.handler;
        expect(handler, `precondition: RestServer registers ${method} ${route}`).toBeTruthy();
        const res: any = { statusCode: 200, body: undefined };
        res.status = (code: number) => { res.statusCode = code; return res; };
        res.json = (out: unknown) => { res.body = out; return res; };
        res.header = () => res;
        res.setHeader = noop;
        res.send = () => res;
        res.end = () => res;
        await handler({ method, path: `/api/v1${path}`, params: { object, ...(id ? { id } : {}) }, headers: { 'content-type': 'application/json' }, query: {}, body }, res);

        let door: { status: unknown; code: unknown };
        try {
            const raw = new Request(`http://localhost/api/v1${path}`, {
                method,
                headers: { 'content-type': 'application/json' },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            });
            const out: any = await dispatcher.dispatch(method, path, body ?? {}, {}, { request: raw } as any, '/api/v1');
            door = { status: out.response?.status, code: codeOf(out.response?.body) };
        } catch (e) {
            // A throw out of `dispatch()` is rendered by the host's exit, through this one rule.
            const thrown = resolveThrownHttpError(e);
            door = { status: thrown.status, code: thrown.code };
        }
        answers.push({
            request: `${method} ${route} ${JSON.stringify(body) ?? ''}`,
            wellFormed,
            rest: { status: res.statusCode, code: codeOf(res.body) },
            dispatcher: door,
        });
    }
    return answers;
}

for (const { shape, environmentId } of SHAPES) {
    describe(`[#25120] a DISABLED package's objects — ${shape}: omitted as GET /meta/object omits them, refused as REST refuses them`, () => {
        const pkg = packageOf('qa_off');
        const mcp = recordingMcp();
        let booted: Booted | undefined;
        let dispatcher: HttpDispatcher;

        beforeAll(async () => {
            booted = await bootKernel(environmentId, 'boot', pkg, mcp);
            expect((booted.engine as any).registry.disablePackage('com.qa.qa_off'), 'precondition: disabled').toBeTruthy();
            if (environmentId === undefined) {
                // No `environmentId`, so the boot bridge HAS copied both objects
                // into the `metadata` service: the copy outlives the disable, so
                // the bridge used to list and describe both while REST listed
                // neither, and the gate judged the copy's declaration.
                for (const name of [pkg.open, pkg.gated]) {
                    expect(
                        await booted.kernel.getService<IMetadataService>('metadata').getObject(name),
                        `precondition: the metadata service still holds ${name}'s copy`,
                    ).toBeTruthy();
                }
            }
            dispatcher = new HttpDispatcher(booted.kernel as any, undefined, { enforceProjectMembership: false });
        }, 60_000);
        afterAll(async () => {
            vi.restoreAllMocks();
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

        it('REST answers both objects 404 OBJECT_PACKAGE_DISABLED on every well-formed /data record request: the answer the rows below give', async () => {
            for (const object of [pkg.gated, pkg.open]) {
                for (const answer of (await dataDoorAnswers(booted!.kernel, object)).filter((a) => a.wellFormed)) {
                    expect(answer.rest, `${answer.request} on ${object}`).toEqual(PACKAGE_DISABLED);
                }
            }
        });

        it('the dispatcher\'s /data door answers each request what REST answers, a body that is not a record included', async () => {
            // The door asks the exposure gate before its request gate, as the
            // twin of REST's `enforceApiAccess`, which reads the disabled
            // package's refusal as "no declaration": so a malformed body is
            // answered by the request gate first on both doors.
            for (const object of [pkg.gated, pkg.open]) {
                for (const answer of await dataDoorAnswers(booted!.kernel, object)) {
                    expect(answer.dispatcher, `${answer.request} on ${object}`).toEqual(answer.rest);
                }
            }
        });

        // The object declared `apiEnabled: false`, and the exposed one: a
        // disabled package's object is refused at the gate whatever it
        // declares, `aggregate_records` included (its `callData` arm asks the
        // engine, never the protocol that refuses it on the other five).
        for (const [declared, object] of [['apiEnabled: false', pkg.gated], ['exposed', pkg.open]] as const) {
            for (const [tool, call] of DATA_VERBS) {
                it(`${tool} refuses the ${declared} object — 404 OBJECT_PACKAGE_DISABLED, refused at the gate, the store never asked`, async () => {
                    const bridge = await bridgeFor(dispatcher, mcp);
                    const spies = storeSpies(booted!.kernel, booted!.engine);
                    try {
                        expect(await outcome(() => call(bridge, object))).toEqual(PACKAGE_DISABLED);
                        for (const spy of spies) expect(spy).not.toHaveBeenCalled();
                    } finally {
                        for (const spy of spies) spy.mockRestore();
                    }
                });
            }
        }
    });
}

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

/**
 * [#25139] `list_actions`, `run_action` and `resume_run` collect the actions
 * declared on an object from the listing `list_objects` serves, the protocol's
 * merged read, and no longer from `metadata.listObjects()`.
 *
 * Measured on this rig at the base tree, with the package below registered
 * during the boot on the `env_local` shape: `list_actions` listed none of its
 * actions and `run_action` answered `Action 'mark_done' not found on object
 * 'qa_act_open'`, while REST's `POST /api/v1/actions/qa_act_open/mark_done`
 * ran the same update. Every other shape listed and ran them. A disabled
 * package's actions are omitted and "not found", as `describe_object` answers
 * its objects, on both shapes; on the one without an `environmentId` the
 * metadata service still holds the copy, and the bridge listed and ran them
 * from it.
 *
 * The package: on its exposed object, a declarative update exposed to AI, a
 * script action exposed to AI whose handler is registered after the boot, a
 * declarative update NOT exposed, and a top-level action bound to the object
 * (the registry carries it inside the object's `actions`); on its
 * `apiEnabled: false` object, a declarative update exposed to AI.
 */
const TENANT_CALLER = { ...CALLER, tenantId: 'org_qa' };

function actionPackageOf(prefix: string) {
    const pkg = packageOf(prefix);
    const update = (name: string, exposed: boolean, extra: Record<string, unknown> = {}) => ({
        name,
        label: name,
        type: 'script',
        operation: 'update',
        patch: { name: 'done' },
        // [#25649] A package's top-level action is stored as its `ActionSchema`
        // parse, which holds an AI-exposed action's `description` to 40 characters.
        ...(exposed ? { ai: { exposed: true, description: `${name}: marks the record done, for the MCP discovery test` } } : {}),
        ...extra,
    });
    return {
        ...pkg,
        id: `com.qa.${prefix}`,
        listed: [`${pkg.gated}:gated_done`, `${pkg.open}:bound_done`, `${pkg.open}:mark_done`, `${pkg.open}:ping`],
        artifact: () => {
            const base: any = pkg.artifact();
            base.objects[0].actions = [
                update('mark_done', true),
                { name: 'ping', label: 'Ping', type: 'script', target: 'qa_ping', ai: { exposed: true, description: 'Ping' } },
                update('hidden_done', false),
            ];
            base.objects[1].actions = [update('gated_done', true)];
            base.actions = [update('bound_done', true, { objectName: pkg.open })];
            return base;
        },
    };
}

/** The `objectName:name` pairs `list_actions` lists on the package's two objects. */
async function listedPackageActions(bridge: any, pkg: ReturnType<typeof actionPackageOf>): Promise<string[]> {
    return ((await bridge.listActions()) as any[])
        .filter((a) => a?.objectName === pkg.open || a?.objectName === pkg.gated)
        .map((a) => `${a.objectName}:${a.name}`)
        .sort();
}

/** What REST's `POST /actions/:object/:action` answers `TENANT_CALLER`, through the runtime dispatcher. */
async function restActionAnswer(kernel: ObjectKernel, object: string, action: string, body: Record<string, unknown>) {
    const dispatcher = new HttpDispatcher(kernel as any, undefined, { enforceProjectMembership: false });
    (dispatcher as any).timedResolveExecutionContext = async () => ({ ...TENANT_CALLER });
    const path = `/actions/${object}/${action}`;
    const raw = new Request(`http://localhost/api/v1${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
    const out: any = await dispatcher.dispatch('POST', path, body, {}, { request: raw } as any, '/api/v1');
    return { status: out.response?.status, code: codeOf(out.response?.body), data: out.response?.body?.data };
}

/** `run_action`'s answer: its result, or the refusal's code, status and message. */
async function runOutcome(call: () => Promise<any>): Promise<{ result?: any; code?: unknown; status?: unknown; message?: string }> {
    try {
        return { result: (await call())?.result };
    } catch (e: any) {
        return { code: e?.code, status: e?.status, message: String(e?.message) };
    }
}

for (const { shape, environmentId } of SHAPES) {
    for (const { label, when } of REGISTRATIONS) {
        describe(`[#25139] the /mcp bridge and a package object's actions — ${shape}, ${label}`, () => {
            const pkg = actionPackageOf('qa_act');
            const mcp = recordingMcp();
            let booted: Booted | undefined;
            let dispatcher: HttpDispatcher;

            beforeAll(async () => {
                booted = await bootKernel(environmentId, when, pkg, mcp);
                booted.engine.registerAction(pkg.open, 'qa_ping', async () => ({ pong: true }));
                dispatcher = new HttpDispatcher(booted.kernel as any, undefined, { enforceProjectMembership: false });
            }, 60_000);
            afterAll(async () => {
                await shutdown(booted);
            }, 60_000);

            const bridge = () => bridgeFor(dispatcher, mcp, undefined, TENANT_CALLER);
            const seed = async (): Promise<string> => {
                const created: any = await (await bridge()).create(pkg.open, { name: 'seed' });
                const id = created?.id ?? created?.record?.id;
                expect(typeof id, 'precondition: a record of the package object was created').toBe('string');
                return id;
            };

            it('list_actions lists each action the package exposed to AI on its objects, the bound top-level one included, and not the unexposed one', async () => {
                expect(await listedPackageActions(await bridge(), pkg)).toEqual(pkg.listed);
            });

            it('run_action runs the declarative update on a record of the package object, as REST /actions runs it', async () => {
                const viaMcp = await seed();
                const ran = await runOutcome(async () => (await bridge()).runAction('mark_done', { objectName: pkg.open, recordId: viaMcp }));
                expect(ran.message).toBeUndefined();
                expect(ran.result?.record?.name).toBe('done');
                expect((await (await bridge()).get(pkg.open, viaMcp))?.name).toBe('done');

                const viaRest = await seed();
                const rest = await restActionAnswer(booted!.kernel, pkg.open, 'mark_done', { recordId: viaRest });
                expect(rest.status, 'the parity target: REST runs it').toBe(200);
                expect(rest.data?.record?.name).toBe('done');
            });

            it('run_action resolves the name without objectName, and refuses an absent record RECORD_NOT_FOUND, as REST does', async () => {
                const ran = await runOutcome(async () => (await bridge()).runAction('mark_done', { recordId: 'r_absent' }));
                const rest = await restActionAnswer(booted!.kernel, pkg.open, 'mark_done', { recordId: 'r_absent' });
                expect({ code: ran.code, status: ran.status }).toEqual({ code: 'RECORD_NOT_FOUND', status: 404 });
                expect({ code: rest.code, status: rest.status }).toEqual({ code: 'RECORD_NOT_FOUND', status: 404 });
            });

            it('run_action runs the top-level action bound to the package object', async () => {
                const id = await seed();
                const ran = await runOutcome(async () => (await bridge()).runAction('bound_done', { objectName: pkg.open, recordId: id }));
                expect(ran.message).toBeUndefined();
                expect(ran.result?.record?.name).toBe('done');
            });

            it('run_action runs the package\'s script action through its registered handler, as REST does', async () => {
                const ran = await runOutcome(async () => (await bridge()).runAction('ping', { objectName: pkg.open }));
                expect(ran).toEqual({ result: { pong: true } });
                const rest = await restActionAnswer(booted!.kernel, pkg.open, 'ping', {});
                expect({ status: rest.status, data: rest.data }).toEqual({ status: 200, data: { pong: true } });
            });

            it('run_action resolves the action the package did not expose to AI, and refuses it at the exposure gate', async () => {
                const ran = await runOutcome(async () => (await bridge()).runAction('hidden_done', { objectName: pkg.open, recordId: 'r_absent' }));
                expect(ran.message).toMatch(/^Action 'hidden_done' on 'qa_act_open' is not exposed to AI/);
            });

            it('CONTROL: a name the package does not declare is still not found', async () => {
                const ran = await runOutcome(async () => (await bridge()).runAction('qa_nowhere', { objectName: pkg.open }));
                expect(ran.message).toBe(`Action 'qa_nowhere' not found on object '${pkg.open}'`);
            });
        });
    }
}

for (const { shape, environmentId } of SHAPES) {
    describe(`[#25139] a DISABLED package's actions — ${shape}: neither listed nor run, as its objects are neither listed nor described`, () => {
        const pkg = actionPackageOf('qa_act_off');
        const mcp = recordingMcp();
        let booted: Booted | undefined;
        let dispatcher: HttpDispatcher;

        beforeAll(async () => {
            booted = await bootKernel(environmentId, 'boot', pkg, mcp);
            booted.engine.registerAction(pkg.open, 'qa_ping', async () => ({ pong: true }));
            expect((booted.engine as any).registry.disablePackage(pkg.id), 'precondition: disabled').toBeTruthy();
            if (environmentId === undefined) {
                // The copy the boot bridge made outlives the disable, actions and all.
                const copy = await booted.kernel.getService<IMetadataService>('metadata').getObject(pkg.open) as
                    { actions?: Array<{ name?: unknown }> } | undefined;
                expect(
                    (copy?.actions ?? []).map((a) => a?.name),
                    'precondition: the metadata service still holds the object\'s actions',
                ).toEqual(expect.arrayContaining(['mark_done', 'ping', 'bound_done']));
            }
            dispatcher = new HttpDispatcher(booted.kernel as any, undefined, { enforceProjectMembership: false });
        }, 60_000);
        afterAll(async () => {
            await shutdown(booted);
        }, 60_000);

        it('list_actions lists none of them', async () => {
            const bridge = await bridgeFor(dispatcher, mcp, undefined, TENANT_CALLER);
            expect(await bridge.describeObject(pkg.open), 'precondition: describe_object answers the object "not found"').toBeNull();
            expect(await listedPackageActions(bridge, pkg)).toEqual([]);
        });

        for (const name of ['mark_done', 'ping', 'bound_done'] as const) {
            it(`run_action answers ${name} "not found", scoped and unscoped`, async () => {
                const bridge = await bridgeFor(dispatcher, mcp, undefined, TENANT_CALLER);
                expect(await runOutcome(() => bridge.runAction(name, { objectName: pkg.open, recordId: 'r_any' })))
                    .toEqual({ code: undefined, status: undefined, message: `Action '${name}' not found on object '${pkg.open}'` });
                expect(await runOutcome(() => bridge.runAction(name, { recordId: 'r_any' })))
                    .toEqual({ code: undefined, status: undefined, message: `Action '${name}' not found` });
            });
        }
    });
}

/**
 * [#25297] `list_actions`, `run_action` and `resume_run` collect the standalone
 * `action` items, the ones no object embeds, from the protocol's merged
 * `action` listing (`GET /api/v1/meta/action`'s read), and no longer from
 * `metadata.loadMany('action')`.
 *
 * `loadMany` reads the metadata service's loaders alone. Measured on this rig
 * at the base tree, on both shapes:
 *
 * | the object-less action, and where it came from | `loadMany('action')` | `list_actions` | `run_action` | REST `POST /actions/global/NAME` |
 * | :-- | :-- | :-- | :-- | :-- |
 * | a package's, registered through the `manifest` service (during the boot, or a marketplace install) | absent | not listed | `Action 'NAME' not found` | `200`, the handler's answer |
 * | an environment-authored row (`saveMetaItem`) | absent | not listed | `Action 'NAME' not found` | `200` |
 * | the same, bound to the package's object (the merged object listing does not fold it into the object's `actions`) | absent | not listed | `… not found on object 'OBJECT'` | `200` |
 * | the compiled artifact's, its `packages[]` included (the artifact door and `AppPlugin`, as `createStandaloneStack` composes them) | held | listed | run | `200` |
 * | the same, its package disabled | still held | **listed** | **run** | `200` |
 *
 * The last row is the narrowing: the merged listing omits a disabled
 * package's items, so the bridge now omits them, as it omits the package's
 * objects since #25120. REST's door still runs that action; that is REST's
 * door, not this one.
 */
const GLOBAL = 'global';
const AUTHORED = 'qa_authored_ping';
const AUTHORED_HANDLER = 'qa_authored_handler';
const AUTHORED_BOUND = 'qa_authored_bound';

/** An object-less action `target`ing `handler`, exposed to AI unless `exposed` is false. */
function objectLessAction(name: string, handler: string, exposed = true) {
    return {
        name,
        label: name,
        type: 'script',
        target: handler,
        ...(exposed ? { ai: { exposed: true, description: `${name}: an object-less action, for this test only` } } : {}),
    };
}

/** The package of two objects (`packageOf`) with two top-level actions that name no object. */
function globalActionPackageOf(prefix: string) {
    const pkg = packageOf(prefix);
    const names = { ping: `${prefix}_ping`, hidden: `${prefix}_hidden`, handler: `${prefix}_handler` };
    return {
        ...pkg,
        ...names,
        id: `com.qa.${prefix}`,
        artifact: () => ({
            ...pkg.artifact(),
            actions: [objectLessAction(names.ping, names.handler), objectLessAction(names.hidden, names.handler, false)],
        }),
    };
}

/** The object-less actions `list_actions` lists, by name, the platform's own left out. */
async function listedGlobalActions(bridge: any): Promise<string[]> {
    return ((await bridge.listActions()) as any[])
        .filter((a) => a?.objectName === GLOBAL && /^qa_/.test(String(a?.name)))
        .map((a) => String(a.name))
        .sort();
}

/**
 * Save the environment-authored object-less action through the protocol, as
 * `PUT /api/v1/meta/action/NAME` does; with `boundTo`, also one bound to that
 * object, whose handler is `AUTHORED_HANDLER` on it.
 */
async function saveAuthoredAction(kernel: ObjectKernel, boundTo?: string): Promise<void> {
    const protocol: any = kernel.getService('protocol');
    await protocol.saveMetaItem({ type: 'action', name: AUTHORED, item: objectLessAction(AUTHORED, AUTHORED_HANDLER) });
    if (boundTo) {
        await protocol.saveMetaItem({
            type: 'action',
            name: AUTHORED_BOUND,
            item: { ...objectLessAction(AUTHORED_BOUND, AUTHORED_HANDLER), objectName: boundTo },
        });
    }
}

/** The standalone `action` items' names the metadata service's loaders hold. */
async function loaderActionNames(kernel: ObjectKernel): Promise<string[]> {
    const meta = kernel.getService<IMetadataService>('metadata') as unknown as { loadMany(type: string): Promise<Array<{ name?: unknown }>> };
    return (await meta.loadMany('action')).map((a) => String(a?.name));
}

for (const { shape, environmentId } of SHAPES) {
    for (const { label, when } of REGISTRATIONS) {
        describe(`[#25297] a package's object-less action, and an environment-authored one — ${shape}, ${label}`, () => {
            const pkg = globalActionPackageOf('qa_glb');
            const mcp = recordingMcp();
            let booted: Booted | undefined;
            let dispatcher: HttpDispatcher;

            beforeAll(async () => {
                booted = await bootKernel(environmentId, when, pkg, mcp);
                booted.engine.registerAction(GLOBAL, pkg.handler, async () => ({ pong: 'package' }));
                booted.engine.registerAction(GLOBAL, AUTHORED_HANDLER, async () => ({ pong: 'authored' }));
                booted.engine.registerAction(pkg.open, AUTHORED_HANDLER, async () => ({ pong: 'authored, bound' }));
                await saveAuthoredAction(booted.kernel, pkg.open);
                dispatcher = new HttpDispatcher(booted.kernel as any, undefined, { enforceProjectMembership: false });
            }, 60_000);
            afterAll(async () => {
                await shutdown(booted);
            }, 60_000);

            const bridge = () => bridgeFor(dispatcher, mcp, undefined, TENANT_CALLER);

            it('list_actions lists the package\'s object-less action exposed to AI and the environment-authored one, and not the unexposed one', async () => {
                expect(await listedGlobalActions(await bridge())).toEqual([AUTHORED, pkg.ping].sort());
            });

            it('run_action runs the package\'s object-less action through its handler, unscoped and scoped to global, as REST does', async () => {
                expect(await runOutcome(async () => (await bridge()).runAction(pkg.ping, {}))).toEqual({ result: { pong: 'package' } });
                expect(await runOutcome(async () => (await bridge()).runAction(pkg.ping, { objectName: GLOBAL })))
                    .toEqual({ result: { pong: 'package' } });
                const rest = await restActionAnswer(booted!.kernel, GLOBAL, pkg.ping, {});
                expect({ status: rest.status, data: rest.data }, 'the parity target: REST runs it').toEqual({ status: 200, data: { pong: 'package' } });
            });

            it('run_action runs the environment-authored object-less action, as REST does', async () => {
                expect(await runOutcome(async () => (await bridge()).runAction(AUTHORED, {}))).toEqual({ result: { pong: 'authored' } });
                const rest = await restActionAnswer(booted!.kernel, GLOBAL, AUTHORED, {});
                expect({ status: rest.status, data: rest.data }).toEqual({ status: 200, data: { pong: 'authored' } });
            });

            it('list_actions lists, and run_action runs, an environment-authored action bound to the package\'s object, as REST does', async () => {
                const listed = ((await (await bridge()).listActions()) as any[]).map((a) => `${a?.objectName}:${a?.name}`);
                expect(listed).toContain(`${pkg.open}:${AUTHORED_BOUND}`);
                expect(await runOutcome(async () => (await bridge()).runAction(AUTHORED_BOUND, { objectName: pkg.open })))
                    .toEqual({ result: { pong: 'authored, bound' } });
                const rest = await restActionAnswer(booted!.kernel, pkg.open, AUTHORED_BOUND, {});
                expect({ status: rest.status, data: rest.data }).toEqual({ status: 200, data: { pong: 'authored, bound' } });
            });

            it('run_action resolves the object-less action the package did not expose to AI, and refuses it at the exposure gate', async () => {
                const ran = await runOutcome(async () => (await bridge()).runAction(pkg.hidden, {}));
                expect(ran.message).toMatch(new RegExp(`^Action '${pkg.hidden}' on 'global' is not exposed to AI`));
            });

            it('CONTROL: an object-less name nothing declares is still not found', async () => {
                const ran = await runOutcome(async () => (await bridge()).runAction('qa_nowhere', {}));
                expect(ran.message).toBe('Action \'qa_nowhere\' not found');
            });
        });
    }
}

for (const { shape, environmentId } of SHAPES) {
    describe(`[#25297] a DISABLED package's object-less action — ${shape}: neither listed nor run, the environment-authored one still both`, () => {
        const pkg = globalActionPackageOf('qa_glb_off');
        const mcp = recordingMcp();
        let booted: Booted | undefined;
        let dispatcher: HttpDispatcher;

        beforeAll(async () => {
            booted = await bootKernel(environmentId, 'boot', pkg, mcp);
            booted.engine.registerAction(GLOBAL, pkg.handler, async () => ({ pong: 'package' }));
            booted.engine.registerAction(GLOBAL, AUTHORED_HANDLER, async () => ({ pong: 'authored' }));
            await saveAuthoredAction(booted.kernel);
            expect((booted.engine as any).registry.disablePackage(pkg.id), 'precondition: disabled').toBeTruthy();
            dispatcher = new HttpDispatcher(booted.kernel as any, undefined, { enforceProjectMembership: false });
        }, 60_000);
        afterAll(async () => {
            await shutdown(booted);
        }, 60_000);

        it('list_actions lists the environment-authored action and none of the package\'s', async () => {
            const bridge = await bridgeFor(dispatcher, mcp, undefined, TENANT_CALLER);
            expect(await listedGlobalActions(bridge)).toEqual([AUTHORED]);
        });

        it('run_action answers the package\'s action "not found", scoped and unscoped, and runs the environment-authored one', async () => {
            const bridge = await bridgeFor(dispatcher, mcp, undefined, TENANT_CALLER);
            expect(await runOutcome(() => bridge.runAction(pkg.ping, {})))
                .toEqual({ code: undefined, status: undefined, message: `Action '${pkg.ping}' not found` });
            expect(await runOutcome(() => bridge.runAction(pkg.ping, { objectName: GLOBAL })))
                .toEqual({ code: undefined, status: undefined, message: `Action '${pkg.ping}' not found on object 'global'` });
            expect(await runOutcome(() => bridge.runAction(AUTHORED, {}))).toEqual({ result: { pong: 'authored' } });
        });
    });
}

/** The compiled artifact: the project's own object-less action, and a `packages[]` entry carrying another. */
const ART = { app: 'com.qa.qa-art', pkg: 'com.qa.qa-art-pkg', ping: 'qa_art_ping', pkgPing: 'qa_art_pkg_ping', handler: 'qa_art_handler' } as const;
const artifactWithGlobalActions = () => ({
    manifest: { id: ART.app, name: 'qa art', version: '0.0.1', type: 'app' },
    objects: [{ name: 'qa_art_obj', label: 'Art', fields: { name: { name: 'name', type: 'text', label: 'Name' } } }],
    actions: [objectLessAction(ART.ping, ART.handler)],
    views: [], apps: [], flows: [], requires: [],
    packages: [{
        manifest: {
            id: ART.pkg, name: 'qa art package', version: '0.0.1', type: 'app',
            objects: [{ name: 'qa_art_pkg_obj', label: 'Art package', fields: { name: { name: 'name', type: 'text', label: 'Name' } } }],
            actions: [objectLessAction(ART.pkgPing, ART.handler)],
        },
    }],
});

/**
 * A kernel booted from a compiled artifact the way `createStandaloneStack`
 * composes it: the artifact door (`MetadataPlugin`'s `artifactSource`) and an
 * `AppPlugin` over the same bundle.
 */
async function bootArtifactKernel(environmentId: string | undefined, mcp: unknown): Promise<Booted> {
    const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
    const root = mkdtempSync(join(tmpdir(), 'os-mcp-artifact-actions-'));
    const engine = new ObjectQL();
    engine.registerDriver(new SqlDriver({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
    }) as any, true);
    const artifact = join(root, 'objectstack.json');
    writeFileSync(artifact, JSON.stringify(artifactWithGlobalActions()));
    await kernel.use(new MetadataPlugin({
        watch: false, artifactWatch: false, ...(environmentId ? { environmentId } : {}),
        artifactSource: { mode: 'local-file', path: artifact }, rootDir: root,
    } as any));
    await kernel.use(new ObjectQLPlugin({ ql: engine, ...(environmentId ? { environmentId, hydrateMetadataFromDb: true } : {}) }));
    const bundle = await loadArtifactBundle(artifact, { tag: '[#25297 rig]', unwrapEnvelope: true });
    await kernel.use(new AppPlugin(bundle, undefined, { skipSeedData: true, securityMetadataRegistrar: 'artifact-door' }));
    await kernel.use({
        name: 'qa.mcp-host',
        dependencies: ['com.objectstack.engine.objectql'],
        init: async (ctx: PluginContext) => {
            ctx.registerService('mcp', mcp);
        },
    } as Plugin);
    await kernel.bootstrap();
    await engine.syncSchemas();
    engine.registerAction(GLOBAL, ART.handler, async () => ({ pong: 'artifact' }));
    return { kernel, engine, root };
}

for (const { shape, environmentId } of SHAPES) {
    for (const disabled of [false, true]) {
        describe(`[#25297] the compiled artifact's object-less actions — ${shape}${disabled ? ', its package disabled' : ''}`, () => {
            const mcp = recordingMcp();
            let booted: Booted | undefined;
            let dispatcher: HttpDispatcher;

            beforeAll(async () => {
                booted = await bootArtifactKernel(environmentId, mcp);
                if (disabled) {
                    expect((booted.engine as any).registry.disablePackage(ART.pkg), 'precondition: disabled').toBeTruthy();
                }
                dispatcher = new HttpDispatcher(booted.kernel as any, undefined, { enforceProjectMembership: false });
            }, 60_000);
            afterAll(async () => {
                await shutdown(booted);
            }, 60_000);

            const bridge = () => bridgeFor(dispatcher, mcp, undefined, TENANT_CALLER);

            it(`precondition: the metadata service's loaders hold both${disabled ? ', the disabled package\'s too' : ''}`, async () => {
                expect((await loaderActionNames(booted!.kernel)).sort()).toEqual([ART.pkgPing, ART.ping].sort());
            });

            if (!disabled) {
                it('CONTROL: list_actions lists both, and run_action runs both, as REST does', async () => {
                    expect(await listedGlobalActions(await bridge())).toEqual([ART.pkgPing, ART.ping].sort());
                    for (const name of [ART.ping, ART.pkgPing]) {
                        expect(await runOutcome(async () => (await bridge()).runAction(name, {}))).toEqual({ result: { pong: 'artifact' } });
                        const rest = await restActionAnswer(booted!.kernel, GLOBAL, name, {});
                        expect({ status: rest.status, data: rest.data }).toEqual({ status: 200, data: { pong: 'artifact' } });
                    }
                });
            } else {
                it('list_actions lists the project\'s own action and not the disabled package\'s', async () => {
                    expect(await listedGlobalActions(await bridge())).toEqual([ART.ping]);
                });

                it('run_action answers the disabled package\'s action "not found", scoped and unscoped, and still runs the project\'s own', async () => {
                    expect(await runOutcome(async () => (await bridge()).runAction(ART.pkgPing, {})))
                        .toEqual({ code: undefined, status: undefined, message: `Action '${ART.pkgPing}' not found` });
                    expect(await runOutcome(async () => (await bridge()).runAction(ART.pkgPing, { objectName: GLOBAL })))
                        .toEqual({ code: undefined, status: undefined, message: `Action '${ART.pkgPing}' not found on object 'global'` });
                    expect(await runOutcome(async () => (await bridge()).runAction(ART.ping, {}))).toEqual({ result: { pong: 'artifact' } });
                });
            }
        });
    }
}
