// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#27672] `resolveThrownHttpError` answers `UNDECLARED_HOOK_REFUSAL_CODE`
// (`HOOK_ABORTED`) for a sandboxed body's refusal that declared no code, so the
// doors that read the resolver's `code` — package publish, the runtime
// dispatcher's exits — answer the code the `/data` door has answered since
// #27597, instead of the `VALIDATION_ERROR` a 400 derives.
//
// §1 is the card. §2 is the control: a code the body declared is kept, and
// nothing changes for a producer that is not a sandboxed refusal, for a crash,
// or for a 5xx.

import { describe, it, expect } from 'vitest';
import { resolveThrownHttpError, demotedDeclaredCode, UNDECLARED_HOOK_REFUSAL_CODE } from './thrown-http-error.js';
import { sandboxBusinessMessage } from './data-error-classification.js';

/** The shape `runtime/src/sandbox/quickjs-runner.ts` throws for a body's own `throw`. */
function sandboxRefusal(businessMessage: string, extra: Record<string, unknown> = {}) {
    const err: any = new Error(`hook 'guard' threw: Error: ${businessMessage}`);
    err.name = 'SandboxError';
    err.innerMessage = businessMessage;
    return Object.assign(err, extra);
}

describe('[#27672] §1 an undeclared hook abort resolves to HOOK_ABORTED', () => {
    it('at the 400 a door falls back to (publish, /actions)', () => {
        const thrown = resolveThrownHttpError(sandboxRefusal('Opportunity is closed.'), 400);
        expect(thrown.status).toBe(400);
        expect(thrown.code).toBe('HOOK_ABORTED');
        expect(thrown.code).toBe(UNDECLARED_HOOK_REFUSAL_CODE);
        // The body declared no code, so nothing is reported as declared or demoted.
        expect(thrown.declaredCode).toBeUndefined();
        expect(demotedDeclaredCode(thrown)).toBeUndefined();
    });

    it('at a 4xx status the body declared without a code (`status` or `statusCode`)', () => {
        expect(resolveThrownHttpError(sandboxRefusal('Closed.', { status: 422 }))).toMatchObject({ status: 422, code: 'HOOK_ABORTED' });
        expect(resolveThrownHttpError(sandboxRefusal('Closed.', { statusCode: 403 }))).toMatchObject({ status: 403, code: 'HOOK_ABORTED' });
    });

    it('the constant is the wire spelling', () => {
        expect(UNDECLARED_HOOK_REFUSAL_CODE).toBe('HOOK_ABORTED');
    });
});

describe('[#27672] §2 CONTROLS — nothing else moves', () => {
    it('a registered code the body declared is its own code', () => {
        expect(resolveThrownHttpError(sandboxRefusal('Locked.', { code: 'RECORD_LOCKED', status: 409 })).code).toBe('RECORD_LOCKED');
    });

    it('an unregistered code the body declared (a `refusals` catalogue entry) keeps the derived code and its declaredCode', () => {
        const thrown = resolveThrownHttpError(sandboxRefusal('Over the limit.', { code: 'CREDIT_LIMIT', status: 400 }));
        expect(thrown.code).toBe('VALIDATION_ERROR');
        expect(thrown.declaredCode).toBe('CREDIT_LIMIT');
    });

    it('a non-sandbox producer that declared a 400 and no code still derives VALIDATION_ERROR', () => {
        expect(resolveThrownHttpError(Object.assign(new Error('Closed.'), { status: 400 })).code).toBe('VALIDATION_ERROR');
    });

    it('a body that CRASHED is not an abort', () => {
        const crash = sandboxRefusal('TypeError: not a function');
        expect(sandboxBusinessMessage(crash)).toBeUndefined();
        expect(resolveThrownHttpError(crash, 400).code).toBe('VALIDATION_ERROR');
    });

    it('a sandboxed refusal resolved at a 5xx keeps the fault code', () => {
        expect(resolveThrownHttpError(sandboxRefusal('Closed.'), 500).code).toBe('INTERNAL_ERROR');
        expect(resolveThrownHttpError(sandboxRefusal('Down.', { status: 503 })).code).toBe('SERVICE_UNAVAILABLE');
    });
});
