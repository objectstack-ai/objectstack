// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23292, ADR-0048] Which `sys_metadata` row the `/automation` definition
 * doors write: `POST /`, `PUT /:name` and the copy `POST /:name/clone` writes,
 * all through `registerAndSaveFlow`, which saves through the protocol's
 * `saveMetaItem` naming no package.
 *
 * ## Why no package is named
 *
 * A row is keyed by its package, so one flow name can hold one row per
 * package. A save that names none is resolved by the protocol: the one
 * package's row when the flow's active rows are bound to exactly one, else the
 * package-unbound row; a name two packages hold is refused
 * `409 RESOURCE_CONFLICT`, because choosing one of them is the driver-order
 * coin toss that refusal exists to stop. The door could only name a package it
 * already holds, and none of the three does:
 *
 *  - `POST /` and `PUT /:name` take a definition and a path. The one
 *    package-shaped thing either reaches is a `_packageId` stamp: on the
 *    caller's body (the caller's bytes; read as an address, the body would be
 *    a package selector the door never declared), or on the definition the
 *    engine holds. For a name two packages hold, the latter is the contender
 *    the boot bind armed by arrival order. Measured below in both seed orders:
 *    the protocol's execution view lists the two rows in opposite orders, so
 *    the engine holds a different package's stamp in each.
 *  - The clone writes a NEW name, and drops the source's protection envelope
 *    `_packageId` included (ADR-0126 §7.1): the source's package is not the
 *    target's.
 *
 * So what this pins is the protocol's resolution, reached through the door:
 *
 *  - a flow one package holds is saved to that package's row only;
 *  - a flow no package holds is saved to the package-unbound row;
 *  - a flow two packages hold is refused `409 RESOURCE_CONFLICT` at each of
 *    the three call sites, in either seed order, whichever contender the
 *    engine holds: neither row changes, no package-unbound row is minted, and
 *    the engine is put back as it was (the definition it held re-registered,
 *    or the new name withdrawn).
 *
 * ## [#23501] The 409's remedy is one this door's caller can follow
 *
 * The protocol's refusal prescribes "on the REST door add ?package=", and this
 * door reads no `?package=`: relayed verbatim, it sent a caller who followed
 * it back here to the identical `409`. The door now answers the same
 * `409 RESOURCE_CONFLICT` with a remedy that works from here, and the last
 * describe block below follows each one AS PRINTED — the method and route are
 * read out of the answer and sent, never restated by the test:
 *
 *  - `PUT /:name` and `POST /` name the metadata door's
 *    `PUT /api/v1/meta/flow/:name?package=`, followed on both `/meta`
 *    transports (`RestServer`, and the dispatcher's own `/meta` arm that the
 *    `@objectstack/hono` catch-all reaches);
 *  - `DELETE /:name` names the metadata door's
 *    `DELETE /api/v1/meta/flow/:name?package=`, followed on `RestServer`, the
 *    one `/meta` transport that serves a `DELETE` (the dispatcher's `/meta`
 *    arm answers it `405`, `domains/meta.ts`);
 *  - the clone answers its own taken-name refusal, because a name two
 *    packages hold is taken (ADR-0126 §7.1), and is followed with the new
 *    name it suggests.
 *
 * Only the envelope (`code` + `status`), the door the remedy names, and the
 * packages it states are asserted — never the sentence.
 *
 * ## The rig
 *
 * A REAL store: better-sqlite3 `:memory:`, the real `ObjectQL` engine with the
 * real `sys_metadata*` objects, and a real `ObjectStackProtocolImplementation`,
 * so every verdict is the protocol's and every claim is read back from the
 * rows. The two packages are installed writable bases, and the two-package
 * state is reached through the dispatcher's own `PUT /meta/flow/:name?package=`
 * door. Every request goes through `HttpDispatcher.dispatch()`, the identity
 * step the one stubbed seam (as `meta-save-actor.test.ts` drives it). The
 * automation engine is a map, as in the sibling door suites: the engine's
 * validation is not the subject, and its double arms the contender the boot
 * bind arms (the first one the protocol's execution view lists). `RestServer`
 * (`@objectstack/rest`) is mounted over the same protocol for the `/meta`
 * routes a remedy names, its route handlers called directly, as
 * `meta-save-actor.test.ts` calls them.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SysMetadata, SysMetadataHistoryObject, SysMetadataAuditObject } from '@objectstack/platform-objects/metadata';
import { RestServer } from '@objectstack/rest';
import { HttpDispatcher } from '../http-dispatcher.js';

/** `registry.registerObject` requires a package id (see the sibling real-stack tests). */
const TEST_PACKAGE_ID = 'objectstack-test';
const ALPHA = 'com.qa.alpha';
const BETA = 'com.qa.beta';
const SHARED = 'shared_flow';

const AUTHOR = { userId: 'u_admin', isSystem: false, systemPermissions: ['manage_metadata'] };

const flowOf = (name: string, label: string) => ({ name, label, type: 'autolaunched', nodes: [], edges: [] });

const liveEngines: ObjectQL[] = [];
afterEach(async () => {
    while (liveEngines.length) {
        try { await liveEngines.pop()?.destroy(); } catch { /* noop */ }
    }
});

interface Answer { status: number | undefined; code: unknown }
/** An answer with the text a caller reads its remedy from. */
interface Refusal extends Answer { message: string }

/** The `RestServer` route-handler double of a framework response. */
function makeRes() {
    const res: any = { statusCode: 200, body: undefined };
    res.status = (code: number) => { res.statusCode = code; return res; };
    res.json = (body: unknown) => { res.body = body; return res; };
    res.send = () => res;
    res.end = () => res;
    res.header = () => res;
    res.setHeader = () => {};
    res.write = () => true;
    return res;
}

async function boot() {
    const engine = new ObjectQL();
    liveEngines.push(engine);
    engine.registerDriver(new SqlDriver({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
    }), true);
    await engine.init();
    engine.registry.registerObject(SysMetadata as any, TEST_PACKAGE_ID);
    engine.registry.registerObject(SysMetadataHistoryObject as any, TEST_PACKAGE_ID);
    engine.registry.registerObject(SysMetadataAuditObject as any, TEST_PACKAGE_ID);
    await engine.syncSchemas();
    // Two installed, writable bases: no read-only manifest scope, and no code package booted them.
    engine.registry.installPackage({ id: ALPHA, name: ALPHA, namespace: 'alpha', version: '1.0.0', type: 'app' } as any, 'code');
    engine.registry.installPackage({ id: BETA, name: BETA, namespace: 'beta', version: '1.0.0', type: 'app' } as any, 'code');
    const protocol = new ObjectStackProtocolImplementation(engine as any);

    const flows = new Map<string, unknown>();
    const registerFlow = vi.fn((name: string, definition: unknown) => { flows.set(name, definition); return definition; });
    const unregisterFlow = vi.fn((name: string) => { flows.delete(name); });
    const getFlow = vi.fn(async (name: string) => flows.get(name) ?? null);
    const services: Record<string, unknown> = {
        protocol,
        automation: { handlerReady: true, registerFlow, unregisterFlow, getFlow },
    };
    const get = (name: string) => services[name] ?? null;
    const kernel: any = { context: { getService: get }, getService: get, getServiceAsync: async (name: string) => get(name) };
    const dispatcher = new HttpDispatcher(kernel);
    (dispatcher as any).timedResolveExecutionContext = async () => ({ ...AUTHOR });

    const call = async (method: string, path: string, body?: unknown, query: Record<string, string> = {}): Promise<Answer> => {
        const res = await dispatcher.dispatch(method, path, body, query, { request: { headers: {} } } as any);
        return { status: res.response?.status, code: res.response?.body?.error?.code };
    };
    /** The same request, answered with the text a caller reads its remedy from. */
    const refusal = async (method: string, path: string, body?: unknown): Promise<Refusal> => {
        const res = await dispatcher.dispatch(method, path, body, {}, { request: { headers: {} } } as any);
        const error = res.response?.body?.error;
        return { status: res.response?.status, code: error?.code, message: String(error?.message) };
    };

    // The `/meta` item routes `os serve` mounts, over the same protocol.
    const noop = () => {};
    const server = { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
    const rest: any = new RestServer(server as any, protocol as any, { api: { requireAuth: false } } as any);
    rest.resolveExecCtx = async () => ({ ...AUTHOR });
    rest.registerRoutes();
    /** `METHOD /api/v1/meta/:type/:name?package=` on `RestServer`, its handler called directly. */
    const restMeta = async (method: 'PUT' | 'DELETE', path: string, packageId: string, body?: unknown): Promise<Answer> => {
        const [type, name] = path.slice('/api/v1/meta/'.length).split('/');
        const route = rest.getRoutes().find((r: any) => r.method === method && r.path === '/api/v1/meta/:type/:name');
        if (!route) throw new Error(`${method} /api/v1/meta/:type/:name is not registered`);
        const res = makeRes();
        await route.handler({ method, path, params: { type, name }, headers: {}, query: { package: packageId }, body }, res);
        return { status: res.statusCode, code: res.body?.code ?? res.body?.error?.code };
    };
    /** The same `/meta` route on the dispatcher's own arm — the `@objectstack/hono` catch-all's transport. */
    const dispatcherMeta = (method: string, path: string, packageId: string, body?: unknown): Promise<Answer> =>
        call(method, path.slice('/api/v1'.length), body, { package: packageId });

    /** Every stored row of a flow, read back from the store, ordered by its package binding. */
    const rows = async (name: string): Promise<Array<Record<string, unknown>>> => {
        const found = (await engine.find('sys_metadata', {
            where: { type: 'flow', name },
            context: { isSystem: true },
        })) ?? [];
        return [...found]
            .map((row: any) => ({ ...row, package_id: row.package_id ?? null }))
            .sort((a, b) => String(a.package_id).localeCompare(String(b.package_id)));
    };
    const bindings = async (name: string) => (await rows(name)).map((row) => row.package_id);
    const labelIn = async (name: string, packageId: string | null) => {
        const row = (await rows(name)).find((r) => r.package_id === packageId);
        return row ? JSON.parse(String(row.metadata)).label : undefined;
    };

    /** The flow as the boot bind arms it: the first contender the protocol's execution view lists. */
    const armFromStore = async (name: string) => {
        const view: any = await protocol.getMetaItemsForExecution({ type: 'flow' });
        const list: any[] = (Array.isArray(view) ? view : view?.items ?? []).map((entry: any) => entry?.item ?? entry);
        const contenders = list.filter((item) => item?.name === name);
        flows.set(name, contenders[0]);
        return { armed: contenders[0], contenders };
    };

    return { call, refusal, restMeta, dispatcherMeta, rows, bindings, labelIn, armFromStore, flows, registerFlow, unregisterFlow };
}

type Rig = Awaited<ReturnType<typeof boot>>;

/** A flow name two packages hold, reached through the `/meta` door naming each package in turn. */
async function twoPackageFlow(order: readonly string[]): Promise<Rig> {
    const rig = await boot();
    for (const packageId of order) {
        const saved = await rig.call('PUT', `/meta/flow/${SHARED}`, flowOf(SHARED, `Saved into ${packageId}`), { package: packageId });
        expect(saved.status, `PUT /meta/flow/${SHARED}?package=${packageId}`).toBe(200);
    }
    return rig;
}

describe('[#23292] a flow one package holds, or none: the door\'s save lands in that one row', () => {
    it('PUT /:name of a flow one package holds saves to that package\'s row only, and mints no package-unbound row', async () => {
        const rig = await boot();
        expect((await rig.call('PUT', '/meta/flow/solo_flow', flowOf('solo_flow', 'Saved into alpha'), { package: ALPHA })).status).toBe(200);
        await rig.armFromStore('solo_flow');

        const answer = await rig.call('PUT', '/automation/solo_flow', flowOf('solo_flow', 'Edited at the door'));

        expect(answer.status).toBe(200);
        expect(await rig.bindings('solo_flow')).toEqual([ALPHA]);
        expect(await rig.labelIn('solo_flow', ALPHA)).toBe('Edited at the door');
    }, 60_000);

    it('POST / of a flow no package holds saves the package-unbound row', async () => {
        const rig = await boot();

        const answer = await rig.call('POST', '/automation', flowOf('plain_flow', 'Created at the door'));

        expect(answer.status).toBe(200);
        expect(await rig.bindings('plain_flow')).toEqual([null]);
        expect(await rig.labelIn('plain_flow', null)).toBe('Created at the door');
    }, 60_000);
});

for (const order of [[ALPHA, BETA], [BETA, ALPHA]] as const) {
    describe(`[#23292] a flow two packages hold (saved into ${order[0]}, then ${order[1]}): refused 409 at every call site`, () => {
        it('the two-package state is reachable through the /meta door, and the engine holds one contender\'s package stamp', async () => {
            const rig = await twoPackageFlow(order);
            expect(await rig.bindings(SHARED)).toEqual([ALPHA, BETA]);

            const { armed, contenders } = await rig.armFromStore(SHARED);
            // Both rows are contenders; the one armed is the first listed, so
            // its stamp names one package of the two. The other seed order
            // lists the other one first: the stamp is a pick, not an address.
            expect(contenders.map((item) => item._packageId).sort()).toEqual([ALPHA, BETA]);
            expect([ALPHA, BETA]).toContain(armed._packageId);
        }, 60_000);

        it('PUT /:name: 409 RESOURCE_CONFLICT, neither row changes, and the engine gets back the definition it held', async () => {
            const rig = await twoPackageFlow(order);
            const { armed } = await rig.armFromStore(SHARED);
            const before = await rig.rows(SHARED);
            const edited = flowOf(SHARED, 'Edited at the door');

            const answer = await rig.call('PUT', `/automation/${SHARED}`, edited);

            expect(answer).toEqual({ status: 409, code: 'RESOURCE_CONFLICT' });
            expect(await rig.rows(SHARED)).toEqual(before);
            // Registered first, then put back: the refusal came from the save.
            expect(rig.registerFlow.mock.calls.map(([, definition]) => definition)).toEqual([edited, armed]);
            expect(rig.flows.get(SHARED)).toBe(armed);
        }, 60_000);

        it('POST / onto the name the engine holds (an overwrite): 409, neither row changes, the held definition is back', async () => {
            const rig = await twoPackageFlow(order);
            const { armed } = await rig.armFromStore(SHARED);
            const before = await rig.rows(SHARED);

            const answer = await rig.call('POST', '/automation', flowOf(SHARED, 'Posted at the door'));

            expect(answer).toEqual({ status: 409, code: 'RESOURCE_CONFLICT' });
            expect(await rig.rows(SHARED)).toEqual(before);
            expect(rig.flows.get(SHARED)).toBe(armed);
        }, 60_000);

        it('POST / of the name while the engine holds none: 409, neither row changes, and the name is withdrawn', async () => {
            const rig = await twoPackageFlow(order);
            const before = await rig.rows(SHARED);

            const answer = await rig.call('POST', '/automation', flowOf(SHARED, 'Posted at the door'));

            expect(answer).toEqual({ status: 409, code: 'RESOURCE_CONFLICT' });
            expect(await rig.rows(SHARED)).toEqual(before);
            expect(rig.registerFlow).toHaveBeenCalledTimes(1);
            expect(rig.unregisterFlow).toHaveBeenCalledWith(SHARED);
            expect(rig.flows.has(SHARED)).toBe(false);
        }, 60_000);

        it('POST /:name/clone onto the name: 409, neither row changes, and the clone is withdrawn', async () => {
            const rig = await twoPackageFlow(order);
            rig.flows.set('source_flow', flowOf('source_flow', 'Source'));
            const before = await rig.rows(SHARED);

            const answer = await rig.call('POST', '/automation/source_flow/clone', { name: SHARED, label: 'The clone' });

            expect(answer).toEqual({ status: 409, code: 'RESOURCE_CONFLICT' });
            expect(await rig.rows(SHARED)).toEqual(before);
            expect(rig.unregisterFlow).toHaveBeenCalledWith(SHARED);
            expect(rig.flows.has(SHARED)).toBe(false);
        }, 60_000);
    });
}

/**
 * The `?package=` route a refusal prescribes, read out of its text the way a
 * caller reads it: the method, and the route to send it to.
 */
function printedPackageRoute(message: string): { method: string; path: string } {
    const printed = /\b(PUT|DELETE) (\/api\/v1\/[^\s?]+)\?package=/.exec(message);
    expect(printed, `a ?package= route in: ${message}`).not.toBeNull();
    return { method: printed![1]!, path: printed![2]! };
}

for (const order of [[ALPHA, BETA], [BETA, ALPHA]] as const) {
    describe(`[#23501] a flow two packages hold (saved into ${order[0]}, then ${order[1]}): the 409's remedy, followed as printed, does not loop`, () => {
        it('PUT /:name names the metadata door\'s PUT ?package=, which saves that package\'s row on both /meta transports', async () => {
            const rig = await twoPackageFlow(order);
            await rig.armFromStore(SHARED);
            const edited = flowOf(SHARED, 'Edited at the door');

            const answer = await rig.refusal('PUT', `/automation/${SHARED}`, edited);

            expect({ status: answer.status, code: answer.code }).toEqual({ status: 409, code: 'RESOURCE_CONFLICT' });
            const route = printedPackageRoute(answer.message);
            expect(route).toEqual({ method: 'PUT', path: `/api/v1/meta/flow/${SHARED}` });
            for (const packageId of [ALPHA, BETA]) expect(answer.message).toContain(`'${packageId}'`);
            // The remedy it replaced: this door reads no `?package=`, so the same save comes back the same 409.
            expect(await rig.call('PUT', `/automation/${SHARED}`, edited, { package: ALPHA }))
                .toEqual({ status: 409, code: 'RESOURCE_CONFLICT' });

            // Followed as printed, naming each package it states in turn.
            expect(await rig.restMeta(route.method as 'PUT', route.path, ALPHA, flowOf(SHARED, 'Saved through RestServer')))
                .toEqual({ status: 200, code: undefined });
            expect(await rig.dispatcherMeta(route.method, route.path, BETA, flowOf(SHARED, 'Saved through the dispatcher')))
                .toEqual({ status: 200, code: undefined });
            expect(await rig.bindings(SHARED)).toEqual([ALPHA, BETA]);
            expect(await rig.labelIn(SHARED, ALPHA)).toBe('Saved through RestServer');
            expect(await rig.labelIn(SHARED, BETA)).toBe('Saved through the dispatcher');
        }, 60_000);

        it('POST / names the same PUT ?package= route, which saves that package\'s row', async () => {
            const rig = await twoPackageFlow(order);

            const answer = await rig.refusal('POST', '/automation', flowOf(SHARED, 'Posted at the door'));

            expect({ status: answer.status, code: answer.code }).toEqual({ status: 409, code: 'RESOURCE_CONFLICT' });
            const route = printedPackageRoute(answer.message);
            expect(route).toEqual({ method: 'PUT', path: `/api/v1/meta/flow/${SHARED}` });
            for (const packageId of [ALPHA, BETA]) expect(answer.message).toContain(`'${packageId}'`);

            expect(await rig.restMeta(route.method as 'PUT', route.path, BETA, flowOf(SHARED, 'Posted, then saved')))
                .toEqual({ status: 200, code: undefined });
            expect(await rig.bindings(SHARED)).toEqual([ALPHA, BETA]);
            expect(await rig.labelIn(SHARED, BETA)).toBe('Posted, then saved');
        }, 60_000);

        it('POST /:name/clone answers the clone door\'s taken-name refusal, and the name it suggests clones', async () => {
            const rig = await twoPackageFlow(order);
            rig.flows.set('source_flow', flowOf('source_flow', 'Source'));
            const before = await rig.rows(SHARED);

            const answer = await rig.refusal('POST', '/automation/source_flow/clone', { name: SHARED, label: 'The clone' });

            expect({ status: answer.status, code: answer.code }).toEqual({ status: 409, code: 'RESOURCE_CONFLICT' });
            // A clone takes a NEW name (ADR-0126 §7.1): no package route is prescribed.
            expect(answer.message).not.toContain('?package=');
            const suggested = [...answer.message.matchAll(/'([a-z_][a-z0-9_]*)'/g)]
                .map((match) => match[1]!)
                .filter((candidate) => candidate !== SHARED);
            expect(suggested).toHaveLength(1);

            const followed = await rig.call('POST', '/automation/source_flow/clone', { name: suggested[0], label: 'The clone' });

            expect(followed).toEqual({ status: 200, code: undefined });
            expect(await rig.bindings(suggested[0]!)).toEqual([null]);
            expect(await rig.rows(SHARED)).toEqual(before);
        }, 60_000);

        it('DELETE /:name names the metadata door\'s DELETE ?package=, which removes that package\'s row and keeps the other', async () => {
            const rig = await twoPackageFlow(order);
            const { armed } = await rig.armFromStore(SHARED);

            const answer = await rig.refusal('DELETE', `/automation/${SHARED}`);

            expect({ status: answer.status, code: answer.code }).toEqual({ status: 409, code: 'RESOURCE_CONFLICT' });
            // Refused before anything changed: both rows stay, and the engine has its flow back.
            expect(await rig.bindings(SHARED)).toEqual([ALPHA, BETA]);
            expect(rig.flows.get(SHARED)).toBe(armed);
            const route = printedPackageRoute(answer.message);
            expect(route).toEqual({ method: 'DELETE', path: `/api/v1/meta/flow/${SHARED}` });
            for (const packageId of [ALPHA, BETA]) expect(answer.message).toContain(`'${packageId}'`);
            // The remedy it replaced: this door reads no `?package=`, so the same delete comes back the same 409.
            expect(await rig.call('DELETE', `/automation/${SHARED}`, undefined, { package: ALPHA }))
                .toEqual({ status: 409, code: 'RESOURCE_CONFLICT' });

            // Followed as printed, on the `/meta` transport that serves a delete.
            expect(await rig.restMeta(route.method as 'DELETE', route.path, ALPHA)).toEqual({ status: 200, code: undefined });
            expect(await rig.bindings(SHARED)).toEqual([BETA]);
        }, 60_000);
    });
}

/**
 * [#23501] The other half of the recognition: the door rewrites a store refusal
 * only when BOTH facts hold — the `RESOURCE_CONFLICT` / 409 envelope, and a
 * served flow list showing the name held by two or more packages. Otherwise
 * the store's refusal is relayed as it was thrown. A stub protocol here, so the
 * store's answer and the list's can disagree on purpose.
 */
describe('[#23501] a store refusal the list read does not confirm is relayed as it was thrown', () => {
    const THROWN = 'The store refused this write for its own reason.';

    function stubDoor(thrown: { code: string; status: number }, getMetaItems: () => Promise<unknown>) {
        const saveMetaItem = vi.fn(async () => { throw Object.assign(new Error(THROWN), thrown); });
        const deleteMetaItem = vi.fn(async () => { throw Object.assign(new Error(THROWN), thrown); });
        const listRead = vi.fn(getMetaItems);
        const flows = new Map<string, unknown>([[SHARED, flowOf(SHARED, 'Held')]]);
        const services: Record<string, unknown> = {
            protocol: { saveMetaItem, deleteMetaItem, getMetaItems: listRead },
            automation: {
                handlerReady: true,
                registerFlow: (name: string, definition: unknown) => { flows.set(name, definition); return definition; },
                unregisterFlow: (name: string) => { flows.delete(name); },
                getFlow: async (name: string) => flows.get(name) ?? null,
            },
        };
        const get = (name: string) => services[name] ?? null;
        const kernel: any = { context: { getService: get }, getService: get, getServiceAsync: async (name: string) => get(name) };
        const dispatcher = new HttpDispatcher(kernel);
        (dispatcher as any).timedResolveExecutionContext = async () => ({ ...AUTHOR });
        const send = async (method: string, path: string, body?: unknown): Promise<Refusal> => {
            const res = await dispatcher.dispatch(method, path, body, {}, { request: { headers: {} } } as any);
            const error = res.response?.body?.error;
            return { status: res.response?.status, code: error?.code, message: String(error?.message) };
        };
        return { send, listRead };
    }

    const oneListed = async () => ({ type: 'flow', items: [{ name: SHARED, _packageId: ALPHA }, { name: 'other_flow', _packageId: BETA }] });

    for (const [route, method, path, body] of [
        ['PUT /:name', 'PUT', `/automation/${SHARED}`, flowOf(SHARED, 'Edited')],
        ['DELETE /:name', 'DELETE', `/automation/${SHARED}`, undefined],
    ] as const) {
        it(`${route}: a 409 RESOURCE_CONFLICT whose name the list shows in one package only`, async () => {
            const door = stubDoor({ code: 'RESOURCE_CONFLICT', status: 409 }, oneListed);

            expect(await door.send(method, path, body)).toEqual({ status: 409, code: 'RESOURCE_CONFLICT', message: THROWN });
            expect(door.listRead).toHaveBeenCalledTimes(1);
        });

        it(`${route}: a 409 RESOURCE_CONFLICT whose list read fails`, async () => {
            const door = stubDoor({ code: 'RESOURCE_CONFLICT', status: 409 }, async () => { throw new Error('list read failed'); });

            expect(await door.send(method, path, body)).toEqual({ status: 409, code: 'RESOURCE_CONFLICT', message: THROWN });
        });

        it(`${route}: another envelope is never looked up`, async () => {
            const door = stubDoor({ code: 'METADATA_CONFLICT', status: 409 }, oneListed);

            expect(await door.send(method, path, body)).toEqual({ status: 409, code: 'METADATA_CONFLICT', message: THROWN });
            expect(door.listRead).not.toHaveBeenCalled();
        });
    }
});
