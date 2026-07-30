// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #3918 follow-up + #3962 — the LAST hop: what `/actions` puts on the wire.
 *
 * The sandbox now carries `code` / `fields` back out of the VM on a
 * `SandboxError` (see `sandbox/error-passthrough.test.ts`). This pins the other
 * half: the actions route surfacing them, which is what a form actually reads.
 *
 * Before, this envelope was the message string and nothing else, so a form
 * action could raise a toast but never highlight the offending input — the
 * symptom in the original report.
 *
 * **The status is 400 since #3962** — the conscious, documented decision the
 * previous revision of this file asked for. The 200-with-inner-envelope wire
 * was never designed: no ADR or doc specified it, and /actions was the only
 * route of 12 that double-wrapped. `code` and `fields` now ride in
 * `error.details`, the exact shape `@objectstack/client` normalizes to
 * `err.code` / `err.fields` (#3927), identical to a ValidationError on /data.
 */

import { describe, it, expect, vi } from 'vitest';

import { HttpDispatcher } from '../http-dispatcher.js';
import { SandboxError } from '../sandbox/quickjs-runner.js';

const FIELDS = [
    { field: 'issued_on', code: 'required', message: 'issued_on is required' },
];

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

/** What the sandbox now throws for a record validation failure. */
const validationSandboxError = () =>
    new SandboxError(
        "action 'submit_signoff' threw: ValidationError: issued_on is required",
        'ValidationError: issued_on is required',
        { code: 'VALIDATION_FAILED', fields: FIELDS },
    );

describe('#3918 follow-up — /actions surfaces code + fields on a validation failure', () => {
    it('carries `fields[]` so a form can anchor the error to the input', async () => {
        const response = await invoke(validationSandboxError());

        expect(response.status).toBe(400);
        // The semantic code is promoted into `error.code` (#3971); `fields`
        // stay in `details`.
        expect(response.body.error.code).toBe('VALIDATION_FAILED');
        expect(response.body.error.details).toMatchObject({ fields: FIELDS });
    });

    it('keeps the human message as the toast text', async () => {
        const response = await invoke(validationSandboxError());

        expect(response.body.error.message).toBe('ValidationError: issued_on is required');
    });

    it('is an HTTP 400 — failures speak HTTP (#3962)', async () => {
        // The previous revision of this test pinned 200 so that flipping it
        // would be "a conscious, documented break, not a side effect".
        // #3962 is that documented decision.
        const response = await invoke(validationSandboxError());

        expect(response.status).toBe(400);
        expect(response.body.success).toBe(false);
    });

    it('omits `code` / `fields` entirely for an ordinary failure', async () => {
        // Callers branch on presence; emitting empty values would claim a
        // field-anchored failure that never happened.
        const response = await invoke(
            new SandboxError("action 'x' threw: boom", 'boom'),
        );

        expect(response.status).toBe(400);
        expect(response.body.error.message).toBe('boom');
        expect(response.body.error.details).toBeUndefined();
    });

    it('carries a code without fields when that is all the error had', async () => {
        const response = await invoke(
            new SandboxError("action 'x' threw: pick another", 'pick another', { code: 'DUPLICATE' }),
        );

        expect(response.status).toBe(400);
        expect(response.body.error.message).toBe('pick another');
        expect(response.body.error.code).toBe('DUPLICATE');
    });
});
