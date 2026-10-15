// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23491] Both doors of the `/data` single-record writes validate the
 * assembled protocol request before the engine is asked: `RestServer`'s
 * registered routes and the runtime dispatcher's `/data` domain, the only
 * answer on a host that mounts just `@objectstack/hono`'s `${prefix}/*`
 * catch-all.
 *
 * ## What was wrong
 *
 * `RestServer` validates `PATCH /data/:object/:id` as `UpdateDataRequestSchema`
 * and `POST /data/:object` as `CreateDataRequestSchema` (#3899), so a body
 * that is not a record answers `400 VALIDATION_FAILED`. The dispatcher's two
 * branches had no gate. Measured on this rig before the fix:
 *
 *  - `PATCH` with an array, a string, a number or `null` answered `500
 *    INTERNAL_ERROR` with the engine's own error text ("no such column: 0",
 *    "Cannot use 'in' operator …", "Cannot read properties of null …"),
 *    after `updateData` was asked;
 *  - `POST` with an array CREATED a row per element (`201`), a number created
 *    an empty row (`201`), and a string answered the engine's unknown-field
 *    `400 INVALID_FIELD`;
 *  - `RestServer`'s `PATCH` read a `null` body as `{}` (`data ?? {}`) and
 *    answered `200`: an update that changed no field and still moved the
 *    record's `updated_at`, so every other holder of the old version was
 *    turned stale by a request that wrote nothing.
 *
 * The `null` body now answers `400` on both `PATCH` doors: the declared type
 * is a record, and one door reading it as `{}` was the consumer-side leniency
 * the contract-first rule forbids. A `null` CREATE is the one shape left as it
 * was: `RestServer`'s create reads it as `{}`, the dispatcher's gate asks the
 * same assembled request, and the two doors answer it alike (pinned below as
 * parity only).
 *
 * ## The rig
 *
 * The one `data-update-expected-version.test.ts` describes: each door gets
 * its own REAL store (better-sqlite3 `:memory:`, the real `ObjectQL` and a
 * real `ObjectStackProtocolImplementation`); `RestServer` is driven through
 * its registered handler with the request `plugin-hono-server` builds, and
 * the dispatcher through `HttpDispatcher.dispatch()` with the body parsed the
 * way the catch-all parses it (`JSON.parse` of the request text, any failure
 * `{}`). Every row asserts the store, not just the door's word.
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

const BEFORE = 'first';
const AFTER = 'second';

const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

const liveEngines: ObjectQL[] = [];
afterEach(async () => {
    while (liveEngines.length) {
        try { await liveEngines.pop()?.destroy(); } catch { /* noop */ }
    }
});

/** What the store holds after a request: `r1`'s name and version, and the row count. */
interface StoreState { name: unknown; version: unknown; rows: number }

/** One real store with one `task` row, `r1`, named {@link BEFORE}. */
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
    const updateData = vi.spyOn(protocol, 'updateData');
    const createData = vi.spyOn(protocol, 'createData');
    const state = async (): Promise<StoreState> => {
        const row: any = await engine.findOne('task', { where: { id: 'r1' } });
        const rows = ((await engine.find('task', {})) as unknown[]).length;
        const v = row?.updated_at;
        return { name: row?.name, version: v instanceof Date ? v.toISOString() : v, rows };
    };
    return { protocol, updateData, createData, state };
}

// ── The two doors ─────────────────────────────────────────────────────────────

interface Answer { status: number; code?: string; fields?: string[] }
interface Door {
    patch(body: unknown): Promise<Answer>;
    create(body: unknown): Promise<Answer>;
    state(): Promise<StoreState>;
    updateCalls(): number;
    createCalls(): number;
}

/** The refusal's `code` in either door's envelope: nested under `error`, or beside a string `error`. */
const codeOf = (body: any): string | undefined =>
    body?.error && typeof body.error === 'object' ? body.error.code : body?.code;
/** The field names a refusal carries: `RestServer`'s top-level `fields`, the dispatcher's `error.details.fields`. */
const fieldsOf = (body: any): string[] | undefined => {
    const fields = Array.isArray(body?.fields) ? body.fields : body?.error?.details?.fields;
    return Array.isArray(fields) ? fields.map((f: any) => f?.field).sort() : undefined;
};

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
    const { protocol, updateData, createData, state } = await bootStore();
    const noop = () => {};
    const server = { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
    const rest: any = new RestServer(server as any, protocol as any, { api: { requireAuth: false } } as any);
    rest.resolveExecCtx = async () => clone(CALLER);
    rest.registerRoutes();
    const routeOf = (method: string, path: string) => {
        const route = rest.getRoutes().find((r: any) => r.method === method && r.path === path);
        if (!route) throw new Error(`${method} ${path} is not registered`);
        return route;
    };
    const update = routeOf('PATCH', `${DATA}/:object/:id`);
    const create = routeOf('POST', `${DATA}/:object`);
    const drive = async (route: any, path: string, params: Record<string, string>, body: unknown): Promise<Answer> => {
        const res = makeRes();
        // `plugin-hono-server` hands a JSON body over as `c.req.json()` parsed it: `null` stays `null`.
        await route.handler({ method: route.method, path, params, headers: { 'content-type': 'application/json' }, query: {}, body: clone(body) }, res);
        return { status: res.statusCode, code: codeOf(res.body), fields: fieldsOf(res.body) };
    };
    return {
        state,
        updateCalls: () => updateData.mock.calls.length,
        createCalls: () => createData.mock.calls.length,
        patch: (body) => drive(update, `${DATA}/task/r1`, { object: 'task', id: 'r1' }, body),
        create: (body) => drive(create, `${DATA}/task`, { object: 'task' }, body),
    };
}

/**
 * What `createHonoApp`'s `${prefix}/*` catch-all hands `dispatch()` for a
 * write: the path below the prefix, the JSON body parsed from the request's
 * text (any failure is `{}`, the adapter's `readDispatchBody`), and the raw
 * Fetch `Request` as `context.request`.
 */
async function catchAll(dispatcher: HttpDispatcher, method: string, path: string, body: unknown): Promise<Answer> {
    const raw = new Request(`http://localhost${PREFIX}${path}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
    let parsed: unknown;
    try {
        parsed = JSON.parse(await raw.clone().text());
    } catch {
        parsed = {};
    }
    try {
        const res: any = await dispatcher.dispatch(method, path, parsed, {}, { request: raw } as any, PREFIX);
        const out = res.response?.body;
        return { status: res.response?.status ?? 0, code: codeOf(out), fields: fieldsOf(out) };
    } catch (e) {
        // A throw out of `dispatch()` is rendered by the host's exit; read it
        // through the one rule the dispatcher's exits answer a throw with.
        const thrown = resolveThrownHttpError(e);
        return { status: thrown.status, code: thrown.code };
    }
}

async function bootCatchAll(): Promise<Door> {
    const { protocol, updateData, createData, state } = await bootStore();
    const services: Record<string, unknown> = { protocol };
    const get = (n: string) => services[n] ?? null;
    const kernel: any = { context: { getService: get }, getService: get, getServiceAsync: async (n: string) => get(n) };
    const dispatcher = new HttpDispatcher(kernel);
    // The seam `dispatch()` resolves identity through (the sibling
    // dispatch-level pins supply the principal the same way).
    (dispatcher as any).timedResolveExecutionContext = async () => clone(CALLER);
    return {
        state,
        updateCalls: () => updateData.mock.calls.length,
        createCalls: () => createData.mock.calls.length,
        patch: (body) => catchAll(dispatcher, 'PATCH', '/data/task/r1', body),
        create: (body) => catchAll(dispatcher, 'POST', '/data/task', body),
    };
}

const DOORS: ReadonlyArray<readonly [string, () => Promise<Door>]> = [
    ['RestServer', bootRestServer],
    ['the @objectstack/hono catch-all', bootCatchAll],
];

/** The JSON values a body can be that are not the record both request schemas declare for `data`. */
const NOT_A_RECORD: ReadonlyArray<readonly [string, unknown]> = [
    ['an array', [{ name: AFTER }]],
    ['a string', 'garbage'],
    ['a number', 42],
    ['null', null],
];

/** `400 VALIDATION_FAILED`, the refusal naming `data`: the request schema answered, not the engine. */
const refusedOnData = (a: Answer) =>
    expect({ status: a.status, code: a.code, fields: a.fields }, JSON.stringify(a))
        .toEqual({ status: 400, code: 'VALIDATION_FAILED', fields: ['data'] });

// ── PATCH /data/:object/:id ───────────────────────────────────────────────────

for (const [doorName, boot] of DOORS) {
    describe(`[#23491] ${doorName}: PATCH /data/:object/:id refuses a body that is not a record`, () => {
        for (const [shape, body] of NOT_A_RECORD) {
            it(`${shape}: 400 VALIDATION_FAILED on data, updateData never asked, the row and its version unchanged`, async () => {
                const door = await boot();
                const before = await door.state();
                refusedOnData(await door.patch(body));
                expect(door.updateCalls()).toBe(0);
                expect(await door.state()).toEqual(before);
            }, 60_000);
        }

        it('control: a record body updates the row (200)', async () => {
            const door = await boot();
            const answer = await door.patch({ name: AFTER });
            expect(answer.status, JSON.stringify(answer)).toBe(200);
            expect(door.updateCalls()).toBe(1);
            expect((await door.state()).name).toBe(AFTER);
        }, 60_000);
    });
}

describe('[#23491] the two PATCH doors refuse each non-record body alike', () => {
    for (const [shape, body] of NOT_A_RECORD) {
        it(`${shape}: the same status, code and fields`, async () => {
            const answers: Answer[] = [];
            for (const [, boot] of DOORS) answers.push(await (await boot()).patch(body));
            const [rest, catchAllAnswer] = answers;
            expect(catchAllAnswer).toEqual(rest);
        }, 60_000);
    }
});

// ── POST /data/:object ────────────────────────────────────────────────────────

/** The create's non-record bodies `RestServer`'s assembled request refuses; `null` is read as `{}` by both doors. */
const CREATE_REFUSED = NOT_A_RECORD.filter(([, body]) => body !== null);

for (const [doorName, boot] of DOORS) {
    describe(`[#23491] ${doorName}: POST /data/:object refuses a body that is not a record`, () => {
        for (const [shape, body] of CREATE_REFUSED) {
            it(`${shape}: 400 VALIDATION_FAILED on data, createData never asked, no row created`, async () => {
                const door = await boot();
                const before = await door.state();
                refusedOnData(await door.create(body));
                expect(door.createCalls()).toBe(0);
                expect(await door.state()).toEqual(before);
            }, 60_000);
        }

        it('control: a record body creates one row (201)', async () => {
            const door = await boot();
            const before = await door.state();
            const answer = await door.create({ name: AFTER });
            expect(answer.status, JSON.stringify(answer)).toBe(201);
            expect((await door.state()).rows).toBe(before.rows + 1);
        }, 60_000);
    });
}

describe('[#23491] the two POST doors answer each non-record body alike', () => {
    for (const [shape, body] of NOT_A_RECORD) {
        it(`${shape}: the same status, code, fields and row count`, async () => {
            const seen: Array<Answer & { rows: number }> = [];
            for (const [, boot] of DOORS) {
                const door = await boot();
                const answer = await door.create(body);
                seen.push({ ...answer, rows: (await door.state()).rows });
            }
            const [rest, catchAllAnswer] = seen;
            expect(catchAllAnswer).toEqual(rest);
        }, 60_000);
    }
});
