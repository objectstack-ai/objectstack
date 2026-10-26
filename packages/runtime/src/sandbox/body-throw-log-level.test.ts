// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#26153] A sandboxed body's BUSINESS REFUSAL is logged once, at `info`,
 * without a stack; a FAULT keeps `error` and its stack.
 *
 * ## What was measured broken
 *
 * A `beforeUpdate` hook refusing a script action's `ctx.api` write
 * (`422 INVALID_STATE` on the wire) wrote two `ERROR [BodyRunner]` lines with
 * full stacks for one ordinary refusal: `sandboxed hook threw` at the hook's
 * catch, then `sandboxed action threw` at the action's catch for the same
 * refusal relayed across the VM hop. An operator watching ERROR could not tell
 * a refused click from a crashed hook.
 *
 * ## The line this file pins
 *
 * Refusal vs fault is read off {@link mapDataError} — the ADR-0112 table the
 * HTTP doors answer with — by its status band, never a second list. The last
 * block pins that, for every shape reaching these catches, its band is the
 * band the `/actions` door actually answers, so the log level cannot drift
 * from the status the caller saw.
 */

import { describe, it, expect, vi } from 'vitest';
import { mapDataError } from '@objectstack/types';

import { HttpDispatcher } from '../http-dispatcher.js';
import { actionBodyRunnerFactory, hookBodyRunnerFactory } from './body-runner.js';
import { QuickJSScriptRunner } from './quickjs-runner.js';

const REFUSAL = 'A current clean version is required before signing.';

const runner = new QuickJSScriptRunner({ hookTimeoutMs: 10_000, actionTimeoutMs: 10_000 });

interface LogCall { level: 'debug' | 'info' | 'warn' | 'error'; msg: string; err?: unknown; meta?: any }

/** A logger that records every call, so a test reads level, error argument and meta. */
function recordingLogger() {
    const calls: LogCall[] = [];
    return {
        calls,
        logger: {
            debug: (msg: string, meta?: any) => calls.push({ level: 'debug', msg, meta }),
            info: (msg: string, meta?: any) => calls.push({ level: 'info', msg, meta }),
            warn: (msg: string, meta?: any) => calls.push({ level: 'warn', msg, meta }),
            error: (msg: string, err?: unknown, meta?: any) => calls.push({ level: 'error', msg, err, meta }),
        },
        /** The calls an operator sees at the default level: everything above `debug`. */
        visible: () => calls.filter((c) => c.level !== 'debug'),
    };
}

/** Does any argument of this call carry a stack? */
function carriesStack(call: LogCall): boolean {
    const hasStack = (v: unknown) => typeof (v as { stack?: unknown } | null)?.stack === 'string';
    return hasStack(call.err) || hasStack(call.meta) || Object.values(call.meta ?? {}).some(hasStack);
}

const REFUSING_HOOK = `
    const e = new Error(${JSON.stringify(REFUSAL)});
    e.code = 'INVALID_STATE';
    e.status = 422;
    throw e;
`;
const CRASHING_HOOK = 'const v = null; return v.version;';

/** A sandboxed `beforeUpdate` hook bound through the real factory. */
function boundHook(logger: object, source: string) {
    const fn = hookBodyRunnerFactory(runner, { ql: {}, appId: 'clm', logger })({
        name: 'contract_state_machine',
        object: 'clm_contract',
        events: ['beforeUpdate'],
        body: { language: 'js', source },
    } as any);
    expect(fn, 'the hook body must bind').toBeTypeOf('function');
    return fn!;
}

/**
 * A script action whose `ctx.api` write dispatches the hook, as the engine
 * does: the update the body asks for runs the bound hook first.
 */
function boundAction(logger: object, hook: (ctx: any) => Promise<void>, source?: string) {
    const ql = {
        object: (object: string) => ({
            update: async (data: any) => {
                await hook({ object, event: 'beforeUpdate', input: { ...data } });
                return data;
            },
        }),
    };
    const fn = actionBodyRunnerFactory(runner, { ql, appId: 'clm', logger })({
        name: 'start_signing',
        object: 'clm_contract',
        type: 'script',
        body: {
            language: 'js',
            source: source ?? "return await ctx.api.object('clm_contract').update({ id: ctx.recordId, status: 'signing' });",
            capabilities: ['api.write'],
        },
    });
    expect(fn, 'the action body must bind').toBeTypeOf('function');
    return fn!;
}

async function rejectionOf(p: Promise<unknown>): Promise<any> {
    const err = await p.then(() => null, (e) => e);
    expect(err, 'expected the body to reject — a throw is never swallowed').not.toBeNull();
    return err;
}

describe('[#26153] a business refusal is logged once, at info, without a stack', () => {
    it('a hook refusal reached through a script action: one info line, no error line', async () => {
        const rec = recordingLogger();
        const action = boundAction(rec.logger, boundHook(rec.logger, REFUSING_HOOK));

        const err = await rejectionOf(action({ recordId: 'c_1', record: { id: 'c_1' } }));

        // Still rethrown, still the refusal the door answers 422 INVALID_STATE.
        expect(err.innerMessage).toBe(REFUSAL);
        expect(err.code).toBe('INVALID_STATE');
        expect(err.status).toBe(422);

        const visible = rec.visible();
        expect(visible.filter((c) => c.level === 'error'), 'a refusal is not an ERROR').toEqual([]);
        expect(visible, 'one line for one refusal — the action must not repeat its hook').toHaveLength(1);
        const [line] = visible;
        expect(line.level).toBe('info');
        expect(carriesStack(line), 'a refusal line carries no stack').toBe(false);
        expect(line.meta).toMatchObject({ hook: 'contract_state_machine', code: 'INVALID_STATE', status: 422 });
    });

    it('a hook refusal fired by a /data write (no action): one info line naming the hook', async () => {
        const rec = recordingLogger();
        const hook = boundHook(rec.logger, REFUSING_HOOK);

        await rejectionOf(hook({ object: 'clm_contract', event: 'beforeUpdate', input: { id: 'c_1' } }));

        const visible = rec.visible();
        expect(visible).toHaveLength(1);
        expect(visible[0].level).toBe('info');
        expect(carriesStack(visible[0])).toBe(false);
        expect(visible[0].meta).toMatchObject({ hook: 'contract_state_machine', code: 'INVALID_STATE', status: 422 });
    });

    it("an action body's OWN refusal: one info line naming the action", async () => {
        const rec = recordingLogger();
        const action = boundAction(rec.logger, async () => {}, REFUSING_HOOK);

        const err = await rejectionOf(action({ recordId: 'c_1' }));
        expect(err.status).toBe(422);

        const visible = rec.visible();
        expect(visible).toHaveLength(1);
        expect(visible[0].level).toBe('info');
        expect(carriesStack(visible[0])).toBe(false);
        expect(visible[0].meta).toMatchObject({ action: 'start_signing', code: 'INVALID_STATE', status: 422 });
    });
});

describe('[#26153] a fault keeps error and its stack', () => {
    it('a hook that crashes through an action: error with a stack at both catches (kept as before)', async () => {
        const rec = recordingLogger();
        const action = boundAction(rec.logger, boundHook(rec.logger, CRASHING_HOOK));

        await rejectionOf(action({ recordId: 'c_1' }));

        const visible = rec.visible();
        // A repeated FAULT is left as it was: the hook's line and the action's.
        expect(visible.map((c) => [c.level, c.msg])).toEqual([
            ['error', '[BodyRunner] sandboxed hook threw'],
            ['error', '[BodyRunner] sandboxed action threw'],
        ]);
        expect(visible.every(carriesStack), 'a fault keeps its stack').toBe(true);
    });

    it("an action body's own crash: one error line with a stack", async () => {
        const rec = recordingLogger();
        const action = boundAction(rec.logger, async () => {}, CRASHING_HOOK);

        await rejectionOf(action({ recordId: 'c_1' }));

        const visible = rec.visible();
        expect(visible).toHaveLength(1);
        expect(visible[0].level).toBe('error');
        expect(carriesStack(visible[0])).toBe(true);
    });
});

// ── the level follows the wire ───────────────────────────────────────────────

const scriptAction = {
    name: 'start_signing',
    objectName: 'clm_contract',
    type: 'script',
    body: { language: 'js', source: 'return 1;', capabilities: ['api.write'] },
};

/** The `/actions` door harness `nested-hook-refusal-is-a-rejection.test.ts` uses. */
async function actionsDoorStatus(thrown: unknown): Promise<number> {
    const objectDef = { name: 'clm_contract', actions: [scriptAction] };
    const ql: any = {
        executeAction: vi.fn(async () => { throw thrown; }),
        getSchema: (n: string) => (n === objectDef.name ? objectDef : undefined),
        registry: { getObject: (n: string) => (n === objectDef.name ? objectDef : undefined), getItem: () => undefined },
        find: vi.fn(async () => [{ id: 'c_1', status: 'draft' }]),
        insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
    };
    const metadata: any = {
        load: vi.fn(async () => null),
        listObjects: vi.fn(async () => [objectDef]),
        getObject: vi.fn(async () => objectDef),
    };
    const kernel: any = {
        context: { getService: (n: string) => (n === 'objectql' || n === 'data' ? ql : n === 'metadata' ? metadata : null) },
    };
    const res: any = await new HttpDispatcher(kernel).handleActions(
        '/clm_contract/start_signing/c_1',
        'POST',
        {},
        { request: {}, environmentId: 'platform', executionContext: { userId: 'u1', systemPermissions: [] } } as any,
    );
    return res.response.status;
}

const band = (status: number) => (status < 500 ? '4xx' : '5xx');

describe('[#26153] the refusal/fault split is the band the /actions door answers', () => {
    const escapes: Array<[string, () => Promise<any>]> = [
        ['a nested hook refusal (422)', () =>
            rejectionOf(boundAction(recordingLogger().logger, boundHook(recordingLogger().logger, REFUSING_HOOK))({ recordId: 'c_1' }))],
        ['an action refusal with no declared status', () =>
            rejectionOf(boundAction(recordingLogger().logger, async () => {}, `throw new Error(${JSON.stringify(REFUSAL)});`)({ recordId: 'c_1' }))],
        ['a nested hook crash', () =>
            rejectionOf(boundAction(recordingLogger().logger, boundHook(recordingLogger().logger, CRASHING_HOOK))({ recordId: 'c_1' }))],
        ['an action crash', () =>
            rejectionOf(boundAction(recordingLogger().logger, async () => {}, CRASHING_HOOK)({ recordId: 'c_1' }))],
        ['a denied capability (the sandbox\'s own fault)', () =>
            rejectionOf(actionBodyRunnerFactory(runner, { ql: {}, appId: 'clm' })({
                name: 'start_signing', object: 'clm_contract', type: 'script',
                body: { language: 'js', source: "return await ctx.api.object('clm_contract').update({ id: 'c_1' });" },
            })!({ recordId: 'c_1' }))],
    ];

    for (const [label, escape] of escapes) {
        it(label, async () => {
            const err = await escape();
            // Read first: the door rewrites `err.message` to the client sentence.
            const logged = band(mapDataError(err).status);
            expect(logged).toBe(band(await actionsDoorStatus(err)));
        });
    }
});
