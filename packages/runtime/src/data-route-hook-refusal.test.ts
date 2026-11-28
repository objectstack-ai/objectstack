// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#38232] `dispatch()` answers a sandboxed hook's refusal on a `/data/:object`
 * write as `RestServer`'s `/data` routes answer it (`mapDataError`): the same
 * status, `code`, `declaredCode`, sentence, `userMessage` (cut at 500
 * characters) and `details.refusals` (whole), whether the hook refused with a
 * code of its own or a registered one; and a free-text throw with no code as
 * those routes' `400 HOOK_ABORTED`.
 *
 * ## The rig
 *
 * A REAL store (better-sqlite3 `:memory:` under `driver-sql`), the real
 * `ObjectQL` engine and protocol, and a REAL sandboxed hook body
 * (`hookBodyRunnerFactory` over `QuickJSScriptRunner`) bound as the object's
 * `beforeInsert`, declaring a `refusals` catalogue and throwing a three-reason
 * list whose `userMessage` runs past the bound. The dispatcher is reached the
 * way `@objectstack/hono`'s catch-all reaches it, `dispatch()` over a real Fetch
 * `Request`, with the identity step the one stubbed seam.
 *
 * The REST twin is `mapDataError` asked of the throw the protocol raises for the
 * same write, which is the call `RestServer`'s create route makes. The composed
 * host (`createHonoApp` over this dispatcher) is pinned in
 * `packages/qa/http-conformance/src/hono-declared-envelope.conformance.test.ts`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { mapDataError } from '@objectstack/types';
import { HttpDispatcher } from './http-dispatcher.js';
import { hookBodyRunnerFactory } from './sandbox/body-runner.js';
import { QuickJSScriptRunner } from './sandbox/quickjs-runner.js';
import { installDefaultOrganization } from './default-organization.testkit.js';
// Paid at collection, not inside a case's window: `http-dispatcher.ts` reaches it
// through a dynamic import (`pnpm check:test-source-alias`).
import '@objectstack/metadata';

const PREFIX = '/api/v1';
const TEST_PACKAGE_ID = 'objectstack-test';
const MEMBER = { userId: 'u_member', isSystem: false };
/** A param long enough that the joined `userMessage` passes the bound. */
const LONG = 'x'.repeat(200);
/** The REST routes' bound on a client message (`CLIENT_MESSAGE_MAX`, `@objectstack/types`, module-private). */
const CLIENT_MESSAGE_MAX = 500;

/** One object per refusal code, so each hook binds to its own object. */
const CASES = [
    // A code of the hook's own: not a member of the registered vocabulary.
    { code: 'OVERLAP', object: 'booking_own_38232' },
    // A registered code.
    { code: 'RESOURCE_CONFLICT', object: 'booking_registered_38232' },
] as const;
/** A hook with no catalogue that throws free text: no code, no status. */
const UNDECLARED_OBJECT = 'booking_undeclared_38232';

/** A sandboxed hook that refuses every insert with a three-reason list under `code`. */
function refusingHook(code: string, object: string) {
    return {
        name: 'refuse_overlap',
        object,
        events: ['beforeInsert'],
        body: {
            language: 'js',
            source: `throw { code: '${code}', reasons: [`
                + `{ reason: 'a', params: { n: '${LONG}' } }, `
                + `{ reason: 'b', params: { n: '${LONG}' } }, `
                + `{ reason: 'c', params: { n: '${LONG}' } }] };`,
            capabilities: [],
        },
        refusals: {
            [code]: {
                message: 'Pick another slot.',
                params: ['n'],
                status: 409,
                reasons: {
                    a: { message: 'First clash {{ n }}' },
                    b: { message: 'Second clash {{ n }}' },
                    c: { message: 'Third clash {{ n }}' },
                },
            },
        },
    };
}

let engine: ObjectQL;
let protocol: ObjectStackProtocolImplementation;
let dispatcher: HttpDispatcher;
const runner = new QuickJSScriptRunner({ hookTimeoutMs: 10_000 });

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
    const bind = hookBodyRunnerFactory(runner, { ql: engine, appId: 'crm' });
    for (const { code, object } of CASES) {
        engine.registry.registerObject({
            name: object,
            label: 'Booking',
            fields: { name: { name: 'name', type: 'text' as const, label: 'Name' } },
        } as any, TEST_PACKAGE_ID);
        engine.registerHook('beforeInsert', bind(refusingHook(code, object) as any)!, { object });
    }
    engine.registry.registerObject({
        name: UNDECLARED_OBJECT,
        label: 'Booking',
        fields: { name: { name: 'name', type: 'text' as const, label: 'Name' } },
    } as any, TEST_PACKAGE_ID);
    engine.registerHook('beforeInsert', bind({
        name: 'refuse_free_text',
        object: UNDECLARED_OBJECT,
        events: ['beforeInsert'],
        body: { language: 'js', source: "throw new Error('This slot is taken.');", capabilities: [] },
    } as any)!, { object: UNDECLARED_OBJECT });
    await engine.syncSchemas();
    await installDefaultOrganization(engine);
    protocol = new ObjectStackProtocolImplementation(engine as any);
    const services: Record<string, unknown> = { objectql: engine, data: engine, protocol };
    const get = (n: string) => services[n] ?? null;
    const kernel: any = { context: { getService: get }, getService: get, getServiceAsync: async (n: string) => get(n) };
    dispatcher = new HttpDispatcher(kernel);
    (dispatcher as any).timedResolveExecutionContext = async () => ({ ...MEMBER });
}, 60_000);

/** `POST /data/:object`, as `@objectstack/hono`'s catch-all hands it to `dispatch()`. */
async function post(object: string, body: Record<string, unknown>) {
    const request = new Request(`http://localhost${PREFIX}/data/${object}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
    return dispatcher.dispatch('POST', `/data/${object}`, body, {}, { request } as any, PREFIX);
}

/** What `RestServer`'s create route answers for the same write: `mapDataError` of the protocol's throw. */
async function restAnswer(object: string, body: Record<string, unknown>) {
    const thrown = await protocol.createData({ object, data: body })
        .then(() => undefined, (e: unknown) => e);
    expect(thrown, 'the protocol refused the write').toBeDefined();
    return mapDataError(thrown, object);
}

describe('[#38232] `dispatch()` answers a hook refusal on `/data` as the REST routes do', () => {
    for (const { code, object } of CASES) {
        it(`a refusal coded \`${code}\``, async () => {
            const result: any = await post(object, { name: 'clash' });
            const rest = await restAnswer(object, { name: 'clash' });

            // Answered by `dispatch()`, not thrown on to the host's catch-all.
            expect(result?.handled).toBe(true);
            const { status, body, headers } = result.response;
            const error = body.error;

            expect(rest.status).toBe(409);
            expect(status).toBe(rest.status);
            expect(body.success).toBe(false);
            expect(error.code).toBe(rest.body.code);
            expect(error.declaredCode).toBe(rest.body.declaredCode);
            expect(error.message).toBe(rest.body.error);

            // The `userMessage` is cut where the REST routes cut it…
            expect(typeof rest.body.userMessage).toBe('string');
            expect((rest.body.userMessage as string).length).toBe(CLIENT_MESSAGE_MAX);
            expect(error.userMessage).toBe(rest.body.userMessage);
            // …and every reason's line stays whole.
            const refusals = (rest.body.details as any)?.refusals;
            expect(refusals).toHaveLength(3);
            expect(error.details?.refusals).toEqual(refusals);
            expect(error.details?.object).toBe(object);

            // A localized `userMessage` varies the answer by language.
            expect(headers?.Vary).toEqual(['Accept-Language']);

            expect(await engine.find(object, {})).toHaveLength(0);
        });
    }

    it('a hook that throws free text, declaring no code or status: the REST routes\' `400 HOOK_ABORTED` and its sentence', async () => {
        const result: any = await post(UNDECLARED_OBJECT, { name: 'clash' });
        const rest = await restAnswer(UNDECLARED_OBJECT, { name: 'clash' });
        expect(result?.handled).toBe(true);
        const error = result.response.body.error;
        expect(rest.status).toBe(400);
        expect(rest.body.code).toBe('HOOK_ABORTED');
        expect(result.response.status).toBe(rest.status);
        expect(error.code).toBe(rest.body.code);
        expect(error.message).toBe(rest.body.error);
        expect(error.message).toBe('This slot is taken.');
        expect(await engine.find(UNDECLARED_OBJECT, {})).toHaveLength(0);
    });

    it('a hook\'s own code travels as `declaredCode` beside the registered `code`', async () => {
        const result: any = await post(CASES[0].object, { name: 'clash' });
        expect(result.response.body.error.declaredCode).toBe('OVERLAP');
        expect(result.response.body.error.code).not.toBe('OVERLAP');
        expect(result.response.body.error.code).not.toBe('INTERNAL_ERROR');
    });
});
