// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#17273] A REAL crashing action body, driven from the VM to the wire.
 *
 * `domains/actions-fault-vs-rejection.test.ts` pins the HTTP half of the
 * crash-vs-rejection contract against a synthesised `SandboxError`. This file
 * is the other half, the split `capability-denial-is-a-refusal.test.ts` drew
 * for #4431 (a capability denial is a coded refusal since #26965): it runs a
 * body that genuinely crashes inside QuickJS and proves the error ARRIVES in the shape the classifier is pinned against —
 * then hands that same object, untouched, to the real door.
 *
 * The card this closes was filed on a READING of the source, and read-derived
 * behaviour is not measured behaviour. What the reading predicted, and what
 * this file establishes as fact:
 *
 *  - the runner sets `.innerMessage` to the NATIVE error text for a crash,
 *    which is the very field the `/actions` door read as "the body threw this
 *    deliberately";
 *  - so the door answered `400` with `TypeError: …` as the client-facing
 *    message — the published catalog says `500` for exactly this case.
 *
 * ⛔ The crash is produced by running the body, never by constructing a
 * `SandboxError` by hand: the whole point of the card's warning is that a hand
 * shape can agree with a source reading while the runner does something else.
 */

import { describe, it, expect, vi } from 'vitest';
import { QuickJSScriptRunner, SandboxError } from './quickjs-runner.js';
import type { ScriptRunOptions } from './script-runner.js';
import { HttpDispatcher } from '../http-dispatcher.js';
import { actionsDoorAnswerOf, INTERNAL_ERROR_MESSAGE, mapDataError } from '@objectstack/types';
// Paid during collection, never inside a case's clocked window: the door's
// reach loads this package lazily (`check:test-source-alias`).
import '@objectstack/metadata';

const runner = new QuickJSScriptRunner({ hookTimeoutMs: 10_000, actionTimeoutMs: 10_000 });
const actionOpts: ScriptRunOptions = { origin: { kind: 'action', name: 'submit_signoff' } };

/** The crash from the `isScriptFaultMessage` docblock, run for real. */
async function realCrash(): Promise<SandboxError> {
    const e = await runner
        .runScript(
            { language: 'js', source: 'return ctx.input.title.trim();', capabilities: [] },
            { input: { title: 12345 } },
            actionOpts,
        )
        .then(() => null, (err) => err as SandboxError);
    expect(e, 'expected the body to crash, but the script resolved').toBeInstanceOf(SandboxError);
    return e!;
}

const scriptAction = {
    name: 'submit_signoff',
    objectName: 'crm_invoice',
    type: 'script',
    body: { language: 'js', source: 'return ctx.input.title.trim();', capabilities: [] },
};

/** The real `/actions` door, answering whatever the action dispatch threw. */
async function throughActionsDoor(thrown: unknown) {
    const objectDef = { name: 'crm_invoice', actions: [scriptAction] };
    const ql: any = {
        executeAction: vi.fn(async () => { throw thrown; }),
        getSchema: (n: string) => (n === objectDef.name ? objectDef : undefined),
        registry: { getObject: (n: string) => (n === objectDef.name ? objectDef : undefined), getItem: () => undefined },
        find: vi.fn(async () => [{ id: 'inv_1', status: 'draft' }]),
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
    const res: any = await new HttpDispatcher(kernel).handleActions(
        '/crm_invoice/submit_signoff/inv_1',
        'POST',
        {},
        { request: {}, environmentId: 'platform', executionContext: { userId: 'u1', systemPermissions: [] } } as any,
    );
    return res.response;
}

describe('[#17273] a body that crashes in QuickJS reaches the door as a crash', () => {
    it('the runner marks a crash with the NATIVE error text in `innerMessage`', async () => {
        const err = await realCrash();

        // The wrapper, for the server log.
        expect(err.message).toContain("action 'submit_signoff' threw:");
        expect(err.message).toContain('TypeError');
        // …and the mark that the `/actions` door read as "deliberate". This is
        // the measurement the card asked for: the field is SET, and what it
        // holds is a native error name, not a business sentence.
        expect(typeof err.innerMessage).toBe('string');
        expect(err.innerMessage!.startsWith('TypeError')).toBe(true);
        // No status and no code crossed out of the VM for this crash, so the
        // 400 terminal at the bottom of the catch is where it landed.
        expect(err.status).toBeUndefined();
        expect(err.code).toBeUndefined();
    });
});

describe('[#17273] and the door answers it as one', () => {
    it('the real crash gets the sanitised 500, not a 400 carrying its own TypeError text', async () => {
        const err = await realCrash();
        const response = await throughActionsDoor(err);

        // Before this card, byte for byte: status 400, and
        // `error.message === err.innerMessage` — the native text on the wire.
        expect(response.status).toBe(500);
        expect(response.body.error.code).toBe('INTERNAL_ERROR');
        expect(response.body.error.message).toBe('Internal server error');
        expect(response.body.error.message).not.toBe(err.innerMessage);
        expect(String(response.body.error.message)).not.toContain('TypeError');
    });

    it('negative control: a body that REJECTS on purpose still answers 400 with its own sentence', async () => {
        // The same runner, the same door, one `throw` apart — the deliberate
        // throw is untouched by the crash terminal.
        const refusal = await runner
            .runScript(
                { language: 'js', source: "throw new Error('Contact has no phone');", capabilities: [] },
                { input: {} },
                actionOpts,
            )
            .then(() => null, (e) => e as SandboxError);
        expect(refusal).toBeInstanceOf(SandboxError);
        expect(refusal!.innerMessage).toBe('Contact has no phone');

        const response = await throughActionsDoor(refusal);
        expect(response.status).toBe(400);
        expect(response.body.error.message).toBe('Contact has no phone');
    });
});

describe('an action body that does not compile answers naming the action and the compile error', () => {
    /** The body from the scenario run the fix answers, byte for byte. */
    const CARD_BODY = 'const input = ctx.input || {}; return 1;';

    async function compileFailure(source: string): Promise<SandboxError> {
        const e = await runner
            .runScript({ language: 'js', source, capabilities: [] }, { input: {} }, actionOpts)
            .then(() => null, (err) => err as SandboxError);
        expect(e, 'expected the body to fail, but the script resolved').toBeInstanceOf(SandboxError);
        return e!;
    }

    it('the runner names the action and the compiler, declares 500, and is no crash', async () => {
        const err = await compileFailure(CARD_BODY);
        expect(err.message).toBe("action 'submit_signoff' does not compile: SyntaxError: invalid redefinition of parameter name");
        expect(err.status).toBe(500);
        expect(err.code).toBeUndefined();
        expect(err.innerMessage).toContain("Action 'submit_signoff' cannot run: its body does not compile");
        expect(err.innerMessage).toContain('SyntaxError: invalid redefinition of parameter name');
    });

    it('the /actions door answers 500 INTERNAL_ERROR with that sentence, never the bare "Internal server error"', async () => {
        const err = await compileFailure(CARD_BODY);
        const response = await throughActionsDoor(err);
        expect(response.status).toBe(500);
        expect(response.body.error.code).toBe('INTERNAL_ERROR');
        expect(response.body.error.message).not.toBe('Internal server error');
        expect(response.body.error.message).toContain("Action 'submit_signoff' cannot run");
        expect(response.body.error.message).toContain('invalid redefinition of parameter name');
    });

    it('control: a body that throws a SyntaxError while RUNNING is still a crash, answered with the sanitised 500', async () => {
        const err = await compileFailure("JSON.parse('{'); return 1;");
        expect(err.message).toContain("action 'submit_signoff' threw:");
        const response = await throughActionsDoor(err);
        expect(response.status).toBe(500);
        expect(response.body.error.message).toBe('Internal server error');
    });
});

/**
 * An action body that runs out of time answers a sentence naming the action and
 * the limit it hit, at the same `500 INTERNAL_ERROR` as before; a crash keeps
 * the sanitised sentence; a hook's or a job's timeout is unchanged.
 *
 * Both doors are measured on a REAL timeout, produced by running the body: the
 * `/actions` HTTP door through the real dispatcher, and the MCP `run_action`
 * tool through the one reader it renders a throw with (`actionsDoorAnswerOf`,
 * whose envelope `@objectstack/mcp`'s `mcp-coded-refusal.test.ts` pins on the
 * tool itself). The `/data` door is measured through its classifier
 * (`mapDataError`).
 */
describe('an action body that times out answers naming the action and its limit', () => {
    const CPU_SENTENCE = "Action 'submit_signoff' timed out: it exceeded its 50 ms time limit and was stopped.";
    const WALL_SENTENCE =
        "Action 'submit_signoff' timed out: it exceeded its 300 ms time limit while waiting on platform calls, and was stopped.";

    /** A body that burns its 50 ms CPU budget. */
    async function cpuTimeout(opts: ScriptRunOptions = actionOpts): Promise<SandboxError> {
        const e = await runner
            .runScript({ language: 'js', source: 'while (true) {}', capabilities: [], timeoutMs: 50 }, { input: {} }, opts)
            .then(() => null, (err) => err as SandboxError);
        expect(e, 'expected the body to time out, but the script resolved').toBeInstanceOf(SandboxError);
        return e!;
    }

    /** A body stuck on a promise that never settles, cut at a 300 ms wall ceiling. */
    async function wallTimeout(): Promise<SandboxError> {
        const e = await new QuickJSScriptRunner({ actionTimeoutMs: 250, wallCeilingMs: 300 })
            .runScript({ language: 'js', source: 'await new Promise(() => {});', capabilities: [] }, { input: {} }, actionOpts)
            .then(() => null, (err) => err as SandboxError);
        expect(e, 'expected the body to time out, but the script resolved').toBeInstanceOf(SandboxError);
        return e!;
    }

    it('the runner keeps its operator line, and declares 500 with the sentence and no code', async () => {
        const cpu = await cpuTimeout();
        expect(cpu.message).toMatch(/^action 'submit_signoff' exceeded CPU budget of 50ms \(after \d+ pump iterations\)$/);
        expect(cpu.innerMessage).toBe(CPU_SENTENCE);
        expect(cpu.status).toBe(500);
        expect(cpu.code).toBeUndefined();

        const wall = await wallTimeout();
        expect(wall.message).toMatch(/^action 'submit_signoff' exceeded wall-clock ceiling of 300ms while awaiting host calls/);
        expect(wall.innerMessage).toBe(WALL_SENTENCE);
        expect(wall.status).toBe(500);
        expect(wall.code).toBeUndefined();
    });

    it('the /actions door and the MCP run_action reader answer 500 INTERNAL_ERROR with the same sentence', async () => {
        for (const [produce, sentence] of [[cpuTimeout, CPU_SENTENCE], [wallTimeout, WALL_SENTENCE]] as const) {
            const response = await throughActionsDoor(await produce());
            expect(response.status).toBe(500);
            expect(response.body.error.code).toBe('INTERNAL_ERROR');
            expect(response.body.error.message).toBe(sentence);

            const mcp = actionsDoorAnswerOf(await produce(), 'crm_invoice');
            expect({ status: mcp.status, code: mcp.code, message: mcp.message }).toEqual({
                status: response.status,
                code: response.body.error.code,
                message: response.body.error.message,
            });
        }
    });

    it('control: a crash beside it keeps the sanitised 500 on both doors, naming nothing', async () => {
        const response = await throughActionsDoor(await realCrash());
        const mcp = actionsDoorAnswerOf(await realCrash(), 'crm_invoice');
        for (const answer of [
            { status: response.status, code: response.body.error.code, message: response.body.error.message },
            { status: mcp.status, code: mcp.code, message: mcp.message },
        ]) {
            expect(answer).toEqual({ status: 500, code: 'INTERNAL_ERROR', message: INTERNAL_ERROR_MESSAGE });
        }
    });

    it('the /data door does not read the action sentence as business text', async () => {
        const door = mapDataError(await cpuTimeout(), 'crm_invoice');
        expect(door.status).toBe(500);
        expect(JSON.stringify(door.body)).not.toContain('submit_signoff');
        expect(door.body.error).toBe(INTERNAL_ERROR_MESSAGE);
    });

    it('control: a hook timeout is unchanged, and the /data door answers it the sanitised fault', async () => {
        const hook = await cpuTimeout({ origin: { kind: 'hook', name: 'guard_invoice' } });
        expect(hook.message).toMatch(/^hook 'guard_invoice' exceeded CPU budget of 50ms/);
        expect(hook.innerMessage).toBeUndefined();
        expect(hook.status).toBeUndefined();
        const door = mapDataError(hook, 'crm_invoice');
        expect(door.status).toBe(500);
        expect(door.body).toEqual({ error: INTERNAL_ERROR_MESSAGE, code: 'INTERNAL_ERROR' });

        const job = await cpuTimeout({ origin: { kind: 'job', name: 'nightly_invoice' } });
        expect(job.message).toMatch(/^job 'nightly_invoice' exceeded CPU budget of 50ms/);
        expect(job.innerMessage).toBeUndefined();
        expect(job.status).toBeUndefined();
    });
});
