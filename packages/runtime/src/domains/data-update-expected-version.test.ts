// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23462] Both doors of `PATCH /data/:object/:id` honour the caller's
 * optimistic-concurrency token alike: `RestServer`'s route and the runtime
 * dispatcher's `/data` domain, the only answer on a host that mounts just
 * `@objectstack/hono`'s `${prefix}/*` catch-all. The `DELETE` position of the
 * same family is pinned in `data-delete-expected-version.test.ts` (#23265);
 * this file is its `PATCH` sibling, on the same rig.
 *
 * ## What was wrong
 *
 * `RestServer` reads the body's `expectedVersion`, else `If-Match`, strips the
 * key out of the patch, and hands the token to `updateData`, which refuses an
 * update whose version moved (`409 CONCURRENT_UPDATE`). The dispatcher's
 * `PATCH` branch read neither and handed the whole body over as the patch, and
 * `callData`'s update arm forwarded no token. So through the catch-all a stale
 * `If-Match` update was APPLIED with a `200`, and a body `expectedVersion`
 * reached the engine as a field (refused as an unknown field, `500`). These
 * rows hold the two doors to the same answer over the same cases, and read the
 * store, not the door's word, after every request.
 *
 * ## The rig
 *
 * Each door gets its own REAL store: better-sqlite3 `:memory:`, the real
 * `ObjectQL` engine and a real `ObjectStackProtocolImplementation`, so a
 * conflict is the protocol's own version check, not a double's.
 *
 *  - `RestServer`: its registered `PATCH` handler, called with the request
 *    the `plugin-hono-server` adapter builds (a lowercased header record and
 *    the parsed JSON body), the auth boundary (`resolveExecCtx`) stubbed;
 *  - the catch-all: {@link catchAll} repeats the catch-all's statements over a
 *    real Fetch `Request` into the real `HttpDispatcher.dispatch()`: the body
 *    is parsed from a clone of the request's text (an unparsable body is
 *    `{}`), and the raw `Request` rides as `context.request`, which is where an
 *    `If-Match` is read. The identity step is the one stubbed seam.
 *
 * ## How a refusal is read
 *
 * The conflict is not returned by `dispatch()`: `/data` has no local catch, so
 * it throws the protocol's `ConcurrentUpdateError` and the host's exit renders
 * it. Its status and code are read here through `resolveThrownHttpError`
 * (`@objectstack/types`), the one rule the dispatcher's exits answer a throw
 * with, and set beside what `RestServer` answered through `mapDataError`. The
 * parity asserted is status, `code` and the store, never the envelope's bytes.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from '@objectstack/rest';
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

/** `r1`'s name before any request; every applied patch below writes {@link AFTER}. */
const BEFORE = 'first';
const AFTER = 'second';

/** A well-formed instant no row in these stores carries: a token read before a write that moved it. */
const STALE = '2000-01-01T00:00:00.000Z';

const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

const liveEngines: ObjectQL[] = [];
afterEach(async () => {
    while (liveEngines.length) {
        try { await liveEngines.pop()?.destroy(); } catch { /* noop */ }
    }
});

/** One real store with one `task` row, `r1`, named {@link BEFORE}, whose current version is `version`. */
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
    await protocol.createData({ object: 'task', data: { id: 'r1', name: BEFORE } } as any);
    const row: any = await engine.findOne('task', { where: { id: 'r1' } });
    const version = row?.updated_at instanceof Date ? row.updated_at.toISOString() : String(row?.updated_at ?? '');
    if (!version) throw new Error('the store minted no updated_at, so no version token exists to pin');
    const updateData = vi.spyOn(protocol, 'updateData');
    /** `r1`'s `name` in the store now. */
    const name = async () => ((await engine.findOne('task', { where: { id: 'r1' } })) as any)?.name;
    return { protocol, version, name, updateData };
}

// ── The two doors ─────────────────────────────────────────────────────────────

interface Answer { status: number; code?: string; message?: string }
interface PatchOptions { headers?: Record<string, string>; body?: unknown }
/** What one `updateData` call received. */
interface Forwarded { expectedVersion: string | undefined; data: unknown }
interface Door {
    version: string;
    patch(opts?: PatchOptions): Promise<Answer>;
    name(): Promise<string | undefined>;
    forwarded(): Forwarded[];
}

/** The refusal's `code` in either door's envelope: nested under `error`, or beside a string `error`. */
const codeOf = (body: any): string | undefined =>
    body?.error && typeof body.error === 'object' ? body.error.code : body?.code;
const messageOf = (body: any): string | undefined =>
    body?.error && typeof body.error === 'object' ? body.error.message : body?.error;

const forwardedBy = (updateData: { mock: { calls: any[][] } }) => (): Forwarded[] =>
    updateData.mock.calls.map((c) => ({ expectedVersion: c[0]?.expectedVersion, data: c[0]?.data }));

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
    const { protocol, version, name, updateData } = await bootStore();
    const noop = () => {};
    const server = { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
    const rest: any = new RestServer(server as any, protocol as any, { api: { requireAuth: false } } as any);
    rest.resolveExecCtx = async () => clone(CALLER);
    rest.registerRoutes();
    const route = rest.getRoutes().find((r: any) => r.method === 'PATCH' && r.path === `${DATA}/:object/:id`);
    if (!route) throw new Error(`PATCH ${DATA}/:object/:id is not registered`);
    return {
        version,
        name,
        forwarded: forwardedBy(updateData),
        patch: async ({ headers = {}, body } = {}) => {
            const res = makeRes();
            await route.handler({
                method: 'PATCH', path: `${DATA}/task/r1`, params: { object: 'task', id: 'r1' },
                // The adapter's header record is lowercased (`c.req.header()`).
                headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])),
                query: {},
                body: clone(body),
            }, res);
            return { status: res.statusCode, code: codeOf(res.body), message: messageOf(res.body) };
        },
    };
}

/**
 * What `createHonoApp`'s `${prefix}/*` catch-all hands `dispatch()` for a
 * `PATCH`: the path below the prefix, the JSON body parsed from a CLONE of the
 * request's text (any failure is `{}`, the adapter's `readDispatchBody`), the
 * query flattened from the URL, and the raw Fetch `Request` as
 * `context.request`.
 */
async function catchAll(dispatcher: HttpDispatcher, raw: Request) {
    const url = new URL(raw.url);
    const subPath = url.pathname.substring(PREFIX.length);
    let body: unknown;
    try {
        body = JSON.parse(await raw.clone().text());
    } catch {
        body = {};
    }
    const query: Record<string, string> = {};
    url.searchParams.forEach((v, k) => { query[k] = v; });
    return dispatcher.dispatch(raw.method, subPath, body, query, { request: raw } as any, PREFIX);
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

const patchRequest = ({ headers = {}, body }: PatchOptions = {}) =>
    new Request(`http://localhost${DATA}/task/r1`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

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
    const { protocol, version, name, updateData } = await bootStore();
    const dispatcher = dispatcherOver({ protocol });
    return {
        version,
        name,
        forwarded: forwardedBy(updateData),
        patch: (opts = {}) => answerOf(() => catchAll(dispatcher, patchRequest(opts))),
    };
}

const DOORS: ReadonlyArray<readonly [string, () => Promise<Door>]> = [
    ['RestServer', bootRestServer],
    ['the @objectstack/hono catch-all', bootCatchAll],
];

const updated = (a: Answer) => expect(a.status, JSON.stringify(a)).toBe(200);
const conflict = (a: Answer) =>
    expect({ status: a.status, code: a.code }, JSON.stringify(a)).toEqual({ status: 409, code: 'CONCURRENT_UPDATE' });

// ── The cases, on each door ───────────────────────────────────────────────────

for (const [doorName, boot] of DOORS) {
    describe(`[#23462] ${doorName}: PATCH /data/:object/:id honours a body expectedVersion and If-Match`, () => {
        it('control: a patch with no version updates, and hands updateData no token', async () => {
            const door = await boot();
            updated(await door.patch({ body: { name: AFTER } }));
            expect(await door.name()).toBe(AFTER);
            expect(door.forwarded()).toEqual([{ expectedVersion: undefined, data: { name: AFTER } }]);
        }, 60_000);

        it('a body expectedVersion naming the current version updates, and is never written as a field', async () => {
            const door = await boot();
            updated(await door.patch({ body: { name: AFTER, expectedVersion: door.version } }));
            expect(await door.name()).toBe(AFTER);
            // The token rides beside the patch, never inside it.
            expect(door.forwarded()).toEqual([{ expectedVersion: door.version, data: { name: AFTER } }]);
        }, 60_000);

        it('a stale body expectedVersion is refused 409 CONCURRENT_UPDATE and the row is unchanged', async () => {
            const door = await boot();
            conflict(await door.patch({ body: { name: AFTER, expectedVersion: STALE } }));
            expect(await door.name()).toBe(BEFORE);
            expect(door.forwarded()).toEqual([{ expectedVersion: STALE, data: { name: AFTER } }]);
        }, 60_000);

        it('If-Match behaves like the body token: the current version updates, a stale one is refused', async () => {
            const stale = await boot();
            conflict(await stale.patch({ body: { name: AFTER }, headers: { 'If-Match': `"${STALE}"` } }));
            expect(await stale.name()).toBe(BEFORE);

            const current = await boot();
            updated(await current.patch({ body: { name: AFTER }, headers: { 'If-Match': `"${current.version}"` } }));
            expect(await current.name()).toBe(AFTER);
        }, 60_000);

        it('the body token is read before If-Match, so the body token is the one judged', async () => {
            const staleBody = await boot();
            conflict(await staleBody.patch({ body: { name: AFTER, expectedVersion: STALE }, headers: { 'If-Match': staleBody.version } }));
            expect(await staleBody.name()).toBe(BEFORE);

            const currentBody = await boot();
            updated(await currentBody.patch({ body: { name: AFTER, expectedVersion: currentBody.version }, headers: { 'If-Match': STALE } }));
            expect(await currentBody.name()).toBe(AFTER);
        }, 60_000);
    });
}

// ── The same answers, side by side ────────────────────────────────────────────

/**
 * The shapes a caller can put the token in beyond the plain string. Each door
 * answers each one, and the two must agree on the status, the code and the
 * row. What either door does with them is `RestServer`'s reading, not this
 * file's: a token is the body key when it is not nullish (else `If-Match`),
 * the key is stripped from the patch whatever its value, and a token is
 * forwarded as its string unless it can never carry a version, which is
 * refused (#23492, pinned in its own block below).
 */
const EDGE_SHAPES: ReadonlyArray<readonly [string, (version: string) => PatchOptions]> = [
    ['a stale token', () => ({ body: { name: AFTER, expectedVersion: STALE } })],
    ['a number token', () => ({ body: { name: AFTER, expectedVersion: 20000101 } })],
    ['a null body token beside a stale If-Match', () => ({ body: { name: AFTER, expectedVersion: null }, headers: { 'If-Match': STALE } })],
    ['a null body token beside the current If-Match', (v) => ({ body: { name: AFTER, expectedVersion: null }, headers: { 'If-Match': v } })],
    ['an empty-string body token beside a stale If-Match', () => ({ body: { name: AFTER, expectedVersion: '' }, headers: { 'If-Match': STALE } })],
    ['a body that is only the current token', (v) => ({ body: { expectedVersion: v } })],
];

describe('[#23462] the two doors answer each token shape with the same status, code and row', () => {
    for (const [shape, opts] of EDGE_SHAPES) {
        it(shape, async () => {
            const seen: Array<{ status: number; code?: string; name?: string }> = [];
            for (const [, boot] of DOORS) {
                const door = await boot();
                const answer = await door.patch(opts(door.version));
                seen.push({ status: answer.status, code: answer.code, name: await door.name() });
                // Whatever the token's shape, the key never reaches the engine as a field.
                for (const call of door.forwarded()) {
                    expect(call.data && typeof call.data === 'object' && 'expectedVersion' in call.data, JSON.stringify(call)).toBe(false);
                }
            }
            const [rest, catchAllAnswer] = seen;
            expect(catchAllAnswer).toEqual(rest);
        }, 60_000);
    }

    it('a Node host\'s plain header record carries If-Match the way the Fetch Headers does', async () => {
        const { protocol, name } = await bootStore();
        const dispatcher = dispatcherOver({ protocol });
        const answer = await answerOf(() => dispatcher.dispatch(
            'PATCH', '/data/task/r1', { name: AFTER }, {}, { request: { headers: { 'if-match': `"${STALE}"` } } } as any, PREFIX,
        ));
        conflict(answer);
        expect(await name()).toBe(BEFORE);
    }, 60_000);
});

// ── A token that can never carry a version ────────────────────────────────────

/**
 * [#23492] Both doors read `bodyVersion ?? If-Match` and used to forward a
 * token only when it was truthy. `''` and `false` are not nullish, so the
 * stale `If-Match` beside them was never read, and not truthy, so no token was
 * forwarded: the update was APPLIED, `200`, on both doors (measured on this
 * rig before the fix, the row read back as written). Now a token in a token
 * position that can never carry a version is refused with the protocol's own
 * answer to the quoted-empty tag `""`, `400 VALIDATION_FAILED`, before
 * `updateData` is asked; maintainer decision #20 ① rules that shape refused,
 * neither read as "no token" nor answered `409`.
 */
const UNUSABLE: ReadonlyArray<readonly [string, PatchOptions]> = [
    ["a body expectedVersion of '' beside a stale If-Match", { body: { name: AFTER, expectedVersion: '' }, headers: { 'If-Match': STALE } }],
    ["a body expectedVersion of '' and no If-Match", { body: { name: AFTER, expectedVersion: '' } }],
    ['a body expectedVersion of false beside a stale If-Match', { body: { name: AFTER, expectedVersion: false }, headers: { 'If-Match': STALE } }],
    ['a body expectedVersion of false and no If-Match', { body: { name: AFTER, expectedVersion: false } }],
    ['a blank body expectedVersion beside a stale If-Match', { body: { name: AFTER, expectedVersion: '   ' }, headers: { 'If-Match': STALE } }],
    ['a body expectedVersion of true', { body: { name: AFTER, expectedVersion: true } }],
    ['a body expectedVersion that is an array, beside a stale If-Match', { body: { name: AFTER, expectedVersion: [] }, headers: { 'If-Match': STALE } }],
    ['an empty If-Match and no body token', { body: { name: AFTER }, headers: { 'If-Match': '' } }],
];

const refused = (a: Answer) =>
    expect({ status: a.status, code: a.code }, JSON.stringify(a)).toEqual({ status: 400, code: 'VALIDATION_FAILED' });

for (const [doorName, boot] of DOORS) {
    describe(`[#23492] ${doorName}: PATCH /data/:object/:id refuses a token that can never carry a version`, () => {
        for (const [shape, opts] of UNUSABLE) {
            it(`${shape}: 400 VALIDATION_FAILED, updateData never asked, the row unchanged`, async () => {
                const door = await boot();
                refused(await door.patch(opts));
                expect(door.forwarded()).toEqual([]);
                expect(await door.name()).toBe(BEFORE);
            }, 60_000);
        }

        it('the refusal is the protocol\'s own answer to the quoted-empty tag: the same status and code', async () => {
            const quoted = await boot();
            const protocolAnswer = await quoted.patch({ body: { name: AFTER, expectedVersion: '""' } });
            // The protocol, not the door, refused this one: the token reached it.
            expect(quoted.forwarded().map((f) => f.expectedVersion)).toEqual(['""']);
            const empty = await boot();
            const doorAnswer = await empty.patch({ body: { name: AFTER, expectedVersion: '' } });
            expect({ status: doorAnswer.status, code: doorAnswer.code })
                .toEqual({ status: protocolAnswer.status, code: protocolAnswer.code });
        }, 60_000);

        it('control: a null body token is no token, so a stale If-Match beside it is judged and refused 409', async () => {
            const door = await boot();
            conflict(await door.patch({ body: { name: AFTER, expectedVersion: null }, headers: { 'If-Match': STALE } }));
            expect(door.forwarded().map((f) => f.expectedVersion)).toEqual([STALE]);
            expect(await door.name()).toBe(BEFORE);
        }, 60_000);

        it('control: a body token of 0 is a number, judged as "0" (refused 409), never dropped', async () => {
            const door = await boot();
            conflict(await door.patch({ body: { name: AFTER, expectedVersion: 0 }, headers: { 'If-Match': door.version } }));
            expect(door.forwarded()).toEqual([{ expectedVersion: '0', data: { name: AFTER } }]);
            expect(await door.name()).toBe(BEFORE);
        }, 60_000);
    });
}

describe('[#23492] the two doors refuse each token that can never carry a version alike', () => {
    for (const [shape, opts] of UNUSABLE) {
        it(`${shape}: the same status, code and sentence`, async () => {
            const answers: Answer[] = [];
            for (const [, boot] of DOORS) answers.push(await (await boot()).patch(opts));
            const [rest, catchAllAnswer] = answers;
            expect(catchAllAnswer).toEqual(rest);
        }, 60_000);
    }
});

// ── The dispatcher's fallback updater ─────────────────────────────────────────

/**
 * The dispatcher alone has a second updater: a host whose `protocol` brings no
 * `updateData` falls to the ObjectQL engine's `update`, which takes no version.
 * A caller who sent one is refused `501` before anything is read or written,
 * never updated unguarded, which is the drop this card closes.
 */
describe('[#23462] the catch-all\'s fallback updater cannot judge a version, so sending one is refused', () => {
    const fallbackHost = () => {
        const objectql = {
            find: vi.fn(async () => [{ id: 'r1', name: BEFORE }]),
            update: vi.fn(async () => ({ id: 'r1', name: AFTER })),
        };
        return { dispatcher: dispatcherOver({ protocol: {}, objectql }), objectql };
    };

    for (const [asked, opts] of [
        ['a body expectedVersion', { body: { name: AFTER, expectedVersion: STALE } }],
        ['If-Match', { body: { name: AFTER }, headers: { 'If-Match': `"${STALE}"` } }],
    ] as const) {
        it(`${asked}: 501 NOT_IMPLEMENTED, and the fallback neither reads nor writes`, async () => {
            const { dispatcher, objectql } = fallbackHost();
            const answer = await answerOf(() => catchAll(dispatcher, patchRequest(opts as PatchOptions)));
            expect({ status: answer.status, code: answer.code }).toEqual({ status: 501, code: 'NOT_IMPLEMENTED' });
            expect(objectql.find).not.toHaveBeenCalled();
            expect(objectql.update).not.toHaveBeenCalled();
        });
    }

    it('control: an unguarded update still reaches the fallback updater', async () => {
        const { dispatcher, objectql } = fallbackHost();
        const answer = await answerOf(() => catchAll(dispatcher, patchRequest({ body: { name: AFTER } })));
        expect(answer.status).toBe(200);
        expect(objectql.update).toHaveBeenCalledTimes(1);
    });
});
