// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23265] Both doors of `DELETE /data/:object/:id` honour the caller's
 * optimistic-concurrency token alike: `RestServer`'s route and the runtime
 * dispatcher's `/data` domain, the only answer on a host that mounts just
 * `@objectstack/hono`'s `${prefix}/*` catch-all.
 *
 * ## What was wrong
 *
 * `RestServer` reads `?expectedVersion`, else `If-Match`, behind its arity
 * gate, and hands the token to `deleteData`, which refuses a delete whose
 * version moved (`409 CONCURRENT_UPDATE`). The dispatcher's `DELETE` branch
 * read neither, and `callData`'s delete arm forwarded only `{ object, id }`,
 * so through the catch-all a stale delete was APPLIED with a `200`, the same
 * answer a request with no token gets. These rows hold the two doors to the
 * same answer over the same cases, and read the store, not the door's word,
 * after every request.
 *
 * ## The rig
 *
 * Each door gets its own REAL store: better-sqlite3 `:memory:`, the real
 * `ObjectQL` engine and a real `ObjectStackProtocolImplementation`, so a
 * conflict is the protocol's own version check, not a double's.
 *
 *  - `RestServer`: its registered `DELETE` handler, called with the request
 *    the `plugin-hono-server` adapter builds (a lowercased header record), the
 *    auth boundary (`resolveExecCtx`) stubbed, as
 *    `meta-save-preconditions-parity.test.ts` drives its `PUT`;
 *  - the catch-all: {@link catchAll} repeats the catch-all's statements over a
 *    real Fetch `Request` into the real `HttpDispatcher.dispatch()`; the
 *    identity step is the one stubbed seam. The Fetch `Headers` is where an
 *    `If-Match` rides, so the header read is the one a real host meets.
 *
 * ## How a refusal is read
 *
 * A `400` arm is RETURNED by each door, in its own envelope. The conflict is
 * not: `/data` has no local catch, so `dispatch()` throws the protocol's
 * `ConcurrentUpdateError` and the host's exit renders it. Its status and code
 * are read here through `resolveThrownHttpError` (`@objectstack/types`), the
 * one rule the dispatcher's exits answer a throw with, and set beside what
 * `RestServer` answered through `mapDataError`. The parity asserted is status,
 * `code` and the store, never the envelope's bytes.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer, repeatedQueryParamMessage } from '@objectstack/rest';
import { resolveThrownHttpError } from '@objectstack/types';
import { HttpDispatcher } from '../http-dispatcher.js';

const PREFIX = '/api/v1';
const DATA = `${PREFIX}/data`;
/** `registry.registerObject` requires a package id (see the sibling real-stack tests). */
const TEST_PACKAGE_ID = 'objectstack-test';
const CALLER = { userId: 'u_member', isSystem: false };

const TASK = {
    name: 'task',
    label: 'Task',
    fields: {
        id: { name: 'id', type: 'text' as const, primaryKey: true, label: 'ID' },
        name: { name: 'name', type: 'text' as const, label: 'Name' },
    },
};

/** A well-formed instant no row in these stores carries: a token read before a write that moved it. */
const STALE = '2000-01-01T00:00:00.000Z';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

const liveEngines: ObjectQL[] = [];
afterEach(async () => {
    while (liveEngines.length) {
        try { await liveEngines.pop()?.destroy(); } catch { /* noop */ }
    }
});

/** One real store with one `task` row, `r1`, whose current version is `version`. */
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
    await engine.syncSchemas();
    const protocol = new ObjectStackProtocolImplementation(engine as any);
    await protocol.createData({ object: 'task', data: { id: 'r1', name: 'first' } } as any);
    const row: any = await engine.findOne('task', { where: { id: 'r1' } });
    const version = row?.updated_at instanceof Date ? row.updated_at.toISOString() : String(row?.updated_at ?? '');
    if (!version) throw new Error('the store minted no updated_at, so no version token exists to pin');
    const deleteData = vi.spyOn(protocol, 'deleteData');
    /** Is `r1` still in the store? */
    const present = async () => Boolean(await engine.findOne('task', { where: { id: 'r1' } }));
    return { protocol, version, present, deleteData };
}

// ── The two doors ─────────────────────────────────────────────────────────────

interface Answer { status: number; code?: string; message?: string }
interface DeleteOptions { headers?: Record<string, string>; query?: Record<string, string | string[]> }
interface Door {
    version: string;
    delete(opts?: DeleteOptions): Promise<Answer>;
    present(): Promise<boolean>;
    /** The `expectedVersion` each `deleteData` call received (`undefined` for none). */
    forwarded(): Array<string | undefined>;
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
    const { protocol, version, present, deleteData } = await bootStore();
    const noop = () => {};
    const server = { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
    const rest: any = new RestServer(server as any, protocol as any, { api: { requireAuth: false } } as any);
    rest.resolveExecCtx = async () => clone(CALLER);
    rest.registerRoutes();
    const route = rest.getRoutes().find((r: any) => r.method === 'DELETE' && r.path === `${DATA}/:object/:id`);
    if (!route) throw new Error(`DELETE ${DATA}/:object/:id is not registered`);
    return {
        version,
        present,
        forwarded: () => deleteData.mock.calls.map((c: any[]) => c[0]?.expectedVersion),
        delete: async ({ headers = {}, query = {} } = {}) => {
            const res = makeRes();
            await route.handler({
                method: 'DELETE', path: `${DATA}/task/r1`, params: { object: 'task', id: 'r1' },
                // The adapter's header record is lowercased (`c.req.header()`).
                headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])),
                query: clone(query),
            }, res);
            return { status: res.statusCode, code: codeOf(res.body), message: messageOf(res.body) };
        },
    };
}

/**
 * What `createHonoApp`'s `${prefix}/*` catch-all hands `dispatch()`: the path
 * below the prefix, the query flattened from the URL, and the raw Fetch
 * `Request` as `context.request`. A `DELETE` carries no body. `query` is passed
 * as given rather than re-read from the URL, so a repeat can be handed over as
 * the array a repeat-keeping adapter delivers.
 */
async function catchAll(dispatcher: HttpDispatcher, raw: Request, query: Record<string, unknown>) {
    const subPath = new URL(raw.url).pathname.substring(PREFIX.length);
    return dispatcher.dispatch(raw.method, subPath, undefined, query, { request: raw } as any, PREFIX);
}

function dispatcherOver(services: Record<string, unknown>): HttpDispatcher {
    const get = (n: string) => services[n] ?? null;
    const kernel: any = { context: { getService: get }, getService: get, getServiceAsync: async (n: string) => get(n) };
    const dispatcher = new HttpDispatcher(kernel);
    // The seam `dispatch()` resolves identity through (the sibling
    // dispatch-level pins supply the principal the same way).
    (dispatcher as any).timedResolveExecutionContext = async () => clone(CALLER);
    return dispatcher;
}

const deleteRequest = ({ headers = {}, query = {} }: DeleteOptions = {}) => {
    const url = new URL(`http://localhost${DATA}/task/r1`);
    for (const [k, v] of Object.entries(query)) {
        for (const one of Array.isArray(v) ? v : [v]) url.searchParams.append(k, one);
    }
    return new Request(url, { method: 'DELETE', headers });
};

/** A dispatch answer, returned or thrown, as status and code. */
async function answerOf(run: () => Promise<any>): Promise<Answer> {
    try {
        const res = await run();
        const body = res.response?.body;
        return { status: res.response?.status ?? 0, code: codeOf(body), message: messageOf(body) };
    } catch (e) {
        const thrown = resolveThrownHttpError(e);
        return { status: thrown.status, code: thrown.code, message: thrown.message };
    }
}

async function bootCatchAll(): Promise<Door> {
    const { protocol, version, present, deleteData } = await bootStore();
    const dispatcher = dispatcherOver({ protocol });
    return {
        version,
        present,
        forwarded: () => deleteData.mock.calls.map((c: any[]) => c[0]?.expectedVersion),
        delete: (opts = {}) => answerOf(() => catchAll(dispatcher, deleteRequest(opts), clone(opts.query ?? {}))),
    };
}

const DOORS: ReadonlyArray<readonly [string, () => Promise<Door>]> = [
    ['RestServer', bootRestServer],
    ['the @objectstack/hono catch-all', bootCatchAll],
];

const deleted = (a: Answer) => expect(a.status, JSON.stringify(a)).toBe(200);
const conflict = (a: Answer) =>
    expect({ status: a.status, code: a.code }, JSON.stringify(a)).toEqual({ status: 409, code: 'CONCURRENT_UPDATE' });

// ── The cases, on each door ───────────────────────────────────────────────────

for (const [doorName, boot] of DOORS) {
    describe(`[#23265] ${doorName}: DELETE /data/:object/:id honours ?expectedVersion and If-Match`, () => {
        it('control: a delete with no version deletes, and hands deleteData no token', async () => {
            const door = await boot();
            deleted(await door.delete());
            expect(await door.present()).toBe(false);
            expect(door.forwarded()).toEqual([undefined]);
        }, 60_000);

        it('?expectedVersion naming the current version deletes', async () => {
            const door = await boot();
            deleted(await door.delete({ query: { expectedVersion: door.version } }));
            expect(await door.present()).toBe(false);
            expect(door.forwarded()).toEqual([door.version]);
        }, 60_000);

        it('a stale ?expectedVersion is refused 409 CONCURRENT_UPDATE and deletes nothing', async () => {
            const door = await boot();
            conflict(await door.delete({ query: { expectedVersion: STALE } }));
            expect(await door.present()).toBe(true);
        }, 60_000);

        it('If-Match behaves like ?expectedVersion: the current version deletes, a stale one is refused', async () => {
            const stale = await boot();
            conflict(await stale.delete({ headers: { 'If-Match': `"${STALE}"` } }));
            expect(await stale.present()).toBe(true);

            const current = await boot();
            deleted(await current.delete({ headers: { 'If-Match': `"${current.version}"` } }));
            expect(await current.present()).toBe(false);
        }, 60_000);

        it('?expectedVersion is read before If-Match, so the query token is the one judged', async () => {
            const staleQuery = await boot();
            conflict(await staleQuery.delete({ query: { expectedVersion: STALE }, headers: { 'If-Match': staleQuery.version } }));
            expect(await staleQuery.present()).toBe(true);

            const currentQuery = await boot();
            deleted(await currentQuery.delete({ query: { expectedVersion: currentQuery.version }, headers: { 'If-Match': STALE } }));
            expect(await currentQuery.present()).toBe(false);
        }, 60_000);

        it('a repeated ?expectedVersion is refused 400 VALIDATION_ERROR before deleteData is asked', async () => {
            const door = await boot();
            const refused = await door.delete({ query: { expectedVersion: [door.version, STALE] } });
            expect({ status: refused.status, code: refused.code, message: refused.message }).toEqual({
                status: 400, code: 'VALIDATION_ERROR', message: repeatedQueryParamMessage('expectedVersion', 2),
            });
            expect(door.forwarded()).toEqual([]);
            expect(await door.present()).toBe(true);
        }, 60_000);

        it('a one-element ?expectedVersion array is the one token it encodes', async () => {
            const door = await boot();
            deleted(await door.delete({ query: { expectedVersion: [door.version] } }));
            expect(door.forwarded()).toEqual([door.version]);
            expect(await door.present()).toBe(false);
        }, 60_000);
    });
}

// ── The same refusals, side by side ───────────────────────────────────────────

describe('[#23265] the two doors refuse a stale token and a repeated one with the same status, code and sentence', () => {
    it('one conflict, two exits: 409 and CONCURRENT_UPDATE', async () => {
        const answers: Answer[] = [];
        for (const [, boot] of DOORS) {
            answers.push(await (await boot()).delete({ query: { expectedVersion: STALE } }));
        }
        const [rest, catchAllAnswer] = answers;
        expect({ status: catchAllAnswer.status, code: catchAllAnswer.code }).toEqual({ status: rest.status, code: rest.code });
    }, 60_000);

    it('one repeat, two envelopes: 400, VALIDATION_ERROR and the multiplicity sentence', async () => {
        const answers: Answer[] = [];
        for (const [, boot] of DOORS) {
            answers.push(await (await boot()).delete({ query: { expectedVersion: ['1', '2'] } }));
        }
        const [rest, catchAllAnswer] = answers;
        expect(catchAllAnswer).toEqual(rest);
    }, 60_000);

    it('a Node host\'s plain header record carries If-Match the way the Fetch Headers does', async () => {
        const { protocol, present } = await bootStore();
        const dispatcher = dispatcherOver({ protocol });
        const answer = await answerOf(() => dispatcher.dispatch(
            'DELETE', '/data/task/r1', undefined, {}, { request: { headers: { 'if-match': `"${STALE}"` } } } as any, PREFIX,
        ));
        conflict(answer);
        expect(await present()).toBe(true);
    }, 60_000);
});

// ── The dispatcher's fallback deleter ─────────────────────────────────────────

/**
 * The dispatcher alone has a second deleter: a host whose `protocol` brings no
 * `deleteData` falls to the ObjectQL engine's `delete`, which takes no version.
 * A caller who sent one is refused `501` before anything is read or deleted,
 * never deleted unguarded, which is the drop this card closes.
 */
describe('[#23265] the catch-all\'s fallback deleter cannot judge a version, so sending one is refused', () => {
    const fallbackHost = () => {
        const objectql = {
            find: vi.fn(async () => [{ id: 'r1' }]),
            delete: vi.fn(async () => true),
        };
        return { dispatcher: dispatcherOver({ protocol: {}, objectql }), objectql };
    };

    for (const [asked, opts] of [
        ['?expectedVersion', { query: { expectedVersion: STALE } }],
        ['If-Match', { headers: { 'If-Match': `"${STALE}"` } }],
    ] as const) {
        it(`${asked}: 501 NOT_IMPLEMENTED, and the fallback neither reads nor deletes`, async () => {
            const { dispatcher, objectql } = fallbackHost();
            const answer = await answerOf(() => catchAll(dispatcher, deleteRequest(opts as DeleteOptions), clone((opts as DeleteOptions).query ?? {})));
            expect({ status: answer.status, code: answer.code }).toEqual({ status: 501, code: 'NOT_IMPLEMENTED' });
            expect(objectql.find).not.toHaveBeenCalled();
            expect(objectql.delete).not.toHaveBeenCalled();
        });
    }

    it('control: an unguarded delete still reaches the fallback deleter', async () => {
        const { dispatcher, objectql } = fallbackHost();
        const answer = await answerOf(() => catchAll(dispatcher, deleteRequest(), {}));
        expect(answer.status).toBe(200);
        expect(objectql.delete).toHaveBeenCalledTimes(1);
    });
});
