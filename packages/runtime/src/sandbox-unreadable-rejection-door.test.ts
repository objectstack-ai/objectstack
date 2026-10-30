// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23723] At `POST /api/v1/actions/:object/:action`, a `type: 'script'`
 * action whose body throws a value no read can flatten answers at once, with
 * the status and envelope the door already gives a body that threw, and the
 * fixed sentence as the message. No door changed.
 *
 * ## What was wrong
 *
 * The wrapper's reject handler (`sandbox/quickjs-runner.ts`) left `__error`
 * unset or empty for `throw ''`, a null-prototype object, and an object whose
 * `message` getter throws. The run waited for the wall-clock ceiling (30 s by
 * default) and ended as a budget `SandboxError` with no `innerMessage`, which
 * the door answers `500 INTERNAL_ERROR`, naming no refusal.
 *
 * ## The rig
 *
 * PR #23722's: better-sqlite3 `:memory:` under the real `ObjectQL`, action
 * bodies bound through `actionBodyRunnerFactory` over a real
 * `QuickJSScriptRunner`, and the dispatcher reached through `dispatch()` over
 * a real Fetch `Request`, the identity step the one stubbed seam. The runner
 * has a 1000 ms wall ceiling (CPU budget the same), so an answer other than
 * the ceiling's `500` is an answer within a second by construction.
 *
 * The sentence is the ruled one, so it is asserted exactly, beside the code
 * and status.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { HttpDispatcher } from './http-dispatcher.js';
import { actionBodyRunnerFactory } from './sandbox/body-runner.js';
import { QuickJSScriptRunner } from './sandbox/quickjs-runner.js';

const PREFIX = '/api/v1';
/** `registry.registerObject` requires a package id (see the sibling real-stack tests). */
const TEST_PACKAGE_ID = 'objectstack-test';
const CEILING_MS = 1000;
const UNREADABLE = 'the script threw a value that could not be read';
const SENTENCE = 'That address is already on file';

/** A `type: 'script'` action whose body is `source`. */
const scriptAction = (name: string, source: string) => ({
    name,
    label: name,
    type: 'script',
    body: { language: 'js', source, capabilities: [] },
});

const ACTIONS = [
    scriptAction('throw_getter', `throw { code: 'EMAIL_TAKEN', get message() { throw new Error('boom at host'); } };`),
    scriptAction('throw_empty_string', `throw '';`),
    scriptAction('throw_null_proto', `throw Object.create(null);`),
    // CONTROL — a readable `{ code, message }` keeps PR #23722's answer.
    scriptAction('throw_message', `throw { code: 'EMAIL_TAKEN', message: '${SENTENCE}' };`),
    // CONTROL — a body that never settles still ends at the ceiling.
    scriptAction('never_settles', `await new Promise(() => {});`),
];

const RDOC = {
    name: 'rdoc',
    label: 'Unreadable-throw doc',
    fields: {
        id: { name: 'id', type: 'text' as const, primaryKey: true, label: 'ID' },
        name: { name: 'name', type: 'text' as const, label: 'Name' },
    },
    actions: ACTIONS,
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
    engine.registry.registerObject(RDOC as any, TEST_PACKAGE_ID);
    await engine.syncSchemas();

    const runner = new QuickJSScriptRunner({ actionTimeoutMs: CEILING_MS, wallCeilingMs: CEILING_MS });
    const bindBody = actionBodyRunnerFactory(runner, { ql: engine, appId: 'rdoc_app' });
    for (const action of ACTIONS) (engine as any).registerAction('rdoc', action.name, bindBody({ ...action, object: 'rdoc' }));

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

/** `POST /api/v1/actions/rdoc/<action>` as `@objectstack/hono`'s catch-all hands it to `dispatch()`. */
async function postAction(action: string) {
    const path = `/actions/rdoc/${action}`;
    const request = new Request(`http://localhost${PREFIX}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
    });
    const res: any = await dispatcher.dispatch('POST', path, {}, {}, { request } as any, PREFIX);
    return res.response as { status: number; body: any };
}

describe('[#23723] the action door answers an unreadable rejection at once, as a body that threw', () => {
    it('{ code, get message() { throw } }: 400, the code kept on declaredCode, the fixed sentence', async () => {
        const response = await postAction('throw_getter');
        expect(response.status, JSON.stringify(response.body)).toBe(400);
        const error = response.body?.error;
        expect(error?.code).toBe('VALIDATION_ERROR');
        expect(error?.declaredCode).toBe('EMAIL_TAKEN');
        expect(error?.message).toBe(UNREADABLE);
        expect(JSON.stringify(response.body)).not.toContain('boom');
    });

    it("throw '': 400, the fixed sentence", async () => {
        const response = await postAction('throw_empty_string');
        expect(response.status, JSON.stringify(response.body)).toBe(400);
        // [#27672] FLIPPED on purpose from `VALIDATION_ERROR`: the body declared
        // no code, so this is an undeclared abort, answered `HOOK_ABORTED`.
        expect(response.body?.error?.code).toBe('HOOK_ABORTED');
        expect(response.body?.error?.message).toBe(UNREADABLE);
    });

    it('throw Object.create(null): 400, the fixed sentence', async () => {
        const response = await postAction('throw_null_proto');
        expect(response.status, JSON.stringify(response.body)).toBe(400);
        // [#27672] FLIPPED on purpose from `VALIDATION_ERROR`: the body declared
        // no code, so this is an undeclared abort, answered `HOOK_ABORTED`.
        expect(response.body?.error?.code).toBe('HOOK_ABORTED');
        expect(response.body?.error?.message).toBe(UNREADABLE);
    });
});

describe('[#23723] CONTROL — the door\'s other answers stand', () => {
    it("{ code, message } keeps PR #23722's answer", async () => {
        const response = await postAction('throw_message');
        expect(response.status, JSON.stringify(response.body)).toBe(400);
        const error = response.body?.error;
        expect(error?.code).toBe('VALIDATION_ERROR');
        expect(error?.declaredCode).toBe('EMAIL_TAKEN');
        expect(error?.message).toBe(SENTENCE);
    });

    it('a body that never settles still ends at the ceiling: 500, naming no refusal', async () => {
        const response = await postAction('never_settles');
        expect(response.status, JSON.stringify(response.body)).toBe(500);
        expect(response.body?.error?.code).toBe('INTERNAL_ERROR');
    });
});
