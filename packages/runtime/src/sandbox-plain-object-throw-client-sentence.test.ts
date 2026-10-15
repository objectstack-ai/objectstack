// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23718] A sandboxed body that throws a plain `{ code, message }` object is
 * answered at the doors with that `message` as the client sentence, and its
 * code kept, with no change at any door.
 *
 * ## What was wrong
 *
 * The wrapper's reject handler (`sandbox/quickjs-runner.ts`) flattened every
 * rejection as `<name>: <message>`, else `String(e)`, and that string became
 * the `innerMessage` every door serves as the caller's sentence. A plain object
 * has no class name and no `toString` of its own, so
 * `POST /api/v1/actions/:object/:action` answered
 * `400 … "undefined: That address is already on file"` for
 * `throw { code: 'EMAIL_TAKEN', message: 'That address is already on file' }`
 * and `400 DUPLICATE_RECORD "[object Object]"` for
 * `throw { code: 'DUPLICATE_RECORD' }`. A sandboxed HOOK body throwing the same
 * values broke the same way, at the action door behind a write and in the
 * `/data` classification.
 *
 * ## The rig
 *
 * PR #23717's: better-sqlite3 `:memory:` under the real `ObjectQL`, action
 * bodies bound through `actionBodyRunnerFactory` over a real
 * `QuickJSScriptRunner`, hook bodies through `hookBodyRunnerFactory`, and the
 * dispatcher reached through `dispatch()` over a real Fetch `Request`, the
 * identity step the one stubbed seam. The `/data` classification is read at
 * function level (`mapDataError`), as PR #23717 read it.
 *
 * The sentence IS the contract here (the author's own words, relayed verbatim),
 * so it is asserted exactly; for a value with no message it is asserted to be
 * the shared `INTERNAL_ERROR_MESSAGE` constant, never a literal.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL, bindHooksToEngine } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { INTERNAL_ERROR_MESSAGE, mapDataError } from '@objectstack/types';
import { HttpDispatcher } from './http-dispatcher.js';
import { actionBodyRunnerFactory, hookBodyRunnerFactory } from './sandbox/body-runner.js';
import { QuickJSScriptRunner } from './sandbox/quickjs-runner.js';

const PREFIX = '/api/v1';
/** `registry.registerObject` requires a package id (see the sibling real-stack tests). */
const TEST_PACKAGE_ID = 'objectstack-test';
const SENTENCE = 'That address is already on file';

/** A `type: 'script'` action whose body is `source`. */
const scriptAction = (name: string, source: string) => ({
    name,
    label: name,
    type: 'script',
    body: { language: 'js', source, capabilities: ['api.read', 'api.write'] },
});

/** A write to `tdoc` whose `name` tells the sandboxed `guard` hook what to throw. */
const insertTdoc = (name: string) =>
    `await ctx.api.object('tdoc').insert({ id: 't_' + Math.random().toString(36).slice(2), name: '${name}' });`;

const ACTIONS = [
    scriptAction('throw_message', `throw { code: 'EMAIL_TAKEN', message: '${SENTENCE}' };`),
    scriptAction('throw_no_message', `throw { code: 'DUPLICATE_RECORD' };`),
    // CONTROL — a thrown `Error` answers as before.
    scriptAction('throw_error', `throw new Error('x');`),
    // Two VM hops: this body's write fires `guard`'s sandboxed hook, which throws the plain object.
    scriptAction('write_hooked_message', `${insertTdoc('message')} return { written: true };`),
];

/** Host-code handlers whose engine write fires `guard`'s sandboxed hook. */
const HOOKED_BY_HANDLER = ['message', 'no_message', 'error'] as const;

const PDOC = {
    name: 'pdoc',
    label: 'Plain-throw doc',
    fields: {
        id: { name: 'id', type: 'text' as const, primaryKey: true, label: 'ID' },
        name: { name: 'name', type: 'text' as const, label: 'Name' },
    },
    actions: [
        ...ACTIONS,
        ...HOOKED_BY_HANDLER.map((k) => ({ name: `hooked_${k}`, label: `Hooked ${k}`, type: 'script', target: `hooked_${k}` })),
    ],
};

const TDOC = {
    name: 'tdoc',
    label: 'Hook-guarded doc',
    fields: {
        id: { name: 'id', type: 'text' as const, primaryKey: true, label: 'ID' },
        name: { name: 'name', type: 'text' as const, label: 'Name' },
    },
};

/** A sandboxed `beforeInsert` hook body that throws what the record's `name` asks for. */
const GUARD_HOOK = {
    name: 'guard',
    object: 'tdoc',
    events: ['beforeInsert'],
    body: {
        language: 'js',
        source: `
            if (ctx.input.name === 'message') throw { code: 'EMAIL_TAKEN', message: '${SENTENCE}' };
            if (ctx.input.name === 'no_message') throw { code: 'DUPLICATE_RECORD' };
            if (ctx.input.name === 'error') throw new Error('x');
        `,
        capabilities: [],
    },
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
    for (const o of [PDOC, TDOC]) engine.registry.registerObject(o as any, TEST_PACKAGE_ID);
    await engine.syncSchemas();

    const ql = engine as any;
    const bindBody = actionBodyRunnerFactory(new QuickJSScriptRunner(), { ql: engine, appId: 'pdoc_app' });
    for (const action of ACTIONS) ql.registerAction('pdoc', action.name, bindBody({ ...action, object: 'pdoc' }));
    for (const k of HOOKED_BY_HANDLER) {
        ql.registerAction('pdoc', `hooked_${k}`, async (ctx: any) => {
            await ctx.engine.insert('tdoc', { id: 't_' + Math.random().toString(36).slice(2), name: k });
            return { written: true };
        });
    }
    engine.setDefaultBodyRunner(hookBodyRunnerFactory(new QuickJSScriptRunner(), { ql: engine, appId: 'pdoc_app' }));
    bindHooksToEngine(engine, [GUARD_HOOK as any], { packageId: TEST_PACKAGE_ID });

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

/** `POST /api/v1/actions/pdoc/<action>` as `@objectstack/hono`'s catch-all hands it to `dispatch()`. */
async function postAction(action: string) {
    const path = `/actions/pdoc/${action}`;
    const request = new Request(`http://localhost${PREFIX}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
    });
    const res: any = await dispatcher.dispatch('POST', path, {}, {}, { request } as any, PREFIX);
    return res.response as { status: number; body: any };
}

/** `{ code: 'EMAIL_TAKEN', message }`: the message verbatim, the unregistered code on `declaredCode` as before. */
function expectMessageSentence(response: { status: number; body: any }) {
    expect(response.status, JSON.stringify(response.body)).toBe(400);
    const error = response.body?.error;
    expect(error?.message).toBe(SENTENCE);
    expect(error?.code).toBe('VALIDATION_ERROR');
    expect(error?.declaredCode).toBe('EMAIL_TAKEN');
}

/** `{ code: 'DUPLICATE_RECORD' }`: the no-business-message sentence, the registered code kept. */
function expectNoMessageSentence(response: { status: number; body: any }) {
    expect(response.status, JSON.stringify(response.body)).toBe(400);
    const error = response.body?.error;
    expect(error?.message).toBe(INTERNAL_ERROR_MESSAGE);
    expect(error?.code).toBe('DUPLICATE_RECORD');
    expect(JSON.stringify(response.body)).not.toContain('[object Object]');
}

/** The error `engine.insert('tdoc')` rejects with when `guard` throws for `name`. */
async function hookRefusal(name: string): Promise<unknown> {
    const err = await engine.insert('tdoc', { id: 'd_' + Math.random().toString(36).slice(2), name }).then(
        () => undefined,
        (e: unknown) => e,
    );
    expect(err, `guard did not refuse '${name}'`).toBeDefined();
    return err;
}

describe('[#23718] the action door answers a body\'s thrown plain object with its own message', () => {
    it('{ code, message }: the message is the client sentence, and the code is kept', async () => {
        expectMessageSentence(await postAction('throw_message'));
    });

    it('{ code } with no message: not [object Object], and the code is kept', async () => {
        expectNoMessageSentence(await postAction('throw_no_message'));
    });

    it('CONTROL — a thrown Error answers as before', async () => {
        const response = await postAction('throw_error');
        expect(response.status, JSON.stringify(response.body)).toBe(400);
        expect(response.body?.error?.code).toBe('VALIDATION_ERROR');
        expect(response.body?.error?.message).toBe('x');
    });
});

describe('[#23718] a sandboxed hook body\'s thrown plain object, at the action door behind a write', () => {
    it('{ code, message }, behind a host handler\'s write', async () => {
        expectMessageSentence(await postAction('hooked_message'));
        expect(await engine.find('tdoc', {})).toHaveLength(0);
    });

    it('{ code } with no message, behind a host handler\'s write', async () => {
        expectNoMessageSentence(await postAction('hooked_no_message'));
    });

    it('{ code, message }, behind a script body\'s write (two VM hops)', async () => {
        expectMessageSentence(await postAction('write_hooked_message'));
        expect(await engine.find('tdoc', {})).toHaveLength(0);
    });

    it('CONTROL — the hook\'s thrown Error answers as before', async () => {
        const response = await postAction('hooked_error');
        expect(response.status, JSON.stringify(response.body)).toBe(400);
        expect(response.body?.error?.message).toBe('x');
    });
});

describe('[#23718] the /data classification of the same hook refusals', () => {
    it('{ code, message }: the message is the sentence, the code on declaredCode', async () => {
        const { status, body } = mapDataError(await hookRefusal('message'), 'tdoc');
        expect(status, JSON.stringify(body)).toBe(400);
        expect(body.error).toBe(SENTENCE);
        expect(body.declaredCode).toBe('EMAIL_TAKEN');
    });

    it('{ code } with no message: not [object Object], and the code is kept', async () => {
        const { status, body } = mapDataError(await hookRefusal('no_message'), 'tdoc');
        expect(status, JSON.stringify(body)).toBe(400);
        expect(body.error).toBe(INTERNAL_ERROR_MESSAGE);
        expect(body.code).toBe('DUPLICATE_RECORD');
    });

    it('CONTROL — the hook\'s thrown Error is classified as before', async () => {
        const { status, body } = mapDataError(await hookRefusal('error'), 'tdoc');
        expect(status, JSON.stringify(body)).toBe(400);
        expect(body.error).toBe('x');
    });
});
