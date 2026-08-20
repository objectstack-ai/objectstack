// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#9934] `declaredUserMessage` — the ONE read for "did the producer mark this
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
import { declaredUserMessage, resolveThrownHttpError } from './thrown-http-error.js';

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
