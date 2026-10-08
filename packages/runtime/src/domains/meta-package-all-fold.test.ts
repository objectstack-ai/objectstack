// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22188] `?package=all` names no package on every `/meta` door of both
 * hosts — `RestServer`'s routes and the runtime dispatcher's `/meta` domain,
 * the only answer on a host that mounts just `@objectstack/hono`'s
 * `${prefix}/*` catch-all.
 *
 * ## What was wrong
 *
 * `all` is the metadata list's "show everything" scope, and the empty value
 * states nothing. #22128 gave the item read, the save and the publish one
 * reading of `?package=` — `metaItemPackageBinding` (`@objectstack/rest`) —
 * under which both name no package. The other doors forwarded the raw value,
 * so `all` reached the store as a package id no item is bound to:
 *
 *  - `RestServer`: the layered read answered `404`, the list `[]`, the book
 *    tree the implicit book of a package called `all` (no declared book, no
 *    page), and the diagnostics sweep scanned nothing;
 *  - the dispatcher: the same layered read, list and book tree, the item read,
 *    and its `PUT`, which WROTE the row bound to the package `all`.
 *
 * Every door now reads `?package=` through that one function, so a request
 * naming `all` is answered as the same request naming nothing.
 *
 * ## The rig
 *
 * Each door gets its own REAL store — better-sqlite3 `:memory:`, the real
 * `sys_metadata*` objects, a real `ObjectStackProtocolImplementation` — seeded
 * through the protocol (not through either door), so both doors read the same
 * rows: a view stored in package `com.probe.pkg`, a view in a second package,
 * an env-local view, and a book and a page stored in `com.probe.pkg`.
 *
 *  - `RestServer`: its registered handlers, called with the request the
 *    `plugin-hono-server` adapter builds, the auth boundary (`resolveExecCtx`)
 *    stubbed — as `meta-save-preconditions-parity.test.ts` drives it;
 *  - the catch-all: {@link catchAll} repeats the catch-all's four statements
 *    over a real Fetch `Request` into the real `HttpDispatcher.dispatch()`
 *    (that file's header says why they are repeated rather than imported).
 *
 * Each row compares a door's answer to `?package=all` with the SAME door's
 * answer to the request without `?package=`, and keeps one control beside it:
 * a real package id still scopes.
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
/** The package the probed items are stored in. */
const PROBE_PKG = 'com.probe.pkg';
/** A second installed package: a real id that does not own the probed items. */
const OTHER_PKG = 'com.other.pkg';
/** An author: `manage_metadata` saves, on both doors. */
const AUTHOR = { userId: 'u_author', isSystem: false, systemPermissions: ['manage_metadata'] };

const TASK = {
    name: 'task',
    label: 'Task',
    fields: {
        id: { name: 'id', type: 'text' as const, primaryKey: true, label: 'ID' },
        name: { name: 'name', type: 'text' as const, label: 'Name' },
    },
};

const view = (name: string, label: string) => ({
    name,
    label,
    object: 'task',
    viewKind: 'list',
    columns: [{ field: 'name', label: 'Name' }],
});

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

const liveEngines: ObjectQL[] = [];
afterEach(async () => {
    while (liveEngines.length) {
        try { await liveEngines.pop()?.destroy(); } catch { /* noop */ }
    }
});

/** One real store, seeded through the protocol: the rows every door below reads. */
async function bootStore() {
    const engine = new ObjectQL();
    liveEngines.push(engine);
    engine.registerDriver(new SqlDriver({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
    }), true);
    await engine.init();
    engine.registry.registerObject(TASK as any, TEST_PACKAGE_ID);
    engine.registry.registerObject(SysMetadata as any, TEST_PACKAGE_ID);
    engine.registry.registerObject(SysMetadataHistoryObject as any, TEST_PACKAGE_ID);
    engine.registry.registerObject(SysMetadataAuditObject as any, TEST_PACKAGE_ID);
    await engine.syncSchemas();
    const protocol = new ObjectStackProtocolImplementation(engine as any);
    const seed = (type: string, name: string, item: unknown, packageId?: string) =>
        protocol.saveMetaItem({ type, name, item, ...(packageId ? { packageId } : {}) } as any);
    await seed('view', 'case_grid', view('case_grid', 'live'), PROBE_PKG);
    await seed('view', 'other_grid', view('other_grid', 'other'), OTHER_PKG);
    await seed('view', 'local_grid', view('local_grid', 'local'));
    await seed('book', 'probe_book', {
        name: 'probe_book', label: 'Probe Book', groups: [{ key: 'pages', label: 'Pages', include: 'probe_*' }],
    }, PROBE_PKG);
    await seed('doc', 'probe_page', { name: 'probe_page', label: 'Probe page', content: 'Hello.' }, PROBE_PKG);
    /** The stored package binding of each row of a view — the store, not the door's word for it. */
    const boundTo = async (name: string): Promise<Array<string | null>> => {
        const rows = await engine.find('sys_metadata', { where: { type: 'view', name } });
        return (rows ?? []).map((r: any) => r.package_id ?? null);
    };
    return { protocol, boundTo };
}

// ── The two doors ─────────────────────────────────────────────────────────────

interface Answer { status: number; code?: string; data?: any }
interface Door {
    read(path: string, query?: Record<string, string>): Promise<Answer>;
    put(path: string, item: unknown, query?: Record<string, string>): Promise<Answer>;
    boundTo(name: string): Promise<Array<string | null>>;
}

/** The refusal's `code` in either door's envelope: nested under `error`, or beside a string `error`. */
const codeOf = (body: any): string | undefined =>
    body?.error && typeof body.error === 'object' ? body.error.code : body?.code;

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

/** `RestServer`'s route for a path below `/meta`, and the params the adapter would hand it. */
function restRouteOf(path: string): { route: string; params: Record<string, string> } {
    const s = path.replace(/^\/meta\//, '').split('/');
    if (s.length === 1 && s[0] === 'diagnostics') return { route: `${META}/diagnostics`, params: {} };
    if (s.length === 3 && s[0] === 'book' && s[2] === 'tree') return { route: `${META}/book/:name/tree`, params: { name: s[1] } };
    if (s.length === 3 && s[2] === 'layers') return { route: `${META}/:type/:name/layers`, params: { type: s[0], name: s[1] } };
    if (s.length === 2) return { route: `${META}/:type/:name`, params: { type: s[0], name: s[1] } };
    if (s.length === 1) return { route: `${META}/:type`, params: { type: s[0] } };
    throw new Error(`no RestServer route for ${path}`);
}

async function bootRestServer(): Promise<Door> {
    const { protocol, boundTo } = await bootStore();
    const noop = () => {};
    const server = { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
    const rest: any = new RestServer(server as any, protocol as any, { api: { requireAuth: false } } as any);
    rest.resolveExecCtx = async () => clone(AUTHOR);
    rest.registerRoutes();
    const drive = async (method: string, path: string, query: Record<string, string>, body?: unknown): Promise<Answer> => {
        const { route, params } = restRouteOf(path);
        const entry = rest.getRoutes().find((r: any) => r.method === method && r.path === route);
        if (!entry) throw new Error(`${method} ${route} is not registered`);
        const res = makeRes();
        await entry.handler({ method, path: `${PREFIX}${path}`, params, query: { ...query }, headers: {}, body }, res);
        return { status: res.statusCode, code: codeOf(res.body), data: res.statusCode === 200 ? res.body : undefined };
    };
    return {
        boundTo,
        read: (path, query = {}) => drive('GET', path, query),
        put: (path, item, query = {}) => drive('PUT', path, query, item),
    };
}

/**
 * What `createHonoApp`'s `${prefix}/*` catch-all hands `dispatch()`, statement
 * for statement: the path below the prefix, a JSON body for `POST` / `PUT` /
 * `PATCH`, the query flattened from the URL, and the raw Fetch `Request` as
 * `context.request`.
 */
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
    // The seam `dispatch()` resolves identity through (the sibling
    // dispatch-level pins supply the principal the same way).
    (dispatcher as any).timedResolveExecutionContext = async () => clone(AUTHOR);
    const drive = async (method: string, path: string, query: Record<string, string>, item?: unknown): Promise<Answer> => {
        const url = new URL(`http://localhost${PREFIX}${path}`);
        for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
        const raw = new Request(url, {
            method,
            headers: { 'content-type': 'application/json' },
            ...(item !== undefined ? { body: JSON.stringify(item) } : {}),
        });
        const res = await catchAll(dispatcher, raw);
        const body = res.response?.body;
        const status = res.response?.status ?? 0;
        return { status, code: codeOf(body), data: status === 200 ? body?.data : undefined };
    };
    return {
        boundTo,
        read: (path, query = {}) => drive('GET', path, query),
        put: (path, item, query = {}) => drive('PUT', path, query, item),
    };
}

const DOORS: ReadonlyArray<readonly [string, () => Promise<Door>]> = [
    ['RestServer', bootRestServer],
    ['the @objectstack/hono catch-all', bootCatchAll],
];

/** The names a list answer serves, in either door's body (a bare array or `{ items }`). */
const namesOf = (data: any): string[] =>
    (Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : []).map((i: any) => i?.name).sort();
const served = (a: Answer) => {
    expect(a.status, JSON.stringify(a).slice(0, 400)).toBe(200);
    return a.data;
};

// ── Each door, on each host ───────────────────────────────────────────────────

for (const [doorName, boot] of DOORS) {
    describe(`[#22188] ${doorName}: ?package=all names no package`, () => {
        it('the layered read: ?package=all serves the layers the plain read serves; a real package id still scopes', async () => {
            const door = await boot();
            const plain = served(await door.read('/meta/view/case_grid/layers'));
            expect(plain.overlay?.label).toBe('live');
            expect(served(await door.read('/meta/view/case_grid/layers', { package: 'all' }))).toEqual(plain);
            // Control: the owning package resolves the same layers; another
            // package's id finds no such item there — the answer `all` got.
            expect(served(await door.read('/meta/view/case_grid/layers', { package: PROBE_PKG }))).toEqual(plain);
            const other = await door.read('/meta/view/case_grid/layers', { package: OTHER_PKG });
            expect({ status: other.status, code: other.code }).toEqual({ status: 404, code: 'RESOURCE_NOT_FOUND' });
        }, 60_000);

        it('the list: ?package=all lists what the plain list lists — every package\'s items and the env-local ones', async () => {
            const door = await boot();
            const plain = namesOf(served(await door.read('/meta/view')));
            // "No package" is "show everything" here: the plain list already
            // spans both packages and the env-local overlay.
            expect(plain).toEqual(expect.arrayContaining(['case_grid', 'other_grid', 'local_grid']));
            expect(namesOf(served(await door.read('/meta/view', { package: 'all' })))).toEqual(plain);
            // Control: a real package id still scopes the list to that package's items.
            expect(namesOf(served(await door.read('/meta/view', { package: PROBE_PKG })))).toEqual(['case_grid']);
            expect(namesOf(served(await door.read('/meta/view', { package: OTHER_PKG })))).toEqual(['other_grid']);
        }, 60_000);

        it('the book tree: ?package=all resolves the declared book the plain read resolves; a real package id still scopes', async () => {
            const door = await boot();
            const plain = served(await door.read('/meta/book/probe_book/tree'));
            expect(plain.label).toBe('Probe Book');
            expect(JSON.stringify(plain)).toContain('probe_page');
            expect(served(await door.read('/meta/book/probe_book/tree', { package: 'all' }))).toEqual(plain);
            // Control: the owning package resolves the same book; another
            // package's scope holds no such book, so the name falls to that
            // scope's implicit book (ADR-0046 §6.4) — no declared label, no
            // page — the answer `all` got.
            expect(served(await door.read('/meta/book/probe_book/tree', { package: PROBE_PKG }))).toEqual(plain);
            const other = served(await door.read('/meta/book/probe_book/tree', { package: OTHER_PKG }));
            expect(other.label).toBe('probe_book');
            expect(JSON.stringify(other)).not.toContain('probe_page');
        }, 60_000);

        it('the item read: ?package=all serves the item the plain read serves', async () => {
            const door = await boot();
            const plain = served(await door.read('/meta/view/case_grid'));
            expect(plain.item?.label).toBe('live');
            expect(served(await door.read('/meta/view/case_grid', { package: 'all' })).item).toEqual(plain.item);
        }, 60_000);

        it('the draft read: ?state=draft&package=all serves the draft ?state=draft serves', async () => {
            const door = await boot();
            // A draft saved naming no package inherits the package of the
            // item's active row (#11087): the draft the Studio editor reads
            // back with its raw router `?package=`.
            served(await door.put('/meta/view/case_grid', view('case_grid', 'staged'), { mode: 'draft' }));
            const plain = served(await door.read('/meta/view/case_grid', { state: 'draft' }));
            expect(plain.item?.label).toBe('staged');
            expect(served(await door.read('/meta/view/case_grid', { state: 'draft', package: 'all' })).item).toEqual(plain.item);
        }, 60_000);

        it('the save: PUT ?package=all writes the env-local row, as a save naming no package does; a real package id still binds', async () => {
            const door = await boot();
            served(await door.put('/meta/view/fresh_grid', view('fresh_grid', 'unscoped'), { package: 'all' }));
            expect(await door.boundTo('fresh_grid')).toEqual([null]);
            // Control: the owning package binds the row.
            served(await door.put('/meta/view/bound_grid', view('bound_grid', 'bound'), { package: PROBE_PKG }));
            expect(await door.boundTo('bound_grid')).toEqual([PROBE_PKG]);
        }, 60_000);
    });
}

// ── RestServer's diagnostics sweep ────────────────────────────────────────────

/**
 * `GET /meta/diagnostics` hands its `?package=` to the list read of every type
 * it sweeps, so it reads it the way the list does. The dispatcher serves no
 * such route.
 */
describe('[#22188] RestServer: GET /meta/diagnostics?package=all sweeps what the plain sweep sweeps', () => {
    it('the same items scanned and the same packages seen; a real package id still scopes', async () => {
        const door = await bootRestServer();
        const plain = served(await door.read('/meta/diagnostics', { type: 'view' }));
        expect(plain.scannedItems).toBeGreaterThanOrEqual(3);
        expect(plain.stats?.view?.packages).toEqual(expect.arrayContaining([PROBE_PKG, OTHER_PKG]));
        const all = served(await door.read('/meta/diagnostics', { type: 'view', package: 'all' }));
        expect({ scannedItems: all.scannedItems, stats: all.stats }).toEqual({ scannedItems: plain.scannedItems, stats: plain.stats });
        // Control: a real package id still scopes the sweep.
        const scoped = served(await door.read('/meta/diagnostics', { type: 'view', package: PROBE_PKG }));
        expect(scoped.scannedItems).toBeLessThan(plain.scannedItems);
    }, 60_000);
});
