// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#17265] A sandboxed hook's BUSINESS REFUSAL reached through a script
 * action's `ctx.api` write is a rejection, not the sandbox faulting.
 *
 * ## What was measured broken
 *
 * The card reports `POST /api/v1/actions/clm_contract/submit_contract`
 * answering `500 INTERNAL_ERROR` for a `beforeUpdate` hook that refused a state
 * transition with a written, user-facing sentence — the same refusal `/data`
 * has answered `400` with the sentence verbatim since #11588.
 *
 * `domains/actions.ts`'s classifier is NOT the producer: it reads the shape it
 * is handed correctly (`actions-fault-vs-rejection.test.ts` pins both sides of
 * that line and neither moves). The refusal arrives at it already stripped of
 * every mark that says "a body reported this on purpose", one VM hop earlier:
 *
 *  1. the sandboxed `beforeUpdate` hook refuses — its own runner wraps that as
 *     `SandboxError("hook 'g' threw: <biz>", "<biz>")`, `innerMessage` SET;
 *  2. it travels out of `engine.update()` into the ACTION body's host call, so
 *     `hostErrorToVm` marshals it INTO the action's VM — and marked every
 *     `SandboxError` reaching it as {@link SANDBOX_FAULT_PROP}, the sandbox's
 *     OWN fault (#4431), on an `instanceof` test;
 *  3. escaping the action body uncaught, the pump loop reads that marker and
 *     throws a bare `SandboxError` — no `innerMessage`, no `code`, no
 *     `status`, no `fields`;
 *  4. which is, by the #3951 contract, exactly a CRASH ⇒ `errorFromThrown(err,
 *     500)` ⇒ `500 INTERNAL_ERROR`.
 *
 * The marker's own sibling pin already named this risk — "a marker applied too
 * broadly would turn every failed write into a 500"
 * (`capability-denial-is-a-fault.test.ts`) — and measured it with a plain
 * `ValidationError`, which is not a `SandboxError` and so never tripped the
 * `instanceof`. A NESTED sandboxed refusal is.
 *
 * ## The line this file pins
 *
 * The discriminator is the one `/data` asks (`sandboxBusinessMessage`, #11588):
 * does the error carry a caller-addressed business sentence that is not a
 * script fault? A refusal does and stays a rejection; a capability denial and a
 * nested CRASH do not and stay faults. So `/data`'s answer and the action
 * route's answer are the same answer, per route and per status.
 */

import { describe, it, expect, vi } from 'vitest';

import { HttpDispatcher } from '../http-dispatcher.js';
import { QuickJSScriptRunner, SandboxError } from './quickjs-runner.js';
import type { ScriptContext, ScriptRunOptions } from './script-runner.js';

/** The sentence the consuming app's guard addressed to its end user. */
const REFUSAL = 'A contract cannot be submitted without a version file';

const runner = new QuickJSScriptRunner({ hookTimeoutMs: 10_000, actionTimeoutMs: 10_000 });
const actionOpts: ScriptRunOptions = { origin: { kind: 'action', name: 'submit_contract' } };

/**
 * The shape a SANDBOXED `beforeUpdate` hook's deliberate refusal really has
 * when `engine.update()` hands it back to the action body's host call — built
 * by `quickjs-runner`'s own pump loop one level down, so `innerMessage` is set.
 */
function nestedHookRefusal(): SandboxError {
    return new SandboxError(`hook 'guard_contract_submit' threw: ${REFUSAL}`, REFUSAL);
}

/** A `ctx.api.object(x).update(...)` host seam whose write the hook refuses. */
function refusingApi(thrown: () => unknown) {
    return {
        object: (_n: string) => ({
            update: async () => { throw thrown(); },
        }),
    };
}

function ctx(over: Partial<ScriptContext> = {}): ScriptContext {
    return { input: {}, ...over };
}

/** Run a script action whose `ctx.api` write throws `thrown`, and return the escape. */
async function escapeOf(thrown: () => unknown): Promise<any> {
    const err = await runner.runScript(
        {
            language: 'js',
            source: "return await ctx.api.object('clm_contract').update('c_1', { status: 'submitted' });",
            capabilities: ['api.write'],
        },
        ctx({ api: refusingApi(thrown) }),
        actionOpts,
    ).then(() => null, (e) => e);
    expect(err, 'expected the action to reject, but the script resolved').toBeInstanceOf(SandboxError);
    return err;
}

// ── the wire half ────────────────────────────────────────────────────────────

const scriptAction = {
    name: 'submit_contract',
    objectName: 'clm_contract',
    type: 'script',
    body: { language: 'js', source: 'return 1;', capabilities: ['api.write'] },
};

/** The same dispatcher harness `actions-fault-vs-rejection.test.ts` uses. */
function makeDispatcher(thrown: unknown) {
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
        context: {
            getService: (n: string) =>
                n === 'objectql' || n === 'data' ? ql : n === 'metadata' ? metadata : null,
        },
    };
    return new HttpDispatcher(kernel);
}

async function wireAnswer(thrown: unknown) {
    const res: any = await makeDispatcher(thrown).handleActions(
        '/clm_contract/submit_contract/c_1',
        'POST',
        {},
        { request: {}, environmentId: 'platform', executionContext: { userId: 'u1', systemPermissions: [] } } as any,
    );
    return res.response;
}

describe('[#17265] a nested sandboxed hook refusal keeps its business message', () => {
    it("a beforeUpdate refusal reached through ctx.api.update is NOT the sandbox's own fault", async () => {
        const err = await escapeOf(nestedHookRefusal);

        // THE defect: the marker was applied on `instanceof SandboxError`, so
        // the nested refusal came back as a bare fault — no business message at
        // all, which is exactly what the #3951 contract reads as a CRASH.
        expect(err.innerMessage, 'the hook refusal must survive as a business message').toBeDefined();
        expect(err.innerMessage).toContain(REFUSAL);
        // …and the action's own debug wrapper still identifies who threw, in
        // the log-only `.message`, which keeps the WHOLE chain.
        expect(err.message).toContain("action 'submit_contract' threw:");
        expect(err.message).toContain("hook 'guard_contract_submit' threw:");

        // Message-NEUTRAL: this repair moves the status, not the sentence. The
        // client-facing text is byte-identical to what the 500 already carried
        // — the VM's `SandboxError: ` name prefix is a debug artefact and has
        // never reached the wire.
        expect(err.innerMessage).toBe(`hook 'guard_contract_submit' threw: ${REFUSAL}`);
        expect(err.innerMessage).not.toContain('SandboxError:');
    });

    it('the wire answer matches /data: 400 VALIDATION_ERROR with the sentence', async () => {
        // /data answers this refusal `400` with `error.innerMessage` verbatim
        // (`error-response.ts`'s sandbox unwrap door, `declared ?? 400`). The
        // action route must not answer a second thing for one refusal.
        const response = await wireAnswer(await escapeOf(nestedHookRefusal));

        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('VALIDATION_ERROR');
        expect(response.body.error.message).toContain(REFUSAL);
    });

    it("a nested refusal's DECLARED status and code survive the hop", async () => {
        // The fault branch dropped the whole `__errorInfo` payload, not just
        // `innerMessage`, so a hook declaring `{ status: 409, code:
        // 'RECORD_LOCKED' }` lost both and was flattened to 500. `/data`
        // answers `declared ?? 400` for this producer (#9967); the action door
        // honours a declared status at its own first arm (#7867), so once the
        // classification is right the two agree without a second rule.
        const locked = () => {
            const e: any = new SandboxError(
                `hook 'guard_contract_submit' threw: ${REFUSAL}`,
                REFUSAL,
                { code: 'RECORD_LOCKED', status: 409 },
            );
            return e;
        };
        const response = await wireAnswer(await escapeOf(locked));

        expect(response.status).toBe(409);
        expect(response.body.error.code).toBe('RECORD_LOCKED');
        expect(response.body.error.message).toContain(REFUSAL);
    });
});

describe('[#17265] the FAULT side of the #4431 contract is untouched', () => {
    it("a nested CRASH is still a fault — sandboxBusinessMessage declines it", async () => {
        // A hook that blew up arrives in the same shape with a native error
        // name inside `innerMessage`. `/data` answers the sanitised 500 for it
        // (#7543), so the action route must too: the business-message read is
        // what separates them, never the error's class.
        const crash = () =>
            new SandboxError(
                "hook 'guard_contract_submit' threw: TypeError: cannot read properties of undefined",
                'TypeError: cannot read properties of undefined',
            );
        const response = await wireAnswer(await escapeOf(crash));

        expect(response.status).toBe(500);
        expect(response.body.error.code).toBe('INTERNAL_ERROR');
    });

    it('a capability denial inside the action body is still a fault', async () => {
        // The #4431 case itself: the sandbox refused before user code ran, so
        // there is no business message to carry and the 500 must stand.
        const err = await runner.runScript(
            {
                language: 'js',
                source: "return ctx.api.object('clm_contract').count({});",
                capabilities: [],
            },
            ctx({ api: { object: (_n: string) => ({ count: (_f: unknown) => 1 }) } }),
            actionOpts,
        ).then(() => null, (e: any) => e);

        expect(err).toBeInstanceOf(SandboxError);
        expect(err.innerMessage).toBeUndefined();
        expect((await wireAnswer(err)).status).toBe(500);
    });
});
