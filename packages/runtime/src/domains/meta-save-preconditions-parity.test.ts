// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22141] Both doors of `PUT /meta/:type/:name` honour the save's precondition
 * and lifecycle alike — `RestServer`'s route and the runtime dispatcher's
 * `/meta` domain, the only answer on a host that mounts just
 * `@objectstack/hono`'s `${prefix}/*` catch-all.
 *
 * ## What was wrong
 *
 * The dispatcher's `PUT` branch handed `saveMetaItem` no `parentVersion` and
 * no `mode`. Through the catch-all, a stale `If-Match` wrote (`200`, not
 * `409`), `If-None-Match: *` over an existing row wrote, and a `?mode=draft`
 * save landed ACTIVE — a draft live without a publish — each answered `200`.
 * Both doors now read the request through ONE mapping,
 * `metaSaveRequestOptions` (`@objectstack/rest`), and these rows hold the two
 * to the same answer over the same cases: the store, not the door's word for
 * it, is read after every write.
 *
 * ## The rig
 *
 * Each door gets its own REAL store — better-sqlite3 `:memory:`, the real
 * `sys_metadata*` objects, a real `ObjectStackProtocolImplementation` — so the
 * claim is about what each request DID to the rows:
 *
 *  - `RestServer`: its registered `PUT` handler, called with the request the
 *    `plugin-hono-server` adapter builds (a lowercased header record), the
 *    auth boundary (`resolveExecCtx`) stubbed, as
 *    `meta-item-version-token-occ.test.ts` drives it;
 *  - the catch-all: {@link catchAll} repeats the catch-all's four statements
 *    over a real Fetch `Request` — the path below the prefix, the JSON body of
 *    a write verb, the query flattened from the URL's `searchParams`, and
 *    `{ request }` the raw `Request` itself, whose `Headers` is where the pins
 *    ride — into the real `HttpDispatcher.dispatch()`. The identity step is
 *    the one stubbed seam, as in the sibling dispatch-level pins.
 *
 * ⚠️ Why the catch-all's statements are repeated here rather than imported:
 * this package cannot import `@objectstack/hono` (that package depends on this
 * one), and `packages/adapters/hono`'s suite aliases `@objectstack/runtime` to
 * a stub, so no test there reaches the real dispatcher. What `catchAll` hands
 * `dispatch()` is what the adapter hands it, argument for argument.
 *
 * Each door answers in its own envelope — the dispatcher nests `code` under
 * `error` beside `success: false`; `RestServer`'s `409` is the flat
 * `MetadataConflictErrorSchema` dialect and its `400` nests — so a refusal is
 * read through {@link codeOf}, and the parity asserted is status, `code` and
 * the store, never the envelope's bytes.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
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

/** One real store: the engine, the metadata objects, and the protocol over them. */
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
    /** The stored labels of a view, by lifecycle — the store, not the door's word for it. */
    const stored = async (name: string, state: 'active' | 'draft'): Promise<string[]> => {
        const rows = await engine.find('sys_metadata', { where: { type: 'view', name, state } });
        return (rows ?? []).map((r: any) => JSON.parse(String(r.metadata)).label as string);
    };
    return { protocol, stored };
}

// ── The two doors ─────────────────────────────────────────────────────────────

interface Answer { status: number; code?: string; message?: string; receipt?: any }
interface SaveOptions { headers?: Record<string, string>; query?: Record<string, string> }
interface Door {
    save(name: string, label: string, opts?: SaveOptions): Promise<Answer>;
    stored(name: string, state: 'active' | 'draft'): Promise<string[]>;
}

/** The refusal's `code` in either door's envelope: nested under `error`, or beside a string `error`. */
const codeOf = (body: any): string | undefined =>
    body?.error && typeof body.error === 'object' ? body.error.code : body?.code;
const messageOf = (body: any): string | undefined =>
    body?.error && typeof body.error === 'object' ? body.error.message : body?.error;

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
    const { protocol, stored } = await bootStore();
    const noop = () => {};
    const server = { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
    const rest: any = new RestServer(server as any, protocol as any, { api: { requireAuth: false } } as any);
    rest.resolveExecCtx = async () => clone(AUTHOR);
    rest.registerRoutes();
    const route = rest.getRoutes().find((r: any) => r.method === 'PUT' && r.path === `${META}/:type/:name`);
    if (!route) throw new Error(`PUT ${META}/:type/:name is not registered`);
    return {
        stored,
        save: async (name, label, { headers = {}, query = {} } = {}) => {
            const res = makeRes();
            await route.handler({
                method: 'PUT', path: `${META}/view/${name}`, params: { type: 'view', name },
                // The adapter's header record is lowercased (`c.req.header()`).
                headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])),
                query, body: view(name, label),
            }, res);
            return { status: res.statusCode, code: codeOf(res.body), message: messageOf(res.body), receipt: res.body };
        },
    };
}

/**
 * What `createHonoApp`'s `${prefix}/*` catch-all hands `dispatch()`, statement
 * for statement: the path below the prefix, a JSON body for `POST` / `PUT` /
 * `PATCH` (an unparseable one folded to `{}`), the query flattened from the
 * URL, and the raw Fetch `Request` as `context.request`.
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

function dispatcherOver(services: Record<string, unknown>): HttpDispatcher {
    const get = (n: string) => services[n] ?? null;
    const kernel: any = { context: { getService: get }, getService: get, getServiceAsync: async (n: string) => get(n) };
    const dispatcher = new HttpDispatcher(kernel);
    // The seam `dispatch()` resolves identity through (the sibling
    // dispatch-level pins supply the principal the same way).
    (dispatcher as any).timedResolveExecutionContext = async () => clone(AUTHOR);
    return dispatcher;
}

const putRequest = (name: string, label: string, { headers = {}, query = {} }: SaveOptions = {}) => {
    const url = new URL(`http://localhost${META}/view/${name}`);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    return new Request(url, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(view(name, label)),
    });
};

async function bootCatchAll(): Promise<Door> {
    const { protocol, stored } = await bootStore();
    const dispatcher = dispatcherOver({ protocol });
    return {
        stored,
        save: async (name, label, opts = {}) => {
            const res = await catchAll(dispatcher, putRequest(name, label, opts));
            const body = res.response?.body;
            return { status: res.response?.status ?? 0, code: codeOf(body), message: messageOf(body), receipt: body?.data };
        },
    };
}

const DOORS: ReadonlyArray<readonly [string, () => Promise<Door>]> = [
    ['RestServer', bootRestServer],
    ['the @objectstack/hono catch-all', bootCatchAll],
];

const ok = (a: Answer) => {
    expect(a.status, JSON.stringify(a)).toBe(200);
    return a.receipt;
};

// ── The four cases, on each door ──────────────────────────────────────────────

for (const [doorName, boot] of DOORS) {
    describe(`[#22141] ${doorName}: PUT /meta/:type/:name honours If-Match, If-None-Match and ?mode=draft`, () => {
        it('control: an unguarded save writes the active row, and the last writer wins', async () => {
            const door = await boot();
            expect(ok(await door.save('case_grid', 'v1')).state).toBe('active');
            expect(ok(await door.save('case_grid', 'v2')).state).toBe('active');
            expect(await door.stored('case_grid', 'active')).toEqual(['v2']);
            expect(await door.stored('case_grid', 'draft')).toEqual([]);
        }, 60_000);

        it('a stale If-Match is refused 409 METADATA_CONFLICT and writes nothing; the current token saves', async () => {
            const door = await boot();
            const first = ok(await door.save('case_grid', 'v1'));
            const second = ok(await door.save('case_grid', 'v2'));
            expect(second.version).not.toBe(first.version);

            const stale = await door.save('case_grid', 'v3 over a stale read', { headers: { 'If-Match': first.version } });
            expect({ status: stale.status, code: stale.code }).toEqual({ status: 409, code: 'METADATA_CONFLICT' });
            expect(await door.stored('case_grid', 'active')).toEqual(['v2']);

            // Preservation: the token the last receipt served still pins a save.
            ok(await door.save('case_grid', 'v3', { headers: { 'If-Match': second.version } }));
            expect(await door.stored('case_grid', 'active')).toEqual(['v3']);
        }, 60_000);

        it('If-None-Match: * writes the first row, and over an existing row is refused 409 and writes nothing', async () => {
            const door = await boot();
            ok(await door.save('fresh_grid', 'first', { headers: { 'If-None-Match': '*' } }));
            expect(await door.stored('fresh_grid', 'active')).toEqual(['first']);

            const again = await door.save('fresh_grid', 'second', { headers: { 'If-None-Match': '*' } });
            expect({ status: again.status, code: again.code }).toEqual({ status: 409, code: 'METADATA_CONFLICT' });
            expect(await door.stored('fresh_grid', 'active')).toEqual(['first']);
        }, 60_000);

        it('?mode=draft stages a draft and leaves the active row untouched', async () => {
            const door = await boot();
            ok(await door.save('case_grid', 'live'));

            const draft = ok(await door.save('case_grid', 'staged', { query: { mode: 'draft' } }));
            expect(draft.state).toBe('draft');
            expect(await door.stored('case_grid', 'active')).toEqual(['live']);
            expect(await door.stored('case_grid', 'draft')).toEqual(['staged']);
        }, 60_000);

        it('a pin that can never be honoured is refused 400 VALIDATION_ERROR and writes nothing', async () => {
            const door = await boot();
            const unhonourable: Array<Record<string, string>> = [
                { 'If-Match': 'any-token', 'If-None-Match': '*' },
                { 'If-None-Match': 'W/"an-entity-tag"' },
            ];
            for (const headers of unhonourable) {
                const refused = await door.save('case_grid', 'never', { headers });
                expect({ status: refused.status, code: refused.code }, JSON.stringify(headers)).toEqual({ status: 400, code: 'VALIDATION_ERROR' });
            }
            expect(await door.stored('case_grid', 'active')).toEqual([]);
            expect(await door.stored('case_grid', 'draft')).toEqual([]);
        }, 60_000);
    });
}

// ── The same refusal, side by side ────────────────────────────────────────────

describe('[#22141] the two doors refuse a stale token with the same status, code and sentence', () => {
    it('one conflict, two envelopes: 409, METADATA_CONFLICT, and one refusal sentence', async () => {
        const answers: Answer[] = [];
        for (const [, boot] of DOORS) {
            const door = await boot();
            const first = ok(await door.save('case_grid', 'v1'));
            ok(await door.save('case_grid', 'v2'));
            answers.push(await door.save('case_grid', 'v3', { headers: { 'If-Match': first.version } }));
        }
        const [rest, catchAllAnswer] = answers;
        expect({ status: catchAllAnswer.status, code: catchAllAnswer.code }).toEqual({ status: rest.status, code: rest.code });
        // Each store mints its own version tokens, so the sentences are compared with the token masked.
        const masked = (m: string | undefined) => (m ?? '').replace(/hmac-sha256:[0-9a-f]+/g, 'TOKEN');
        expect(masked(catchAllAnswer.message)).toBe(masked(rest.message));
    }, 60_000);
});

// ── The dispatcher's fallback writer ──────────────────────────────────────────

/**
 * The dispatcher alone has a second writer: a host whose `protocol` brings no
 * `saveMetaItem` falls to the metadata service's `saveItem(type, name, item)`,
 * which takes neither a precondition nor a lifecycle. A caller who asked for
 * one is refused `501` — the answer `RestServer` gives any save its protocol
 * cannot take — never written unguarded or active.
 */
describe('[#22141] the catch-all\'s fallback writer cannot carry a pin or a lifecycle, so asking for one is refused', () => {
    const fallbackHost = () => {
        const saveItem = vi.fn(async (_type: string, name: string, item: any) => ({ name, label: item?.label }));
        return { dispatcher: dispatcherOver({ protocol: {}, metadata: { saveItem } }), saveItem };
    };

    for (const [asked, opts] of [
        ['If-Match', { headers: { 'If-Match': 'a-token' } }],
        ['If-None-Match: *', { headers: { 'If-None-Match': '*' } }],
        ['?mode=draft', { query: { mode: 'draft' } }],
    ] as const) {
        it(`${asked}: 501 NOT_IMPLEMENTED, and the fallback never writes`, async () => {
            const { dispatcher, saveItem } = fallbackHost();
            const res = await catchAll(dispatcher, putRequest('case_grid', 'never', opts as SaveOptions));
            expect({ status: res.response?.status, code: codeOf(res.response?.body) }).toEqual({ status: 501, code: 'NOT_IMPLEMENTED' });
            expect(saveItem).not.toHaveBeenCalled();
        });
    }

    it('control: an unguarded save still reaches the fallback writer', async () => {
        const { dispatcher, saveItem } = fallbackHost();
        const res = await catchAll(dispatcher, putRequest('case_grid', 'kept'));
        expect(res.response?.status).toBe(200);
        expect(saveItem).toHaveBeenCalledTimes(1);
        expect(saveItem.mock.calls[0].slice(0, 2)).toEqual(['view', 'case_grid']);
    });
});
