// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#31271] `actionsDoorAnswerOf` is the `/api/v1/actions` door's answer to a
// thrown value, one row per arm. The door's own pins (runtime
// `domains/actions-*.test.ts`, `sandbox/*`) hold the wire bodies it builds from
// this answer; these hold the reader itself, for every face that reads it.

import { describe, it, expect } from 'vitest';
import { actionsDoorAnswerOf } from './actions-door-answer.js';
import { driverNotNullRefusalAnswer } from './data-error-classification.js';
import { INTERNAL_ERROR_MESSAGE } from './error-leak.js';

/** The shape `runtime/src/sandbox/quickjs-runner.ts` throws for an action body's own `throw`. */
function sandboxThrow(inner: string, extra: Record<string, unknown> = {}) {
    const err: any = new Error(`action 'demo_body' threw: ${inner.includes(': ') ? inner : `Error: ${inner}`}`);
    err.name = 'SandboxError';
    err.innerMessage = inner;
    return Object.assign(err, extra);
}

describe('[#31271] the /actions door\'s answer to a thrown value', () => {
    it('a code-less sandboxed abort: 400 HOOK_ABORTED, the inner sentence; the wrapper is an operator line', () => {
        const err = sandboxThrow('Not enough leave');
        const wrapper = err.message;
        expect(actionsDoorAnswerOf(err, 'leave_request')).toEqual({
            status: 400, code: 'HOOK_ABORTED', message: 'Not enough leave', operatorLines: [wrapper],
        });
    });

    it('a bare Error is a rejection: 400 VALIDATION_ERROR with its own sentence, nothing logged', () => {
        expect(actionsDoorAnswerOf(new Error('socket hang up'))).toEqual({
            status: 400, code: 'VALIDATION_ERROR', message: 'socket hang up', operatorLines: [],
        });
    });

    it('[#31317] a driver string code is the /data door\'s fault: 500 DATABASE_ERROR, the code and text withheld, logged', () => {
        const err = Object.assign(new Error('SQLITE_BUSY: database is locked'), { code: 'SQLITE_BUSY' });
        expect(actionsDoorAnswerOf(err)).toEqual({
            status: 500, code: 'DATABASE_ERROR', message: 'Internal data error',
            operatorLines: ['driver fault (SQLITE_BUSY): SQLITE_BUSY: database is locked'],
        });
    });

    it('a sandboxed CRASH is a fault, with or without a declared code: 500, the generic sentence, logged', () => {
        for (const extra of [{}, { code: 'RECORD_LOCKED', status: 409 }]) {
            const err = sandboxThrow('TypeError: boom', extra);
            const wrapper = err.message;
            const answer = actionsDoorAnswerOf(err);
            expect(answer, JSON.stringify(extra)).toEqual({
                status: 500, code: 'INTERNAL_ERROR', message: INTERNAL_ERROR_MESSAGE,
                operatorLines: [`sandboxed body crashed: ${wrapper}`],
            });
            expect(JSON.stringify({ ...answer, operatorLines: undefined })).not.toContain('demo_body');
        }
    });

    it('a non-sandboxed crash (a TypeError from an in-process handler) is the unexpected-fault 500', () => {
        const answer = actionsDoorAnswerOf(new TypeError("Cannot read properties of undefined (reading 'id')"));
        expect(answer).toEqual({
            status: 500, code: 'INTERNAL_ERROR', message: INTERNAL_ERROR_MESSAGE,
            operatorLines: ["unexpected fault (TypeError): Cannot read properties of undefined (reading 'id')"],
        });
    });

    it('CONTROL: a coded sandboxed refusal keeps its code and status, with the inner sentence', () => {
        expect(actionsDoorAnswerOf(sandboxThrow('Locked.', { code: 'RECORD_LOCKED', status: 409 }))).toMatchObject({
            status: 409, code: 'RECORD_LOCKED', message: 'Locked.',
        });
    });

    it('a declared status with an unregistered code: served at that status, the code demoted to declaredCode', () => {
        const answer = actionsDoorAnswerOf(Object.assign(new Error('Quota spent'), { code: 'APP_QUOTA_SPENT', status: 429 }));
        expect(answer.status).toBe(429);
        expect(answer.declaredCode).toBe('APP_QUOTA_SPENT');
        expect(answer.code).not.toBe('APP_QUOTA_SPENT');
        expect(answer.message).toBe('Quota spent');
    });

    it('a declared 5xx carrying a driver dump has its sentence withheld', () => {
        const answer = actionsDoorAnswerOf(Object.assign(
            new Error('insert into "crm_invoice" ("id") values ($1) - relation "crm_invoice" does not exist'),
            { status: 503 },
        ));
        expect(answer.status).toBe(503);
        expect(answer.message).toBe(INTERNAL_ERROR_MESSAGE);
    });

    it('a declared userMessage rides beside the sentence', () => {
        const answer = actionsDoorAnswerOf(Object.assign(new Error('Rejected'), { userMessage: 'Ask your manager.' }));
        expect(answer).toMatchObject({ status: 400, message: 'Rejected', userMessage: 'Ask your manager.' });
    });

    it('a driver NOT NULL refusal answers the classification\'s NOT NULL arm, its code lifted out of details', () => {
        const err = Object.assign(
            new Error('update [statement and bound values redacted] - NOT NULL constraint failed: line_item.unit_price'),
            { code: 'SQLITE_CONSTRAINT_NOTNULL' },
        );
        const arm = driverNotNullRefusalAnswer(err, 'line_item')!;
        const { error: sentence, code, ...rest } = arm.body;
        expect(actionsDoorAnswerOf(err, 'line_item')).toEqual({
            status: arm.status, code, message: sentence, details: rest, operatorLines: [],
        });
        expect(code).toBe('VALIDATION_FAILED');
    });
});
