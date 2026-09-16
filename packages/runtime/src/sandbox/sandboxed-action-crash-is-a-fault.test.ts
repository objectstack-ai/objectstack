// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#17273] A REAL crashing action body, driven from the VM to the wire.
 *
 * `domains/actions-fault-vs-rejection.test.ts` pins the HTTP half of the
 * crash-vs-rejection contract against a synthesised `SandboxError`. This file
 * is the other half, the split `capability-denial-is-a-fault.test.ts` already
 * draws for #4431: it runs a body that genuinely crashes inside QuickJS and
 * proves the error ARRIVES in the shape the classifier is pinned against —
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
