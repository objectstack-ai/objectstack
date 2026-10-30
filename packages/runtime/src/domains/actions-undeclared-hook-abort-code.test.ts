// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27672] The runtime `/actions` door answers a sandboxed body's undeclared
 * abort with `HOOK_ABORTED`, the code `/api/v1/data` has answered since
 * #27597, instead of the `VALIDATION_ERROR` its 400 derives.
 *
 * The door's catch hands a rejection to `errorFromThrown`
 * (`http-dispatcher.ts`), whose code is `resolveThrownHttpError`'s
 * (`@objectstack/types`). The resolver now answers
 * `UNDECLARED_HOOK_REFUSAL_CODE` for a sandboxed refusal that declared no code,
 * so this door reads the one rule rather than a copy of it. §2 is the control:
 * a code the body declared is kept, a registered handler's plain rejection
 * still derives `VALIDATION_ERROR`, and a crash is still the sanitised 500.
 */

import { describe, it, expect, vi } from 'vitest';
import { UNDECLARED_HOOK_REFUSAL_CODE } from '@objectstack/types';

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

describe('[#27672] §1 an undeclared abort answers HOOK_ABORTED at /actions', () => {
    it('the action body\'s own free-text throw', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const response = await invoke(
            new SandboxError("action 'submit_signoff' threw: Contact has no phone", 'Contact has no phone'),
        );
        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('HOOK_ABORTED');
        expect(response.body.error.code).toBe(UNDECLARED_HOOK_REFUSAL_CODE);
        expect(response.body.error.message).toBe('Contact has no phone');
        expect(response.body.error).not.toHaveProperty('declaredCode');
    });

    it('a hook abort relayed through the action body (the nested refusal\'s shape)', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const response = await invoke(new SandboxError(
            "action 'submit_signoff' threw: hook 'guard' threw: Error: A finished invoice cannot be signed.",
            'A finished invoice cannot be signed.',
        ));
        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('HOOK_ABORTED');
        expect(response.body.error.message).toBe('A finished invoice cannot be signed.');
    });

    it('a 4xx status the body declared without a code keeps the status', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const response = await invoke(new SandboxError("action 'submit_signoff' threw: Closed.", 'Closed.', { status: 422 }));
        expect(response.status).toBe(422);
        expect(response.body.error.code).toBe('HOOK_ABORTED');
    });
});

describe('[#27672] §2 CONTROLS — a declared code is kept; nothing is invented elsewhere', () => {
    it('a registered code the body declared is its own code', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const response = await invoke(new SandboxError(
            "action 'submit_signoff' threw: Locked.", 'Locked.', { code: 'RECORD_LOCKED', status: 409 },
        ));
        expect(response.status).toBe(409);
        expect(response.body.error.code).toBe('RECORD_LOCKED');
    });

    it('an unregistered code the body declared rides declaredCode beside the derived code', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const response = await invoke(new SandboxError(
            "action 'submit_signoff' threw: Over the limit.", 'Over the limit.', { code: 'CREDIT_LIMIT', status: 400 },
        ));
        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('VALIDATION_ERROR');
        expect(response.body.error.declaredCode).toBe('CREDIT_LIMIT');
    });

    it('a registered handler\'s plain rejection (no sandbox) still derives VALIDATION_ERROR', async () => {
        const response = await invoke(new Error('Lead is already converted'));
        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('a body that CRASHED is still the sanitised 500', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const response = await invoke(new SandboxError(
            "action 'submit_signoff' threw: TypeError: x is not a function", 'TypeError: x is not a function',
        ));
        expect(response.status).toBe(500);
        expect(response.body.error.code).toBe('INTERNAL_ERROR');
    });
});
