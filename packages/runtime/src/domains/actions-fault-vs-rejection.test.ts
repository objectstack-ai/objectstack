// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #3913 follow-up — an action that CRASHED is not an action that REJECTED.
 *
 * #3937 settled that a failed action reports in the payload at HTTP 200: "an
 * action that fails is a normal outcome, not a transport error". That is a
 * statement about the action **rejecting** — a business rule saying no. It was
 * also covering a third case it never argued for: a `TypeError` in a handler,
 * a driver blowing up, a sandbox timeout. Those are not outcomes the action
 * chose to report; they are the server failing to produce one, and serving
 * them as 200 hid every handler crash from gateway error rates, retry policy,
 * APM auto-capture and alerting — the platform had no signal for "customer
 * action bodies are throwing" short of body-parsing at every hop.
 *
 * The discriminator is the error's NAME, the same signal `@objectstack/rest`
 * already uses on this distinction ("non-default names (`TypeError: …`) […]
 * signal a genuine script bug rather than a deliberately thrown business
 * rule"). Since #3962 both sides are HTTP statuses — a rejection is a 400
 * carrying `code`/`fields` in `details`, a crash is a 500 — and this file pins
 * the LINE between them, because the risk is misclassification in either
 * direction: a business rejection served as a 500 gets its message eaten by
 * the leak sanitiser; a crash served as a 400 hides from alerting.
 */

import { describe, it, expect, vi } from 'vitest';

import { HttpDispatcher } from '../http-dispatcher.js';
import { SandboxError } from '../sandbox/quickjs-runner.js';

const scriptAction = {
    name: 'submit_signoff',
    objectName: 'crm_invoice',
    type: 'script',
    body: { language: 'js', source: 'return 1;', capabilities: ['api.write'] },
};

/** A dispatcher whose action handler rejects with `thrown`. */
function makeDispatcher(thrown: unknown) {
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
    return new HttpDispatcher(kernel);
}

async function invoke(thrown: unknown) {
    const res: any = await makeDispatcher(thrown).handleActions(
        '/crm_invoice/submit_signoff/inv_1',
        'POST',
        {},
        { request: {}, environmentId: 'platform', executionContext: { userId: 'u1', systemPermissions: [] } } as any,
    );
    return res.response;
}

describe('a deliberate REJECTION is a 400 (#3962)', () => {
    it('a plain `throw new Error(msg)` from a registered handler', async () => {
        // The shape user code registered via `engine.registerAction` uses to
        // reject. `name === 'Error'` is what marks it deliberate — this is the
        // case a naive "no sandbox marker ⇒ fault" rule would have broken.
        const response = await invoke(new Error('Lead is already converted'));

        expect(response.status).toBe(400);
        expect(response.body.error.message).toBe('Lead is already converted');
    });

    it('a sandboxed body that threw on purpose (SandboxError.innerMessage)', async () => {
        const response = await invoke(
            new SandboxError("action 'submit_signoff' threw: Contact has no phone", 'Contact has no phone'),
        );

        expect(response.status).toBe(400);
        // The sandbox debug wrapper stays in the server log, not on the wire.
        expect(response.body.error.message).toBe('Contact has no phone');
    });

    it('a record validation failure, code + fields intact (#3937)', async () => {
        const fields = [{ field: 'issued_on', code: 'required', message: 'issued_on is required' }];
        const response = await invoke(
            new SandboxError(
                "action 'submit_signoff' threw: ValidationError: issued_on is required",
                'ValidationError: issued_on is required',
                { code: 'VALIDATION_FAILED', fields },
            ),
        );

        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('VALIDATION_FAILED'); // promoted out of details (#3971)
        expect(response.body.error.details).toMatchObject({ fields });
    });

    it('a bare ValidationError whose fields were stripped in transit', async () => {
        // Recognised by NAME via `validationFailureDetails` — the same predicate
        // the dispatcher's error exits use — so losing `fields` downgrades the
        // detail, never the classification.
        const err: any = new Error('issued_on is required');
        err.name = 'ValidationError';
        const response = await invoke(err);

        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('a flow that ran and rejected', async () => {
        // `dispatchFlowAction` throws a plain Error, so it lands on the
        // deliberate side with no special-casing.
        const response = await invoke(new Error("Flow 'convert_wizard' failed: lead already converted"));

        expect(response.status).toBe(400);
        expect(response.body.error.message).toMatch(/lead already converted/);
    });

    it('an unrecognisable throw — no name at all — reads as a rejection, not a crash', async () => {
        // A thrown string or a bare object is not confidently a server fault,
        // so it takes the rejection exit (400), not the 500.
        const response = await invoke('something odd');

        expect(response.status).toBe(400);
        expect(response.body.success).toBe(false);
    });
});

describe('an unexpected FAULT is a 500', () => {
    it('a TypeError from a buggy handler', async () => {
        const response = await invoke(new TypeError("Cannot read properties of undefined (reading 'id')"));

        expect(response.status).toBe(500);
        expect(response.body.success).toBe(false);
        // No `{success:true, data:{...}}` wrapper — this is the dispatcher's
        // error exit, so monitoring sees a 5xx.
        expect(response.body.data).toBeUndefined();
    });

    it('a ReferenceError from a buggy handler', async () => {
        const response = await invoke(new ReferenceError('x is not defined'));

        expect(response.status).toBe(500);
    });

    it("a driver's own error class", async () => {
        const err: any = new Error('no such table: crm_invoice');
        err.name = 'SqliteError';
        const response = await invoke(err);

        expect(response.status).toBe(500);
    });

    it('a driver dump the leak heuristic recognises is sanitised', async () => {
        // Reaching the 5xx exit also puts these messages behind
        // `looksLikeInternalErrorLeak` (#3867) — which the 200 payload never
        // consulted, so a driver dump used to reach the client verbatim.
        const err: any = new Error('UNIQUE constraint failed: crm_invoice.number');
        err.name = 'SqliteError';
        const response = await invoke(err);

        expect(response.status).toBe(500);
        expect(response.body.error.message).toBe('Internal server error');
    });

    it("the sandbox's OWN internal errors — a timeout, a capability denial", async () => {
        // A `SandboxError` with no `innerMessage` is the sandbox failing, not
        // user code rejecting: a timeout, a denied capability, a marshalling
        // failure. Precisely the class an operator wants to alert on, and
        // precisely what a 200 made invisible.
        const response = await invoke(new SandboxError('action timed out after 5000ms'));

        expect(response.status).toBe(500);
    });

    it('still honours an error that carries its own status', async () => {
        // `errorFromThrown` reads `.status` first, so a hand-thrown 4xx is not
        // flattened into the 500 fallback.
        const err: any = new TypeError('Not allowed');
        err.status = 403;
        err.code = 'FORBIDDEN';
        const response = await invoke(err);

        expect(response.status).toBe(403);
    });

    it('honours an explicit status even on an otherwise-deliberate error', async () => {
        // A plugin's `FORBIDDEN` is a plain Error carrying `status: 403` — the
        // "deliberate" side by name, but burying an explicit 403 in a 200
        // payload would discard the one thing the thrower was unambiguous
        // about, so `.status` is checked first.
        const err: any = new Error('Record is outside your sharing scope');
        err.status = 403;
        err.code = 'FORBIDDEN';
        const response = await invoke(err);

        expect(response.status).toBe(403);
        expect(response.body.error.message).toBe('Record is outside your sharing scope');
        // [#3842] The thrower's own code reaches the declared field now.
        expect(response.body.error.code).toBe('FORBIDDEN');
    });
});

/**
 * [#17273] A sandboxed body that CRASHED is a fault — the face of #15071 this
 * door left open.
 *
 * #15071 ruled on the `/data` door: *"A declared code is the author's statement
 * about the failure mode they **handled**. A crash (`isScriptFaultMessage`,
 * #7543) is not that mode, so it is classified as a fault"*. This door read the
 * question the other way round. The table above states the discriminator as the
 * error's NAME, but the `unexpectedFault` predicate that implements it also
 * requires `!innerMessage`, because `innerMessage` is "the sandbox's mark for
 * user code threw this deliberately" — and for a CRASH the runner sets that
 * same mark, to the native error text.
 *
 * So one shape fell between the two halves of this file: a `SandboxError` whose
 * `innerMessage` is `TypeError: …` is neither a deliberate throw (the section
 * above) nor an unexpected fault (the section below). It took the 400 terminal
 * at the bottom of the catch, carrying `TypeError: …` as the client-facing
 * message because `err.message` had already been rewritten to the inner text.
 *
 * Two things that answer made false at once, both published:
 *
 *  - `content/docs/api/error-catalog.mdx`, Action Errors: *"a `TypeError` / a
 *    `ReferenceError` / a driver's own error class is a crash (500)"*;
 *  - this module's own header: *"did it reject or crash? reject → 400; crash →
 *    500"*.
 *
 * The four cases below are the line, in the shape this file already pins it:
 * the crash, the crash that also declared a status (the branch that reads a
 * declaration as intent sits above the predicate, so it had to move too), and
 * the two negative controls one property away on either side.
 */
describe('[#17273] a sandboxed body that CRASHED is a fault, not a rejection', () => {
    it('a sandboxed TypeError answers the sanitised 500, not a 400 carrying the native text', async () => {
        // The exact shape `sandbox/quickjs-runner.ts` produces for
        // `ctx.input.title.trim()` where `title` is a number: the wrapper in
        // `.message` for the log, the native error text in `.innerMessage`.
        const response = await invoke(
            new SandboxError(
                "action 'submit_signoff' threw: TypeError: ctx.input.title.trim is not a function",
                'TypeError: ctx.input.title.trim is not a function',
            ),
        );

        // This assertion IS the flip: it read `400` before.
        expect(response.status).toBe(500);
        expect(response.body.error.code).toBe('INTERNAL_ERROR');
        // …and the native-error text is off the wire. It read
        // `'TypeError: ctx.input.title.trim is not a function'` before —
        // `looksLikeInternalErrorLeak` does not recognise stack-shaped prose,
        // so the 5xx heuristic would not have caught it either.
        expect(response.body.error.message).toBe('Internal server error');
        expect(String(response.body.error.message)).not.toContain('TypeError');
        expect(response.body.success).toBe(false);
    });

    it('a sandboxed crash that ALSO declared a 4xx status is still a fault', async () => {
        // `SandboxError.status` is the #7867 side-channel: whatever error
        // crossed out of the VM named this for itself. A declaration is a
        // statement about a handled failure mode, and a crash is not one — so
        // the crash terminal is asked ABOVE the branch that serves `.status`.
        const err = new SandboxError(
            "action 'submit_signoff' threw: TypeError: x is not a function",
            'TypeError: x is not a function',
            { status: 409, code: 'DELETE_RESTRICTED' },
        );
        const response = await invoke(err);

        expect(response.status).toBe(500);
        expect(response.body.error.code).toBe('INTERNAL_ERROR');
        expect(response.body.error.message).toBe('Internal server error');
    });

    it('negative control: a sandboxed DELIBERATE throw keeps its 400 and its own sentence', async () => {
        // One `innerMessage` away from the first case. #15071's ruling fences
        // this explicitly — *"Ordinary declared refusals … are **untouched** —
        // only the crash branch moves"* — and an implementation that degraded
        // every sandbox-origin error to the fault terminal would turn the two
        // cases above green while deleting this whole surface.
        const response = await invoke(
            new SandboxError("action 'submit_signoff' threw: Contact has no phone", 'Contact has no phone'),
        );

        expect(response.status).toBe(400);
        expect(response.body.error.message).toBe('Contact has no phone');
    });

    it('negative control: a refusal whose text merely MENTIONS a native error name is not a crash', async () => {
        // The name list is anchored (`isNativeErrorName`, `@objectstack/types`)
        // — the ONE reader `@objectstack/rest` composes into
        // `isScriptFaultMessage`, so this door and the `/data` door cannot
        // disagree about what a crash is. A business sentence that happens to
        // name one is still a refusal.
        const response = await invoke(
            new SandboxError(
                "action 'submit_signoff' threw: Import failed with a TypeError in row 4",
                'Import failed with a TypeError in row 4',
            ),
        );

        expect(response.status).toBe(400);
        expect(response.body.error.message).toBe('Import failed with a TypeError in row 4');
    });
});
