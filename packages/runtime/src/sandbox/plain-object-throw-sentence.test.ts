// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23718] A sandboxed body that throws a VALUE which is not an `Error` — the
 * plain `{ code, message }` object metadata app bodies throw — crosses out of
 * the VM with its own `message` as `innerMessage`, the field every door serves
 * as the caller's sentence.
 *
 * ## What was wrong
 *
 * The wrapper's reject handler flattened every rejection as
 * `<name>: <message>`, else `String(e)`. A plain object has no class name and
 * no `toString` of its own, so a body throwing
 * `{ code: 'EMAIL_TAKEN', message: 'That address is already on file' }` was
 * answered `undefined: That address is already on file`, and one throwing
 * `{ code: 'DUPLICATE_RECORD' }` was answered `[object Object]`.
 *
 * ## What holds now
 *
 * A non-`Error` object is flattened under the default name `Error`, so its
 * `message` is the sentence byte for byte. With no usable `message` and no
 * `toString` of its own, the sentence is `INTERNAL_ERROR_MESSAGE`, the one
 * every door answers for a fault with no business message. `code` rides
 * `__errorInfo` as before. A thrown `Error` (and subclass), a thrown primitive,
 * and a value with a `toString` of its own are flattened exactly as before.
 *
 * The door rows live in `../sandbox-plain-object-throw-client-sentence.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { INTERNAL_ERROR_MESSAGE } from '@objectstack/types';

import { QuickJSScriptRunner, SandboxError } from './quickjs-runner.js';
import type { ScriptContext, ScriptRunOptions } from './script-runner.js';

const runner = new QuickJSScriptRunner({ hookTimeoutMs: 10_000 });
const actionOpts: ScriptRunOptions = { origin: { kind: 'action', name: 'submit' } };
const hookOpts: ScriptRunOptions = { origin: { kind: 'hook', name: 'guard' } };

const SENTENCE = 'That address is already on file';

/** Run `source` as a body and hand back the error it rejected with. */
async function thrownBy(source: string, opts: ScriptRunOptions = actionOpts): Promise<SandboxError> {
    const err = await runner
        .run({ language: 'js', source, capabilities: [] }, { input: {} } as ScriptContext, opts)
        .then(
            () => undefined,
            (e: unknown) => e,
        );
    expect(err).toBeInstanceOf(SandboxError);
    return err as SandboxError;
}

describe('[#23718] a thrown plain object crosses with its own message as the sentence', () => {
    it('{ code, message }: the message is innerMessage, and the code is kept', async () => {
        const err = await thrownBy(`throw { code: 'EMAIL_TAKEN', message: '${SENTENCE}' };`);
        expect(err.innerMessage).toBe(SENTENCE);
        expect(err.code).toBe('EMAIL_TAKEN');
        expect(err.message).not.toContain('undefined:');
    });

    it('…on the hook origin too (both wrappers share the handler)', async () => {
        const err = await thrownBy(`throw { code: 'EMAIL_TAKEN', message: '${SENTENCE}' };`, hookOpts);
        expect(err.innerMessage).toBe(SENTENCE);
        expect(err.code).toBe('EMAIL_TAKEN');
    });

    it('{ code } with no message: the no-business-message sentence, never [object Object]', async () => {
        const err = await thrownBy(`throw { code: 'DUPLICATE_RECORD' };`);
        expect(err.innerMessage).toBe(INTERNAL_ERROR_MESSAGE);
        expect(err.code).toBe('DUPLICATE_RECORD');
        expect(err.message).not.toContain('[object Object]');
    });

    it('a value whose String() is empty gets the same sentence (it used to record no rejection)', async () => {
        const err = await thrownBy(`throw [];`);
        expect(err.innerMessage).toBe(INTERNAL_ERROR_MESSAGE);
    });

    it('a message that itself begins "Error: " crosses byte for byte', async () => {
        const err = await thrownBy(`throw { message: 'Error: lead is incomplete' };`);
        expect(err.innerMessage).toBe('Error: lead is incomplete');
    });

    it('a name on a plain object is a field, never a frame: no prefix, and no crash reading', async () => {
        const err = await thrownBy(`throw { name: 'TypeError', message: 'forged' };`);
        expect(err.innerMessage).toBe('forged');
    });
});

describe('[#23718] CONTROL — everything else is flattened exactly as before', () => {
    it('a thrown Error still reads `name: message` in the log, and its message is the sentence', async () => {
        const err = await thrownBy(`throw new Error('x');`);
        expect(err.message).toBe("action 'submit' threw: Error: x");
        expect(err.innerMessage).toBe('x');
    });

    it('a thrown Error subclass keeps its name in both', async () => {
        const err = await thrownBy(`throw new TypeError('t');`);
        expect(err.message).toBe("action 'submit' threw: TypeError: t");
        expect(err.innerMessage).toBe('TypeError: t');
    });

    it('a thrown string is its own sentence', async () => {
        const err = await thrownBy(`throw 'Name is required';`);
        expect(err.innerMessage).toBe('Name is required');
    });

    it('an object with a toString of its own keeps it', async () => {
        const err = await thrownBy(`throw { toString() { return 'custom words'; } };`);
        expect(err.innerMessage).toBe('custom words');
    });
});
