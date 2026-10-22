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
