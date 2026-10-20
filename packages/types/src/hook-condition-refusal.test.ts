// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24662] The one recogniser for an unevaluable hook condition's refusal, and
 * the two rules that read it: `resolveThrownHttpError` (the runtime doors, the
 * Hono doors and the batch rows) and `mapDataError` (`@objectstack/rest`'s
 * doors). Both must answer `400 VALIDATION_ERROR` for the same throw, and both
 * must leave the `uncompilable` reason on the sanitised `500` it had.
 *
 * The error is built in the shape `@objectstack/objectql`'s `HookConditionError`
 * has — its declared `name` and fields. This package cannot import that class;
 * the real class drives the same answer end to end in `@objectstack/rest`'s
 * `rest-hook-condition-unevaluable-refusal.test.ts` and in
 * `@objectstack/runtime`'s `domains/data-hook-condition-refusal.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { unevaluableHookConditionRefusal } from './hook-condition-refusal.js';
import { resolveThrownHttpError } from './thrown-http-error.js';
import { mapDataError } from './data-error-classification.js';

const UNEVALUABLE_MESSAGE =
    "Hook 'qa_failclosed' could not evaluate its condition (runtime: int() type error: cannot convert to int)"
    + ' — operation aborted.';
const UNCOMPILABLE_MESSAGE =
    "Hook 'qa_broken' declares a condition that does not compile (parse: Unexpected token: EOF) — operation aborted."
    + ' The condition can never be evaluated, so the hook can neither run nor be skipped honestly;'
    + ' fix the expression: record.name ==';

function hookConditionError(reason: 'unevaluable' | 'uncompilable'): Error {
    const unevaluable = reason === 'unevaluable';
    const err = new Error(unevaluable ? UNEVALUABLE_MESSAGE : UNCOMPILABLE_MESSAGE);
    return Object.assign(err, {
        name: 'HookConditionError',
        hook: unevaluable ? 'qa_failclosed' : 'qa_broken',
        object: 'inquiry',
        event: 'beforeInsert',
        condition: unevaluable ? "record.name.startsWith('qa-fc') && int(record.name) > 0" : 'record.name ==',
        reason,
        fault: unevaluable ? 'runtime: int() type error: cannot convert to int' : 'parse: Unexpected token: EOF',
    });
}

describe('[#24662] unevaluableHookConditionRefusal', () => {
    it('answers 400 and the catalog member 400 names for the unevaluable reason', () => {
        expect(unevaluableHookConditionRefusal(hookConditionError('unevaluable')))
            .toEqual({ status: 400, code: 'VALIDATION_ERROR' });
    });

    it('declines the uncompilable reason, another class, a bare reason and a non-object', () => {
        expect(unevaluableHookConditionRefusal(hookConditionError('uncompilable'))).toBeUndefined();
        expect(unevaluableHookConditionRefusal(Object.assign(new Error('x'), { reason: 'unevaluable' }))).toBeUndefined();
        expect(unevaluableHookConditionRefusal(Object.assign(new Error('x'), { name: 'HookConditionError' }))).toBeUndefined();
        expect(unevaluableHookConditionRefusal(undefined)).toBeUndefined();
        expect(unevaluableHookConditionRefusal('HookConditionError')).toBeUndefined();
    });
});

describe('[#24662] the two rules that read it agree', () => {
    it('resolveThrownHttpError: a declaration by shape — status AND code, the message verbatim', () => {
        const thrown = resolveThrownHttpError(hookConditionError('unevaluable'));
        expect(thrown).toMatchObject({
            status: 400,
            declaredStatus: 400,
            code: 'VALIDATION_ERROR',
            declaredCode: 'VALIDATION_ERROR',
            message: UNEVALUABLE_MESSAGE,
        });
    });

    it('mapDataError: the same status and code, the producer sentence, the route object', () => {
        expect(mapDataError(hookConditionError('unevaluable'), 'inquiry')).toEqual({
            status: 400,
            body: { error: UNEVALUABLE_MESSAGE, code: 'VALIDATION_ERROR', object: 'inquiry' },
        });
    });

    it('CONTROL: the uncompilable reason keeps the undeclared 500 on both rules', () => {
        const thrown = resolveThrownHttpError(hookConditionError('uncompilable'));
        expect(thrown.status).toBe(500);
        expect(thrown.declaredStatus).toBeUndefined();
        expect(thrown.code).toBe('INTERNAL_ERROR');
        expect(mapDataError(hookConditionError('uncompilable'), 'inquiry')).toEqual({
            status: 500,
            body: { error: 'Internal server error', code: 'INTERNAL_ERROR' },
        });
    });
});
