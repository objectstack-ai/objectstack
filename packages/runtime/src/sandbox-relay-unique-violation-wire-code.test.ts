// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23702] A sandboxed body that lets the engine's `DuplicateRecordError`
 * leave answers the ruled wire spelling, `409 UNIQUE_VIOLATION`, at the action
 * door — with no change at the door.
 *
 * Maintainer ruling recorded in commit 65846bc46: one wire spelling on every
 * route, `UNIQUE_VIOLATION`. Its docblock (`metadata-protocol`'s `protocol.ts`)
 * keeps the code for "a producer that merely SPEAKS `DUPLICATE_RECORD`".
 *
 * ## What was wrong
 *
 * The dispatcher translates the engine's class (#23686), keyed on its declared
 * contract, code AND class name. A `type: 'script'` action whose sandboxed
 * body called `ctx.api.object('udoc').insert(…)` with a taken unique value and
 * did not catch reached it as a `SandboxError` instead (code and status lifted,
 * class dropped by the QuickJS relay), so `POST /api/v1/actions/udoc/:action`
 * answered `409 {"code":"DUPLICATE_RECORD","message":"DuplicateRecordError:
 * Duplicate record refused on 'udoc': …"}`. The same held for a sandboxed HOOK
 * body that lets the refusal of its own write leave.
 *
 * ## The rig
 *
 * #23686's: better-sqlite3 `:memory:` under the real `ObjectQL`, the action
 * bodies bound through `actionBodyRunnerFactory` over a real
 * `QuickJSScriptRunner`, the hook bodies through `hookBodyRunnerFactory`, and
 * the dispatcher reached through `dispatch()` over a real Fetch `Request`, the
 * identity step the one stubbed seam. Codes and key presence are asserted,
 * never wording.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL, bindHooksToEngine } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { HttpDispatcher } from './http-dispatcher.js';
import { actionBodyRunnerFactory, hookBodyRunnerFactory } from './sandbox/body-runner.js';
import { QuickJSScriptRunner } from './sandbox/quickjs-runner.js';

const PREFIX = '/api/v1';
/** `registry.registerObject` requires a package id (see the sibling real-stack tests). */
const TEST_PACKAGE_ID = 'objectstack-test';
/** The value `r1` holds; every write below that repeats it is refused by the unique key. */
const TAKEN = 'taken@example.com';

/** A write repeating {@link TAKEN}, under an id no other write uses. */
const INSERT_TAKEN = `await ctx.api.object('udoc').insert({ id: 'r_' + Math.random().toString(36).slice(2), name: 'second', email: '${TAKEN}' });`;

/** A `type: 'script'` action whose body is `source`. */
const scriptAction = (name: string, source: string) => ({
    name,
    label: name,
    type: 'script',
    body: { language: 'js', source, capabilities: ['api.read', 'api.write'] },
});

const ACTIONS = [
    scriptAction('add_duplicate', `${INSERT_TAKEN} return { written: true };`),
    scriptAction('rethrow_duplicate', `try { ${INSERT_TAKEN} } catch (e) { throw e; } return { written: true };`),
    // CONTROL — a body that SPEAKS the registered code with its own error.
    scriptAction('speak_duplicate', `throw Object.assign(new Error('That address is already on file'), { code: 'DUPLICATE_RECORD', status: 409 });`),
    // CONTROL — …and one whose own error names itself the engine's class.
    scriptAction('forge_duplicate', `const e = new Error('That address is already on file'); e.name = 'DuplicateRecordError'; e.code = 'DUPLICATE_RECORD'; e.status = 409; throw e;`),
    // Two VM hops: this body's write fires `mirror`'s sandboxed hook, whose write is refused.
    scriptAction('add_hooked', `await ctx.api.object('hdoc').insert({ id: 'h_' + Math.random().toString(36).slice(2), name: 'x' }); return { written: true };`),
];

const UDOC = {
    name: 'udoc',
    label: 'Unique doc',
    fields: {
        id: { name: 'id', type: 'text' as const, primaryKey: true, label: 'ID' },
        name: { name: 'name', type: 'text' as const, label: 'Name' },
        email: { name: 'email', type: 'text' as const, label: 'Email', unique: true },
    },
    actions: [
        ...ACTIONS,
        // A host-code handler whose engine write fires `mirror`'s sandboxed hook.
        { name: 'add_hooked_by_handler', label: 'Add hooked (handler)', type: 'script', target: 'add_hooked_by_handler' },
    ],
};

const HDOC = {
    name: 'hdoc',
    label: 'Hooked doc',
    fields: {
        id: { name: 'id', type: 'text' as const, primaryKey: true, label: 'ID' },
        name: { name: 'name', type: 'text' as const, label: 'Name' },
    },
};

/** A sandboxed `beforeInsert` hook body that lets its own write's refusal leave. */
const MIRROR_HOOK = {
    name: 'mirror',
    object: 'hdoc',
    events: ['beforeInsert'],
    body: { language: 'js', source: INSERT_TAKEN, capabilities: ['api.read', 'api.write'] },
};

const MEMBER = { userId: 'u_member', isSystem: false };

let engine: ObjectQL;
let dispatcher: HttpDispatcher;

beforeAll(async () => {
    engine = new ObjectQL();
    engine.registerDriver(new SqlDriver({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
    }), true);
    await engine.init();
    for (const o of [UDOC, HDOC]) engine.registry.registerObject(o as any, TEST_PACKAGE_ID);
    await engine.syncSchemas();

    const ql = engine as any;
    const bindBody = actionBodyRunnerFactory(new QuickJSScriptRunner(), { ql: engine, appId: 'udoc_app' });
    for (const action of ACTIONS) ql.registerAction('udoc', action.name, bindBody({ ...action, object: 'udoc' }));
    ql.registerAction('udoc', 'add_hooked_by_handler', async (ctx: any) => {
        await ctx.engine.insert('hdoc', { id: 'h_' + Math.random().toString(36).slice(2), name: 'x' });
        return { written: true };
    });
    engine.setDefaultBodyRunner(hookBodyRunnerFactory(new QuickJSScriptRunner(), { ql: engine, appId: 'udoc_app' }));
    bindHooksToEngine(engine, [MIRROR_HOOK as any], { packageId: TEST_PACKAGE_ID });

    await engine.insert('udoc', { id: 'r1', name: 'first', email: TAKEN });
    const protocol = new ObjectStackProtocolImplementation(engine as any);
    const services: Record<string, unknown> = { objectql: engine, data: engine, protocol };
    const get = (n: string) => services[n] ?? null;
    const kernel: any = { context: { getService: get }, getService: get, getServiceAsync: async (n: string) => get(n) };
    dispatcher = new HttpDispatcher(kernel);
    (dispatcher as any).timedResolveExecutionContext = async () => ({ ...MEMBER });
}, 60_000);

afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
});

/** `POST /api/v1/actions/udoc/<action>` as `@objectstack/hono`'s catch-all hands it to `dispatch()`. */
async function postAction(action: string) {
    const path = `/actions/udoc/${action}`;
    const request = new Request(`http://localhost${PREFIX}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
    });
    const res: any = await dispatcher.dispatch('POST', path, {}, {}, { request } as any, PREFIX);
    return res.response as { status: number; body: any };
}

/** The ruled answer: the code, and the dispatcher arm's fields for the object the engine refused. */
function expectUniqueViolation(response: { status: number; body: any }) {
    expect(response.status, JSON.stringify(response.body)).toBe(409);
    const error = response.body?.error;
    expect(error?.code).toBe('UNIQUE_VIOLATION');
    expect(error?.httpStatus).toBe(409);
    // The index is the tenancy-scoped composite, so the driver names no single column.
    expect(Object.keys(error?.details ?? {}).sort()).toEqual(['developerMessage', 'object']);
    expect(error.details.object).toBe('udoc');
    expect(error).not.toHaveProperty('declaredCode');
    // The in-process spelling does not cross, nor the relay's class-name prefix, nor the driver's text.
    const wire = JSON.stringify(response.body);
    expect(wire).not.toContain('DUPLICATE_RECORD');
    expect(wire).not.toContain('DuplicateRecordError');
    expect(wire).not.toContain('UNIQUE constraint failed');
}

/** A speaker's answer: its own registered code, carried as before, with no arm fields. */
function expectSpeaker(response: { status: number; body: any }) {
    expect(response.status, JSON.stringify(response.body)).toBe(409);
    const error = response.body?.error;
    expect(error?.code).toBe('DUPLICATE_RECORD');
    expect(error?.details ?? {}).not.toHaveProperty('developerMessage');
}

describe('[#23702] the action door answers a sandboxed body\'s uncaught engine duplicate as 409 UNIQUE_VIOLATION', () => {
    it('a script action body that lets the refusal of its write leave', async () => {
        expectUniqueViolation(await postAction('add_duplicate'));
        // Non-vacuity: the refusal is real, nothing was written.
        expect(await engine.find('udoc', { where: { email: TAKEN } })).toHaveLength(1);
    });

    it('…and one that catches it and re-throws it unchanged', async () => {
        expectUniqueViolation(await postAction('rethrow_duplicate'));
    });

    it('a host handler whose write fires a sandboxed hook body that lets its refusal leave', async () => {
        expectUniqueViolation(await postAction('add_hooked_by_handler'));
        expect(await engine.find('hdoc', {})).toHaveLength(0);
    });

    it('a script action body whose write fires that sandboxed hook (two VM hops)', async () => {
        expectUniqueViolation(await postAction('add_hooked'));
        expect(await engine.find('hdoc', {})).toHaveLength(0);
    });
});

describe('[#23702] CONTROL — a body that speaks DUPLICATE_RECORD keeps it', () => {
    it('a deliberate throw of the registered code', async () => {
        const response = await postAction('speak_duplicate');
        expectSpeaker(response);
        expect(response.body.error.message).toBe('That address is already on file');
    });

    it('a body\'s own error that names itself the engine\'s class', async () => {
        expectSpeaker(await postAction('forge_duplicate'));
    });
});
