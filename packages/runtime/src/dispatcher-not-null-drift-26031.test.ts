// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#26031] A database NOT NULL refusal on a column the object does NOT declare
 * (drift: the column stayed in the table after its field left the metadata)
 * answers one body on every door: `RestServer`'s, `400 VALIDATION_FAILED`, the
 * column named, and the drift `hint`.
 *
 * ## What was wrong
 *
 * #24768 (ruling A) moved a refusal on a DECLARED field into the engine, which
 * now refuses it as its own `ValidationError`. A column no field declares has
 * no field to name, so the engine lets the driver's error out, and each door
 * classified it its own way. Measured on the rig below, at `origin/main`
 * `40bba68c` (which carries #26026):
 *
 *  - `RestServer` `POST /data/:object`: `mapDataError`'s NOT NULL arm,
 *    `400 VALIDATION_FAILED` with the column sentence and the drift `hint`;
 *  - the dispatcher's `POST /data/:object`: the raw `SqliteError` left
 *    `dispatch()`, and the Hono exit (`declaredEnvelopeForThrow`) declined it,
 *    so the door answered `500 INTERNAL_ERROR`;
 *  - `POST /actions/:object/:action`, a handler whose engine insert leaves the
 *    column out: `400 VALIDATION_ERROR`, the driver's text as the `message`
 *    (the physical table and column) and `declaredCode:
 *    'SQLITE_CONSTRAINT_NOTNULL'`.
 *
 * Both dispatcher exits now ask the arm itself (`driverNotNullRefusalAnswer`,
 * `@objectstack/types`), so the body is `RestServer`'s, read off one
 * classification, in this transport's envelope: the sentence as `message`, the
 * code as `code`, and the arm's `fields`, `hint` and `object` in `details`.
 *
 * ## `PATCH` cannot reach the column
 *
 * A `PATCH` naming the dropped field is refused before any driver runs, as an
 * undeclared field (`400 INVALID_FIELD`), on both `/data` doors alike, and so
 * is a `beforeUpdate` hook writing it; an update that leaves the column alone
 * keeps the row's stored value, which is not null. So the `PATCH` case below is
 * the control: one answer on both doors, unchanged.
 *
 * ## The rig
 *
 * A REAL store: better-sqlite3 `:memory:` under `driver-sql`, the real
 * `ObjectQL` engine and protocol. The object is registered with the column,
 * the table is built, and the object is registered again without it: the
 * metadata the doors serve has drifted from the table. The dispatcher is
 * reached the way `@objectstack/hono`'s catch-all reaches it, `dispatch()`
 * over a real Fetch `Request`, with the identity step the one stubbed seam; a
 * throw out of `dispatch()` is rendered by the Hono exit's own recogniser.
 * `RestServer` is the same stack's REST door, its routes called directly.
 *
 * Every body is asserted whole. The `hint`'s words are `RestServer`'s, read
 * off its answer rather than spelled here.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { declaredEnvelopeForThrow } from '@objectstack/plugin-hono-server';
import { RestServer } from '@objectstack/rest';
import { HttpDispatcher } from './http-dispatcher.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

const PREFIX = '/api/v1';
/** `registry.registerObject` requires a package id (see the sibling real-stack tests). */
const TEST_PACKAGE_ID = 'objectstack-test';
const OBJECT = 'drift_line_26031';

/** The metadata the table was built from: `legacy_code` is a NOT NULL column. */
const BUILT = {
    name: OBJECT,
    label: 'Drift line',
    fields: {
        id: { name: 'id', type: 'text' as const, primaryKey: true, label: 'ID' },
        name: { name: 'name', type: 'text' as const, label: 'Name' },
        legacy_code: { name: 'legacy_code', type: 'text' as const, label: 'Legacy code', storage: { notNull: true } },
    },
    actions: [
        { name: 'add_line', label: 'Add line', type: 'script', target: 'add_line' },
    ],
};

/** The metadata the doors serve afterwards: `legacy_code` is no longer declared. */
const SERVED = (() => {
    const { legacy_code: _dropped, ...fields } = BUILT.fields;
    return { ...BUILT, fields };
})();

const MEMBER = { userId: 'u_member', isSystem: false };

let engine: ObjectQL;
let dispatcher: HttpDispatcher;
let rest: RestServer;

afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
});

beforeAll(async () => {
    engine = new ObjectQL();
    engine.registerDriver(new SqlDriver({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
    }), true);
    await engine.init();
    engine.registry.registerObject(BUILT as any, TEST_PACKAGE_ID);
    await engine.syncSchemas();
    // A real `single` install's Default Organization (ADR-0131 D9).
    await installDefaultOrganization(engine);
    await engine.insert(OBJECT, { id: 'e1', name: 'existing', legacy_code: 'L1' } as any);
    engine.registry.registerObject(SERVED as any, TEST_PACKAGE_ID);
    (engine as any).registerAction(OBJECT, 'add_line', async (ctx: any) => {
        await ctx.engine.insert(OBJECT, { id: 'a1', name: 'from the action' });
        return { written: true };
    });

    const protocol = new ObjectStackProtocolImplementation(engine as any);
    const services: Record<string, unknown> = { objectql: engine, data: engine, protocol };
    const get = (n: string) => services[n] ?? null;
    const kernel: any = { context: { getService: get }, getService: get, getServiceAsync: async (n: string) => get(n) };
    dispatcher = new HttpDispatcher(kernel);
    (dispatcher as any).timedResolveExecutionContext = async () => ({ ...MEMBER });

    const noop = () => {};
    const server = { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
    rest = new RestServer(server as any, protocol as any, { api: { requireAuth: false } } as any);
    (rest as any).resolveExecCtx = async () => ({ userId: MEMBER.userId });
    rest.registerRoutes();
}, 60_000);

/**
 * A request as `@objectstack/hono`'s catch-all hands it to `dispatch()`: the
 * answer `dispatch()` returned, or, for a throw, what the Hono exit makes of it
 * (`undefined` there is its bare `500`).
 */
async function door(method: string, path: string, body: unknown) {
    const request = new Request(`http://localhost${PREFIX}${path}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
    try {
        const res: any = await dispatcher.dispatch(method, path, body, {}, { request } as any, PREFIX);
        return { returned: res?.response as { status: number; body: any } | undefined };
    } catch (thrown) {
        return { thrown, hono: declaredEnvelopeForThrow(thrown) };
    }
}

/** A `RestServer` route, called as its host calls it. */
async function restDoor(method: string, path: string, body: unknown, params: Record<string, string>) {
    const route = rest.getRoutes().find((r: any) => r.method === method && r.path === path);
    expect(route, `${method} ${path}`).toBeDefined();
    const res: any = {
        write: () => true, end: () => {},
        header: () => res,
        status: (code: number) => { res._status = code; return res; },
        json: (json: any) => { res._json = json; return res; },
    };
    await route!.handler({ params, body, query: {}, headers: {} } as any, res);
    return { status: res._status ?? 200, body: res._json };
}

/** `RestServer`'s answer for the drifted column, asserted whole. */
async function restAnswer() {
    const answer = await restDoor('POST', `${PREFIX}/data/:object`, { id: 'r1', name: 'through rest' }, { object: OBJECT });
    expect(answer.status, JSON.stringify(answer.body)).toBe(400);
    expect(answer.body).toEqual({
        error: 'legacy_code is required',
        code: 'VALIDATION_FAILED',
        fields: [{ field: 'legacy_code', code: 'required', message: 'legacy_code is required' }],
        hint: expect.any(String),
        object: OBJECT,
    });
    return answer.body as Record<string, unknown>;
}

/** The dispatcher envelope carrying `RestServer`'s body: the sentence, the code, the rest in `details`. */
function dispatcherEnvelopeOf(restBody: Record<string, unknown>) {
    const { error: message, code, ...details } = restBody;
    return { success: false, error: { code, message, httpStatus: 400, details } };
}

function expectNoDriverText(body: unknown) {
    expect(JSON.stringify(body)).not.toMatch(/constraint failed|SQLITE_|insert into/);
}

const rowCount = async (id: string) => (await engine.find(OBJECT, { where: { id } })).length;

describe('[#26031] a NOT NULL refusal on a drifted column answers RestServer\'s body on every door', () => {
    it('`RestServer` `POST /data/:object`: the arm\'s body, the reference', async () => {
        const body = await restAnswer();
        expectNoDriverText(body);
        expect(await rowCount('r1')).toBe(0);
    });

    it('the dispatcher `POST /data/:object`: the same body, returned, not a thrown 500', async () => {
        const reference = await restAnswer();
        const answer = await door('POST', `/data/${OBJECT}`, { id: 'n1', name: 'through the dispatcher' });
        expect(answer, JSON.stringify(answer)).toEqual({
            returned: { status: 400, body: dispatcherEnvelopeOf(reference) },
        });
        expectNoDriverText(answer);
        expect(await rowCount('n1')).toBe(0);
    });

    it('`POST /actions/:object/:action`, a handler whose insert leaves the column out: the same body', async () => {
        const reference = await restAnswer();
        const answer = await door('POST', `/actions/${OBJECT}/add_line/e1`, {});
        expect(answer, JSON.stringify(answer)).toEqual({
            returned: { status: 400, body: dispatcherEnvelopeOf(reference) },
        });
        expectNoDriverText(answer);
        expect(await rowCount('a1')).toBe(0);
    });

    it('the control: a `PATCH` naming the dropped field is refused before the driver, alike on both `/data` doors', async () => {
        const viaRest = await restDoor('PATCH', `${PREFIX}/data/:object/:id`, { legacy_code: null }, { object: OBJECT, id: 'e1' });
        expect(viaRest).toEqual({
            status: 400,
            body: { error: `Unknown field 'legacy_code' on object '${OBJECT}'`, code: 'INVALID_FIELD', field: 'legacy_code', object: OBJECT },
        });
        const viaDispatcher = await door('PATCH', `/data/${OBJECT}/e1`, { legacy_code: null });
        expect((viaDispatcher as { hono?: unknown }).hono).toEqual({
            status: 400,
            body: {
                success: false,
                error: {
                    code: 'INVALID_FIELD',
                    message: `Unknown field 'legacy_code' on object '${OBJECT}'`,
                    details: { field: 'legacy_code', object: OBJECT },
                },
            },
        });
        const stored = await engine.findOne(OBJECT, { where: { id: 'e1' } }) as any;
        expect(stored?.name).toBe('existing');
    });
});
