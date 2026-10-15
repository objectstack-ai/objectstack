// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23491] Both doors of the `/data` single-record writes validate the
 * assembled protocol request before the engine is asked: `RestServer`'s
 * registered routes and the runtime dispatcher's `/data` domain, the only
 * answer on a host that mounts just `@objectstack/hono`'s `${prefix}/*`
 * catch-all.
 *
 * [#23574] …and the `POST /data/:object/query` read, and a JSON `null` create,
 * and both doors ask the object's API exposure before their request gate.
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
 * the contract-first rule forbids.
 *
 * [#23574] Three more, measured on this rig before the fix:
 *
 *  1. A `null` CREATE answered `201` and an EMPTY ROW on both doors: each read
 *     it as `{}` (`req.body ?? {}`, and the dispatcher mirrored it statement
 *     for statement). Both now refuse it like the rest.
 *  2. The dispatcher's `POST /data/:object/query` had no
 *     `FindDataRequestSchema` gate: `{ limit: "ten" }`, the retired
 *     `{ joins: [] }`, a number and a `null` answered `200` with the FULL
 *     record set, and a string or an array answered the engine's `400
 *     INVALID_FIELD` for numbered keys. `RestServer` refused each `400
 *     VALIDATION_FAILED`, except `null`, which it too read as `{}` (a full
 *     read). Both now gate the same assembled request, and forward it: a body
 *     `query` key, which the dispatcher used to read as a nested query, is
 *     now the unknown field it is through `RestServer`.
 *  3. On an object whose API exposure denies the verb, a body that is not a
 *     record answered `400` on the dispatcher (its request gate ran before
 *     `callData`, where the exposure gate lives) and the exposure refusal
 *     (`404` / `405`) on `RestServer`, whose `enforceApiAccess` runs first.
 *     The dispatcher now asks the same exposure gate first.
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
 *
 * [#23574] Both doors read each object's exposure from the one definition the
 * engine's registry holds: `RestServer` through the protocol's object list
 * (`getMetaItems`, which this rig's protocol cannot read without a metadata
 * store, so it is answered from the registry), and the dispatcher through the
 * kernel's `metadata` service (`getObject`, answered from the same registry).
 * Without them each door's exposure gate fails open, and every exposure row
 * below would read as an allowed object.
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

const FIELDS = {
    id: { name: 'id', type: 'text' as const, primaryKey: true, label: 'ID' },
    name: { name: 'name', type: 'text' as const, label: 'Name' },
};
const TASK = { name: 'task', label: 'Task', fields: FIELDS };

/**
 * [#23574] Two objects whose declared API exposure refuses every verb below:
 * `locked` exposes `get` alone (`405` for `create`, `update` and `list`), and
 * `hidden` is not exposed at all (`404`).
 */
const EXPOSURE_DENIED: ReadonlyArray<{ object: { name: string; label: string; fields: typeof FIELDS; enable: Record<string, unknown> }; status: number }> = [
    { object: { name: 'locked', label: 'Locked', fields: FIELDS, enable: { apiMethods: ['get'] } }, status: 405 },
    { object: { name: 'hidden', label: 'Hidden', fields: FIELDS, enable: { apiEnabled: false } }, status: 404 },
];
const OBJECTS = [TASK, ...EXPOSURE_DENIED.map((d) => d.object)];

const BEFORE = 'first';
const AFTER = 'second';

const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

const liveEngines: ObjectQL[] = [];
afterEach(async () => {
    while (liveEngines.length) {
        try { await liveEngines.pop()?.destroy(); } catch { /* noop */ }
    }
});

/** What the store holds after a request: `r1`'s name and version, and the row count, of one object. */
interface StoreState { name: unknown; version: unknown; rows: number }

/** One real store with one row, `r1`, named {@link BEFORE}, in each of {@link OBJECTS}. */
async function bootStore() {
    const engine = new ObjectQL();
    liveEngines.push(engine);
    engine.registerDriver(new SqlDriver({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
    }), true);
    await engine.init();
    for (const object of OBJECTS) engine.registry.registerObject(object as any, TEST_PACKAGE_ID);
    await engine.syncSchemas();
    const protocol = new ObjectStackProtocolImplementation(engine as any);
    for (const object of OBJECTS) {
        await protocol.createData({ object: object.name, data: { id: 'r1', name: BEFORE } } as any);
    }
    const updateData = vi.spyOn(protocol, 'updateData');
    const createData = vi.spyOn(protocol, 'createData');
    const findData = vi.spyOn(protocol, 'findData');
    const state = async (object = 'task'): Promise<StoreState> => {
        const row: any = await engine.findOne(object, { where: { id: 'r1' } });
        const rows = ((await engine.find(object, {})) as unknown[]).length;
        const v = row?.updated_at;
        return { name: row?.name, version: v instanceof Date ? v.toISOString() : v, rows };
    };
    /** Each object's definition as the registry holds it: the one exposure source both doors read. */
    const definition = (name: string) => engine.registry.getObject(name);
    return { protocol, updateData, createData, findData, state, definition };
}

// ── The two doors ─────────────────────────────────────────────────────────────

interface Answer { status: number; code?: string; fields?: string[]; records?: number }
interface Door {
    patch(body: unknown, object?: string): Promise<Answer>;
    create(body: unknown, object?: string): Promise<Answer>;
    query(body: unknown, object?: string): Promise<Answer>;
    state(object?: string): Promise<StoreState>;
    updateCalls(): number;
    createCalls(): number;
    findCalls(): number;
}

/** The refusal's `code` in either door's envelope: nested under `error`, or beside a string `error`. */
const codeOf = (body: any): string | undefined =>
    body?.error && typeof body.error === 'object' ? body.error.code : body?.code;
/** The field names a refusal carries: `RestServer`'s top-level `fields`, the dispatcher's `error.details.fields`. */
const fieldsOf = (body: any): string[] | undefined => {
    const fields = Array.isArray(body?.fields) ? body.fields : body?.error?.details?.fields;
    return Array.isArray(fields) ? fields.map((f: any) => f?.field).sort() : undefined;
};
/** How many records a query answered: `RestServer`'s `records`, the dispatcher's `data.records`. */
const recordsOf = (body: any): number | undefined => {
    const records = body?.records ?? body?.data?.records;
    return Array.isArray(records) ? records.length : undefined;
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
    const { protocol, updateData, createData, findData, state, definition } = await bootStore();
    // `enforceApiAccess` reads the object list through the protocol; see the rig note above.
    (protocol as any).getMetaItems = async (request: any) => request?.type === 'object'
        ? { type: 'object', items: OBJECTS.map((o) => definition(o.name)) }
        : { type: request?.type, items: [] };
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
    const find = routeOf('POST', `${DATA}/:object/query`);
    const drive = async (route: any, path: string, params: Record<string, string>, body: unknown): Promise<Answer> => {
        const res = makeRes();
        // `plugin-hono-server` hands a JSON body over as `c.req.json()` parsed it: `null` stays `null`.
        await route.handler({ method: route.method, path, params, headers: { 'content-type': 'application/json' }, query: {}, body: clone(body) }, res);
        return { status: res.statusCode, code: codeOf(res.body), fields: fieldsOf(res.body), records: recordsOf(res.body) };
    };
    return {
        state,
        updateCalls: () => updateData.mock.calls.length,
        createCalls: () => createData.mock.calls.length,
        findCalls: () => findData.mock.calls.length,
        patch: (body, object = 'task') => drive(update, `${DATA}/${object}/r1`, { object, id: 'r1' }, body),
        create: (body, object = 'task') => drive(create, `${DATA}/${object}`, { object }, body),
        query: (body, object = 'task') => drive(find, `${DATA}/${object}/query`, { object }, body),
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
        return { status: res.response?.status ?? 0, code: codeOf(out), fields: fieldsOf(out), records: recordsOf(out) };
    } catch (e) {
        // A throw out of `dispatch()` is rendered by the host's exit; read it
        // through the one rule the dispatcher's exits answer a throw with.
        const thrown = resolveThrownHttpError(e);
        return { status: thrown.status, code: thrown.code };
    }
}

async function bootCatchAll(): Promise<Door> {
    const { protocol, updateData, createData, findData, state, definition } = await bootStore();
    // `callData`'s exposure gate reads the kernel's `metadata` service; see the rig note above.
    const metadata = { getObject: async (name: string) => definition(name) };
    const services: Record<string, unknown> = { protocol, metadata };
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
        findCalls: () => findData.mock.calls.length,
        patch: (body, object = 'task') => catchAll(dispatcher, 'PATCH', `/data/${object}/r1`, body),
        create: (body, object = 'task') => catchAll(dispatcher, 'POST', `/data/${object}`, body),
        query: (body, object = 'task') => catchAll(dispatcher, 'POST', `/data/${object}/query`, body),
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

// [#23574] Location 1: `null` is refused like the rest. Both doors used to read
// it as `{}` and create an empty row (`201`), so it was left out of this list
// and pinned as parity only.
for (const [doorName, boot] of DOORS) {
    describe(`[#23491] [#23574] ${doorName}: POST /data/:object refuses a body that is not a record`, () => {
        for (const [shape, body] of NOT_A_RECORD) {
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

        it('control: an empty record body (what every host hands over for an empty request body) creates one row (201)', async () => {
            const door = await boot();
            const before = await door.state();
            const answer = await door.create({});
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

// ── POST /data/:object/query ──────────────────────────────────────────────────

/**
 * [#23574] Location 2: bodies `FindDataRequestSchema` refuses, each with the
 * member the refusal names. `RestServer` refused all but `null` before this
 * card; the dispatcher refused none of them with this answer.
 */
const QUERY_REFUSED: ReadonlyArray<readonly [string, unknown, string]> = [
    ['a mistyped clause, `limit: "ten"`', { limit: 'ten' }, 'query.limit'],
    ['the retired `joins`', { joins: [] }, 'query.joins'],
    ['a string', 'garbage', 'query'],
    ['an array', [{}], 'query'],
    ['a number', 42, 'query'],
    ['null', null, 'query'],
];

for (const [doorName, boot] of DOORS) {
    describe(`[#23574] ${doorName}: POST /data/:object/query refuses a request FindDataRequestSchema does not declare`, () => {
        for (const [shape, body, field] of QUERY_REFUSED) {
            it(`${shape}: 400 VALIDATION_FAILED on ${field}, findData never asked`, async () => {
                const door = await boot();
                const answer = await door.query(body);
                expect({ status: answer.status, code: answer.code, fields: answer.fields }, JSON.stringify(answer))
                    .toEqual({ status: 400, code: 'VALIDATION_FAILED', fields: [field] });
                expect(door.findCalls()).toBe(0);
            }, 60_000);
        }

        it('control: an empty query answers every record (200)', async () => {
            const door = await boot();
            await door.create({ name: AFTER });
            const answer = await door.query({});
            expect({ status: answer.status, records: answer.records }, JSON.stringify(answer)).toEqual({ status: 200, records: 2 });
        }, 60_000);

        it('control: a conforming query is served as asked (200, the filtered set)', async () => {
            const door = await boot();
            await door.create({ name: AFTER });
            const answer = await door.query({ where: { name: AFTER }, limit: 5 });
            expect({ status: answer.status, records: answer.records }, JSON.stringify(answer)).toEqual({ status: 200, records: 1 });
            expect(door.findCalls()).toBe(1);
        }, 60_000);
    });
}

describe('[#23574] the two query doors answer each request alike', () => {
    const BODIES: ReadonlyArray<readonly [string, unknown]> = [
        ...QUERY_REFUSED.map(([shape, body]) => [shape, body] as const),
        // What the gate parses is what both doors forward, so a body `query`
        // key is no nested query on either: the engine refuses the field it
        // names. The dispatcher used to read it as the query (`200`).
        ['a body `query` key', { query: { where: { name: 'nope' } } }],
        ['a body `object` (the path object wins)', { object: 'hidden' }],
    ];
    for (const [shape, body] of BODIES) {
        it(`${shape}: the same status, code, fields and record count`, async () => {
            const answers: Answer[] = [];
            for (const [, boot] of DOORS) answers.push(await (await boot()).query(body));
            const [rest, catchAllAnswer] = answers;
            expect(catchAllAnswer).toEqual(rest);
        }, 60_000);
    }

    it('a body `query` key: 400 INVALID_FIELD on both, never a nested query', async () => {
        for (const [doorName, boot] of DOORS) {
            const answer = await (await boot()).query({ query: { where: { name: 'nope' } } });
            expect({ status: answer.status, code: answer.code }, `${doorName}: ${JSON.stringify(answer)}`)
                .toEqual({ status: 400, code: 'INVALID_FIELD' });
        }
    }, 60_000);
});

// ── Exposure before the request gate ──────────────────────────────────────────

/**
 * [#23574] Location 3: on an object whose API exposure denies the verb, every
 * body is answered the exposure refusal, a record or not: the request gate is
 * never what tells a caller the object refuses how its ingress reads a body.
 * Statuses only across doors: the two doors' exposure envelopes carry
 * different codes, which this card does not change.
 */
const EXPOSURE_BODIES: ReadonlyArray<readonly [string, unknown]> = [
    ...NOT_A_RECORD,
    ['a record', { name: AFTER }],
];
const EXPOSURE_QUERY_BODIES: ReadonlyArray<readonly [string, unknown]> = [
    ['a mistyped clause, `limit: "ten"`', { limit: 'ten' }],
    ['null', null],
    ['an empty query', {}],
];

type Verb = 'patch' | 'create' | 'query';
const EXPOSURE_CASES: ReadonlyArray<readonly [Verb, ReadonlyArray<readonly [string, unknown]>, (d: Door) => number]> = [
    ['patch', EXPOSURE_BODIES, (d) => d.updateCalls()],
    ['create', EXPOSURE_BODIES, (d) => d.createCalls()],
    ['query', EXPOSURE_QUERY_BODIES, (d) => d.findCalls()],
];

for (const [doorName, boot] of DOORS) {
    describe(`[#23574] ${doorName}: an exposure-denied object is answered its exposure refusal before any request gate`, () => {
        for (const { object, status } of EXPOSURE_DENIED) {
            for (const [verb, bodies, engineCalls] of EXPOSURE_CASES) {
                it(`${verb} on \`${object.name}\`: ${status} for every body, the engine never asked, the row unchanged`, async () => {
                    const door = await boot();
                    const before = await door.state(object.name);
                    for (const [shape, body] of bodies) {
                        const answer = await door[verb](body, object.name);
                        expect(answer.status, `${shape}: ${JSON.stringify(answer)}`).toBe(status);
                    }
                    expect(engineCalls(door)).toBe(0);
                    expect(await door.state(object.name)).toEqual(before);
                }, 60_000);
            }
        }
    });
}

describe('[#23574] the two doors answer an exposure-denied object with the same status, whatever the body', () => {
    for (const { object } of EXPOSURE_DENIED) {
        for (const [verb, bodies] of EXPOSURE_CASES) {
            it(`${verb} on \`${object.name}\``, async () => {
                const statuses: number[][] = [];
                for (const [, boot] of DOORS) {
                    const door = await boot();
                    const seen: number[] = [];
                    for (const [, body] of bodies) seen.push((await door[verb](body, object.name)).status);
                    statuses.push(seen);
                }
                const [rest, catchAllStatuses] = statuses;
                expect(catchAllStatuses).toEqual(rest);
            }, 60_000);
        }
    }
});
