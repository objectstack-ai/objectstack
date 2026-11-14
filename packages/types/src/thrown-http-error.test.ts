// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [commit 79c46da90] `declaredUserMessage` — the ONE read for "did the producer mark this
// refusal's message user-facing?", and the resolver limb that carries it.
//
// The marking is the producer-side opt-in the objectui#5210 ruling asked for:
// a hook author sets `userMessage` on the thrown error at throw time, every
// boundary carries it to the wire verbatim, and consumers render it while
// keeping the generic #3821 substitution for everything unmarked. What this
// file pins is the DECLARATION rule itself, so it cannot fork per door the way
// the `status`/`statusCode` spelling once did (#7525): the same probe answers
// at the REST classification door, the dispatcher door and the sandbox
// side-channel, because all three call this function.

import { describe, it, expect } from 'vitest';
import { declaredUserMessage, packageScopedRefusalCandidates, resolveThrownHttpError } from './thrown-http-error.js';
import { thrownAnswerOf } from './actions-door-answer.js';
import { mapDataError } from './data-error-classification.js';

const USER_TEXT = '该记录已锁定，请联系管理员。';

describe('[#9934] declaredUserMessage', () => {
    it('a non-empty string userMessage is a declaration, returned verbatim', () => {
        const err = Object.assign(new Error('diagnostic text'), { userMessage: USER_TEXT });
        expect(declaredUserMessage(err)).toBe(USER_TEXT);
    });

    it('is never invented from `message` — an unmarked error declares nothing', () => {
        expect(declaredUserMessage(new Error('a perfectly readable message'))).toBeUndefined();
    });

    it('blank and non-string values are NOT declarations', () => {
        for (const bad of ['', '   ', '\n\t', 0, 42, true, false, {}, [], null, undefined]) {
            const err = Object.assign(new Error('x'), { userMessage: bad });
            expect(declaredUserMessage(err), `userMessage=${JSON.stringify(bad)}`).toBeUndefined();
        }
    });

    it('tolerates non-object throws', () => {
        expect(declaredUserMessage('a bare string')).toBeUndefined();
        expect(declaredUserMessage(null)).toBeUndefined();
        expect(declaredUserMessage(undefined)).toBeUndefined();
    });

    it('preserves the text exactly — no trimming of the returned value', () => {
        // `.trim()` decides WHETHER it is a declaration; the declared VALUE is
        // the producer's bytes, untouched.
        const err = Object.assign(new Error('x'), { userMessage: `  ${USER_TEXT}  ` });
        expect(declaredUserMessage(err)).toBe(`  ${USER_TEXT}  `);
    });
});

describe('[#9934] resolveThrownHttpError carries the marking', () => {
    it('a marked refusal resolves with `userMessage` beside its status and code', () => {
        const thrown = resolveThrownHttpError(
            Object.assign(new Error('guard refused'), {
                statusCode: 403,
                code: 'PERMISSION_DENIED',
                userMessage: USER_TEXT,
            }),
        );
        expect(thrown.status).toBe(403);
        expect(thrown.code).toBe('PERMISSION_DENIED');
        expect(thrown.userMessage).toBe(USER_TEXT);
        // The diagnostic channel is untouched.
        expect(thrown.message).toBe('guard refused');
    });

    it('an unmarked throw resolves with the key ABSENT — not undefined-present', () => {
        const thrown = resolveThrownHttpError(Object.assign(new Error('x'), { statusCode: 403 }));
        expect('userMessage' in thrown).toBe(false);
    });

    it('status-agnostic: a marked 503 carries it the same way', () => {
        const thrown = resolveThrownHttpError(
            Object.assign(new Error('pool drained'), { status: 503, userMessage: USER_TEXT }),
        );
        expect(thrown.status).toBe(503);
        expect(thrown.userMessage).toBe(USER_TEXT);
    });
});

/**
 * [#32250, ADR-0150 D5] A package-scoped refusal — core's
 * `PackageScopedNameRefusedError`, or a plain error of its shape — resolves
 * with its candidates in `details.candidates`, so every door that answers
 * from this resolver names them. Recognised by shape alone (`code ===
 * 'RESOURCE_CONFLICT'` with a `refusal` whose `status` is `'refused'`): this
 * package cannot import core, and the class satisfies the shape.
 */
describe('[#32250] resolveThrownHttpError carries a package-scoped refusal\'s candidates', () => {
    const CANDIDATES = [
        { kind: 'package', packageId: 'com.acme.crm' },
        { kind: 'package', packageId: 'com.acme.sales' },
        { kind: 'platform' },
    ];
    const REFUSAL = {
        status: 'refused', reason: 'ambiguous-in-environment', type: 'permission', name: 'sales_rep',
        callerPackageId: null, candidates: CANDIDATES, message: 'The permission set "sales_rep" is held by 3 holders.',
    };
    /** The class's own shape: `code`, `status`, `httpStatus`, `refusal`. */
    class RefusedLikeCore extends Error {
        readonly code = 'RESOURCE_CONFLICT';
        readonly status = 409;
        readonly httpStatus = 409;
        constructor(readonly refusal: unknown) { super(REFUSAL.message); }
    }
    const shaped = () => Object.assign(new Error(REFUSAL.message), { code: 'RESOURCE_CONFLICT', status: 409, refusal: REFUSAL });

    it('the class shape and the plain shape each resolve 409 RESOURCE_CONFLICT with the candidates', () => {
        for (const thrown of [new RefusedLikeCore(REFUSAL), shaped()]) {
            const resolved = resolveThrownHttpError(thrown);
            expect(resolved.status).toBe(409);
            expect(resolved.code).toBe('RESOURCE_CONFLICT');
            expect(resolved.details).toEqual({ candidates: CANDIDATES });
            expect(packageScopedRefusalCandidates(thrown)).toEqual(CANDIDATES);
        }
    });

    it('a door composing from the resolver (`thrownAnswerOf`) carries them', () => {
        expect(thrownAnswerOf(shaped(), 500).details).toEqual({ candidates: CANDIDATES });
    });

    it('CONTROL: nothing else gains the member', () => {
        const controls: Array<[string, unknown]> = [
            ['a RESOURCE_CONFLICT with no refusal', Object.assign(new Error('x'), { code: 'RESOURCE_CONFLICT', status: 409 })],
            ['a refusal that is not refused', Object.assign(new Error('x'), { code: 'RESOURCE_CONFLICT', status: 409, refusal: { ...REFUSAL, status: 'resolved' } })],
            ['a refusal whose candidates are not a list', Object.assign(new Error('x'), { code: 'RESOURCE_CONFLICT', status: 409, refusal: { ...REFUSAL, candidates: 'com.acme.crm' } })],
            ['a refused shape under another code', Object.assign(new Error('x'), { code: 'UNIQUE_VIOLATION', status: 409, refusal: REFUSAL })],
            ['a unique violation', Object.assign(new Error('dup'), { code: 'UNIQUE_VIOLATION', status: 409 })],
            ['a bare Error', new Error('boom')],
            ['a non-object', 'boom'],
        ];
        for (const [name, thrown] of controls) {
            expect(resolveThrownHttpError(thrown).details, name).toBeUndefined();
            expect(packageScopedRefusalCandidates(thrown), name).toBeUndefined();
        }
    });

    it('CONTROL: the shape with no declared status carries none, through the resolver, `thrownAnswerOf` and `mapDataError` alike', () => {
        const undeclared = () => Object.assign(new Error(REFUSAL.message), { code: 'RESOURCE_CONFLICT', refusal: REFUSAL });
        expect(packageScopedRefusalCandidates(undeclared())).toBeUndefined();
        expect(resolveThrownHttpError(undeclared()).details).toBeUndefined();
        expect(thrownAnswerOf(undeclared(), 500).details).toBeUndefined();
        expect(mapDataError(undeclared(), 'acct').body.details).toBeUndefined();
        // A declared 4xx under either spelling the resolver reads still carries them; a declared 5xx does not.
        const statusCode = Object.assign(undeclared(), { statusCode: 409 });
        expect(resolveThrownHttpError(statusCode).details).toEqual({ candidates: CANDIDATES });
        expect(mapDataError(statusCode, 'acct').body.details).toEqual({ candidates: CANDIDATES });
        expect(resolveThrownHttpError(Object.assign(undeclared(), { status: 500 })).details).toBeUndefined();
    });

    it('CONTROL: a status outside the 4xx interval read as a number (NaN, a string, null) carries none, on all three exits alike', () => {
        const odd: Array<[string, Record<string, unknown>]> = [
            ['status NaN', { status: Number.NaN }],
            ['statusCode NaN', { statusCode: Number.NaN }],
            ['status \'409\'', { status: '409' }],
            ['status null', { status: null }],
        ];
        for (const [name, extra] of odd) {
            const thrown = () => Object.assign(new Error(REFUSAL.message), { code: 'RESOURCE_CONFLICT', refusal: REFUSAL }, extra);
            expect(packageScopedRefusalCandidates(thrown()), name).toBeUndefined();
            expect(resolveThrownHttpError(thrown()).details, name).toBeUndefined();
            expect(thrownAnswerOf(thrown(), 500).details, name).toBeUndefined();
            expect(mapDataError(thrown(), 'acct').body.details, name).toBeUndefined();
        }
    });

    it('CONTROL: a refusal\'s candidates sit beside the context the resolver already carried', () => {
        const thrown = Object.assign(shaped(), { issues: [{ path: ['x'], message: 'y' }] });
        expect(resolveThrownHttpError(thrown).details).toEqual({ issues: [{ path: ['x'], message: 'y' }], candidates: CANDIDATES });
    });
});
