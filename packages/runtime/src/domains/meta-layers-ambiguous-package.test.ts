// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28337, ADR-0048] The layered view naming no package, of a name two
 * packages hold, answers the package-less writes' refusal — on BOTH transports
 * and both spellings.
 *
 * With a name's active rows bound to two packages, a `PUT` or `DELETE
 * /meta/:type/:name` naming no package is refused `409 RESOURCE_CONFLICT`,
 * naming the holders, with the `?package=` prescription. The layered view —
 * `GET /meta/:type/:name/layers` and the deprecated `?layers=true` — answered
 * the same request `200` with one holder's overlay, picked silently. Both
 * transports hand the layered answer to ONE chain (`createMetaLayeredAnswer`
 * in `@objectstack/rest`), whose step 1c now asks the protocol's judge
 * (`packagelessLayeredReadRefusal`) and throws its refusal to the transport's
 * catch: the same catch, on each transport, its own save door answers that
 * refusal through. So each door's read answer is compared with the SAME
 * door's write answer, status, code and envelope keys.
 *
 * ## The rig
 *
 * `meta-package-all-fold.test.ts`'s: each door gets its own REAL store —
 * better-sqlite3 `:memory:`, the real `sys_metadata*` objects, a real
 * `ObjectStackProtocolImplementation` — seeded through the protocol, not
 * through either door; `RestServer`'s registered handlers with the auth
 * boundary stubbed, and the catch-all's four statements over a real Fetch
 * `Request` into the real `HttpDispatcher.dispatch()`.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SysMetadata, SysMetadataHistoryObject, SysMetadataAuditObject } from '@objectstack/platform-objects/metadata';
import { RestServer } from '@objectstack/rest';
import { HttpDispatcher } from '../http-dispatcher.js';

const PREFIX = '/api/v1';
const META = `${PREFIX}/meta`;
/** `registry.registerObject` requires a package id (see the sibling real-stack tests). */
const TEST_PACKAGE_ID = 'objectstack-test';
const PKG_A = 'com.alpha.pkg';
const PKG_B = 'com.beta.pkg';
/** An author: `manage_metadata` saves and deletes, on both doors. */
const AUTHOR = { userId: 'u_author', isSystem: false, systemPermissions: ['manage_metadata'] };

const dashboard = (name: string, label: string) => ({ name, label, widgets: [] });
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

const liveEngines: ObjectQL[] = [];
afterEach(async () => {
    while (liveEngines.length) {
        try { await liveEngines.pop()?.destroy(); } catch { /* noop */ }
    }
});

/** One real store: `twin_dash` stored in both packages, `solo_dash` in one. */
async function bootStore() {
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
    for (const id of [PKG_A, PKG_B]) {
        engine.registry.installPackage({ id, name: id, version: '1.0.0' } as any, 'authored');
    }
    const protocol = new ObjectStackProtocolImplementation(engine as any);
    const seed = (name: string, label: string, packageId: string) =>
        protocol.saveMetaItem({ type: 'dashboard', name, item: dashboard(name, label), packageId } as any);
    await seed('twin_dash', 'alpha copy', PKG_A);
    await seed('twin_dash', 'beta copy', PKG_B);
    await seed('solo_dash', 'solo', PKG_A);
    /** The stored package binding of each row of a dashboard: the store, not a door's word for it. */
    const boundTo = async (name: string): Promise<Array<string | null>> => {
        const rows = await engine.find('sys_metadata', { where: { type: 'dashboard', name } });
        return (rows ?? []).map((r: any) => r.package_id ?? null).sort();
    };
    return { protocol, boundTo };
}

interface Answer { status: number; body: any }
interface Door {
    send(method: 'GET' | 'PUT' | 'DELETE', path: string, query?: Record<string, string>, item?: unknown): Promise<Answer>;
    boundTo(name: string): Promise<Array<string | null>>;
}

function makeRes() {
    const res: any = { statusCode: 200, body: undefined, headers: {} as Record<string, string> };
    res.status = (code: number) => { res.statusCode = code; return res; };
    res.json = (body: any) => { res.body = body; return res; };
    res.send = () => res;
    res.end = () => res;
    res.header = (k: string, v: string) => { res.headers[k] = v; return res; };
    res.setHeader = () => {};
    res.write = () => true;
    return res;
}

async function bootRestServer(): Promise<Door> {
    const { protocol, boundTo } = await bootStore();
    const noop = () => {};
    const server = { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
    const rest: any = new RestServer(server as any, protocol as any, { api: { requireAuth: false } } as any);
    rest.resolveExecCtx = async () => clone(AUTHOR);
    rest.registerRoutes();
    return {
        boundTo,
        send: async (method, path, query = {}, item) => {
            const s = path.replace(/^\/meta\//, '').split('/');
            const layered = s.length === 3 && s[2] === 'layers';
            const route = layered ? `${META}/:type/:name/layers` : `${META}/:type/:name`;
            const entry = rest.getRoutes().find((r: any) => r.method === method && r.path === route);
            if (!entry) throw new Error(`${method} ${route} is not registered`);
            const res = makeRes();
            await entry.handler({
                method, path: `${PREFIX}${path}`, params: { type: s[0], name: s[1] }, query: { ...query }, headers: {}, body: item ?? {},
            }, res);
            return { status: res.statusCode, body: res.body };
        },
    };
}

/** The catch-all's four statements (see `meta-package-all-fold.test.ts`). */
async function catchAll(dispatcher: HttpDispatcher, raw: Request) {
    const subPath = new URL(raw.url).pathname.substring(PREFIX.length);
    const method = raw.method;
    let body: any = undefined;
    if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
        body = await raw.clone().json().catch(() => ({}));
    }
    const queryParams: Record<string, any> = {};
    new URL(raw.url).searchParams.forEach((val, key) => { queryParams[key] = val; });
    return dispatcher.dispatch(method, subPath, body, queryParams, { request: raw }, PREFIX);
}

async function bootCatchAll(): Promise<Door> {
    const { protocol, boundTo } = await bootStore();
    const get = (n: string) => (n === 'protocol' ? protocol : null);
    const kernel: any = { context: { getService: get }, getService: get, getServiceAsync: async (n: string) => get(n) };
    const dispatcher = new HttpDispatcher(kernel);
    (dispatcher as any).timedResolveExecutionContext = async () => clone(AUTHOR);
    return {
        boundTo,
        send: async (method, path, query = {}, item) => {
            const url = new URL(`http://localhost${PREFIX}${path}`);
            for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
            const raw = new Request(url, {
                method,
                headers: { 'content-type': 'application/json' },
                ...(item !== undefined ? { body: JSON.stringify(item) } : {}),
            });
            const res = await catchAll(dispatcher, raw);
            return { status: res.response?.status ?? 0, body: res.response?.body };
        },
    };
}

const DOORS: ReadonlyArray<readonly [string, () => Promise<Door>]> = [
    ['RestServer', bootRestServer],
    ['the @objectstack/hono catch-all', bootCatchAll],
];

/** The refusal's `code` in either door's envelope: nested under `error`, or beside a string `error`. */
const codeOf = (body: any): string | undefined =>
    body?.error && typeof body.error === 'object' ? body.error.code : body?.code;
const messageOf = (body: any): string => {
    const m = body?.error && typeof body.error === 'object' ? body.error.message : body?.error ?? body?.message;
    return typeof m === 'string' ? m : '';
};
/** The served layers: `RestServer` answers bare, the dispatcher under `data`. */
const layersOf = (a: Answer) => {
    expect(a.status, JSON.stringify(a.body).slice(0, 400)).toBe(200);
    return a.body?.data ?? a.body;
};
/** The two spellings of the layered view. */
const SPELLINGS: ReadonlyArray<readonly [string, (name: string) => [string, Record<string, string>]]> = [
    ['/layers', (name) => [`/meta/dashboard/${name}/layers`, {}]],
    ['?layers=true', (name) => [`/meta/dashboard/${name}`, { layers: 'true' }]],
];

for (const [doorName, boot] of DOORS) {
    describe(`[#28337] ${doorName}: the layered view of a name two packages hold`, () => {
        it('naming no package, both spellings answer the package-less save\'s and delete\'s own 409', async () => {
            const door = await boot();
            const save = await door.send('PUT', '/meta/dashboard/twin_dash', {}, dashboard('twin_dash', 'edited'));
            const remove = await door.send('DELETE', '/meta/dashboard/twin_dash');
            expect([save.status, codeOf(save.body)], JSON.stringify(save.body)).toEqual([409, 'RESOURCE_CONFLICT']);
            expect([remove.status, codeOf(remove.body)], JSON.stringify(remove.body)).toEqual([409, 'RESOURCE_CONFLICT']);
            for (const [spelling, at] of SPELLINGS) {
                const [path, query] = at('twin_dash');
                const read = await door.send('GET', path, query);
                expect([read.status, codeOf(read.body)], `${spelling}: ${JSON.stringify(read.body)}`)
                    .toEqual([save.status, codeOf(save.body)]);
                // The same envelope this door wraps the writes' refusal in.
                const keys = (b: any) => Object.keys(b ?? {}).sort();
                expect(keys(read.body), spelling).toEqual(keys(save.body));
                if (read.body?.error && typeof read.body.error === 'object') {
                    expect(keys(read.body.error), spelling).toEqual(keys(save.body.error));
                }
                const message = messageOf(read.body);
                expect(message.startsWith('Name the package this layered read is for, then send it again'), message).toBe(true);
                expect(message, spelling).toContain('?package=');
                expect(message, spelling).toContain(`'${PKG_A}'`);
                expect(message, spelling).toContain(`'${PKG_B}'`);
                expect(JSON.stringify(read.body), spelling).not.toMatch(/alpha copy|beta copy/);
            }
            // Nothing was written or removed by any of it.
            expect(await door.boundTo('twin_dash')).toEqual([PKG_A, PKG_B]);
        }, 60_000);

        it('?package= reads each holder\'s stack; a name one package holds answers as before', async () => {
            const door = await boot();
            for (const [spelling, at] of SPELLINGS) {
                for (const [pkg, label] of [[PKG_A, 'alpha copy'], [PKG_B, 'beta copy']] as const) {
                    const [path, query] = at('twin_dash');
                    const layers = layersOf(await door.send('GET', path, { ...query, package: pkg }));
                    expect(layers.overlay, `${spelling} ${pkg}`).toMatchObject({ name: 'twin_dash', label });
                    expect(layers.effective, `${spelling} ${pkg}`).toMatchObject({ name: 'twin_dash', label });
                }
                const [soloPath, soloQuery] = at('solo_dash');
                const solo = layersOf(await door.send('GET', soloPath, soloQuery));
                expect(solo.effective, spelling).toMatchObject({ name: 'solo_dash', label: 'solo' });
                expect(layersOf(await door.send('GET', soloPath, { ...soloQuery, package: PKG_A })), spelling).toEqual(solo);
            }
        }, 60_000);
    });
}
