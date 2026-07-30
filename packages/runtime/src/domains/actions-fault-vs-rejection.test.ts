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
 * rule"). This file pins BOTH sides, because the whole risk of the change is
 * over-reach: everything #3937 put in the payload must stay there.
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

describe('a deliberate REJECTION keeps the payload at HTTP 200', () => {
    it('a plain `throw new Error(msg)` from a registered handler', async () => {
        // The shape user code registered via `engine.registerAction` uses to
        // reject. `name === 'Error'` is what marks it deliberate — this is the
        // case a naive "no sandbox marker ⇒ fault" rule would have broken.
        const response = await invoke(new Error('Lead is already converted'));

        expect(response.status).toBe(200);
        expect(response.body.data).toEqual({ success: false, error: 'Lead is already converted' });
    });

    it('a sandboxed body that threw on purpose (SandboxError.innerMessage)', async () => {
        const response = await invoke(
            new SandboxError("action 'submit_signoff' threw: Contact has no phone", 'Contact has no phone'),
        );

        expect(response.status).toBe(200);
        expect(response.body.data).toEqual({ success: false, error: 'Contact has no phone' });
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

        expect(response.status).toBe(200);
        expect(response.body.data).toMatchObject({ success: false, code: 'VALIDATION_FAILED', fields });
    });

    it('a bare ValidationError whose fields were stripped in transit', async () => {
        // Recognised by NAME via `validationFailureDetails` — the same predicate
        // the dispatcher's error exits use — so losing `fields` downgrades the
        // detail, never the classification.
        const err: any = new Error('issued_on is required');
        err.name = 'ValidationError';
        const response = await invoke(err);

        expect(response.status).toBe(200);
        expect(response.body.data.success).toBe(false);
    });

    it('a flow that ran and rejected', async () => {
        // `dispatchFlowAction` throws a plain Error, so it lands on the
        // deliberate side with no special-casing.
        const response = await invoke(new Error("Flow 'convert_wizard' failed: lead already converted"));

        expect(response.status).toBe(200);
        expect(response.body.data.success).toBe(false);
        expect(response.body.data.error).toMatch(/lead already converted/);
    });

    it('an unrecognisable throw — no name at all — keeps the status quo', async () => {
        // The change only moves what it is SURE about. A thrown string or a
        // bare object is not confidently a fault, so it keeps its 200.
        const response = await invoke('something odd');

        expect(response.status).toBe(200);
        expect(response.body.data.success).toBe(false);
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
