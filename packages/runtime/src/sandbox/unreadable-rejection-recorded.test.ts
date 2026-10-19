// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23723] A sandboxed body whose rejection no read can flatten still ends its
 * run at once, on the "threw" path, with a fixed sentence.
 *
 * ## What was wrong
 *
 * The wrapper's reject handler records a rejection into `__error`, and the
 * pump loop ends the run only when that is a non-empty string. Three values
 * defeated it: `throw ''` (the fallback `String(e)` is `''`), a
 * null-prototype object (`String()` throws), and an object whose `message`
 * getter throws. `__error` stayed unset or empty, so the run waited for the
 * wall-clock ceiling and ended as a budget `SandboxError` with no
 * `innerMessage`: 30 s at the action door, then `500` naming no refusal.
 *
 * ## What holds now
 *
 * The handler records the fixed sentence for such a value, so the run ends
 * like any other rejection: `<kind> '<name>' threw: Error: <sentence>`, with
 * the sentence as `innerMessage`. The sentence is the ruled one, so it is
 * asserted exactly. It names nothing the value carried (the getter's own
 * error included). A `code` the value carries still rides `__errorInfo`.
 *
 * The runner here has a 1000 ms wall ceiling (CPU budget the same), so a
 * named refusal from it is an answer within a second by construction; a
 * regression answers the ceiling's budget error instead, at that second.
 * The door rows live in `../sandbox-unreadable-rejection-door.test.ts`.
 */

import { describe, it, expect } from 'vitest';

import { QuickJSScriptRunner, SandboxError } from './quickjs-runner.js';
import type { ScriptContext, ScriptRunOptions } from './script-runner.js';

const CEILING_MS = 1000;
const runner = new QuickJSScriptRunner({
    actionTimeoutMs: CEILING_MS,
    hookTimeoutMs: CEILING_MS,
    wallCeilingMs: CEILING_MS,
});
const actionOpts: ScriptRunOptions = { origin: { kind: 'action', name: 'submit' } };
const hookOpts: ScriptRunOptions = { origin: { kind: 'hook', name: 'guard' } };

const UNREADABLE = 'the script threw a value that could not be read';

const GETTER_THROWS = `throw { code: 'EMAIL_TAKEN', get message() { throw new Error('boom at host'); } };`;

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

/** The run ended on the "threw" path with the fixed sentence, not at the ceiling. */
function expectRecorded(err: SandboxError, frame = "action 'submit'") {
    expect(err.message).toBe(`${frame} threw: Error: ${UNREADABLE}`);
    expect(err.innerMessage).toBe(UNREADABLE);
}

describe('[#23723] a rejection no read can flatten is recorded, so the run ends at once', () => {
    it("throw '': the read yields an empty string", async () => {
        const err = await thrownBy(`throw '';`);
        expectRecorded(err);
        expect(err.code).toBeUndefined();
    });

    it('throw Object.create(null): String() throws', async () => {
        const err = await thrownBy(`throw Object.create(null);`);
        expectRecorded(err);
        expect(err.code).toBeUndefined();
    });

    it('{ code, get message() { throw } }: the code is kept, and the getter\'s own error names nothing', async () => {
        const err = await thrownBy(GETTER_THROWS);
        expectRecorded(err);
        expect(err.code).toBe('EMAIL_TAKEN');
        expect(err.message).not.toContain('boom');
    });

    it('…on the hook origin too (both wrappers share the handler)', async () => {
        const err = await thrownBy(GETTER_THROWS, hookOpts);
        expectRecorded(err, "hook 'guard'");
        expect(err.code).toBe('EMAIL_TAKEN');
    });

    it('an Error whose name and message are both empty (its String() is empty)', async () => {
        expectRecorded(await thrownBy(`const e = new Error(); e.name = ''; throw e;`));
    });

    it('an Error whose message getter throws', async () => {
        const err = await thrownBy(
            `const e = new Error('m'); Object.defineProperty(e, 'message', { get() { throw new Error('boom at host'); } }); throw e;`,
        );
        expectRecorded(err);
        expect(err.message).not.toContain('boom');
    });
});

describe('[#23723] CONTROL — what was readable, and what never settles', () => {
    it("{ code, message } keeps PR #23722's answer: its own message, and the code", async () => {
        const err = await thrownBy(`throw { code: 'EMAIL_TAKEN', message: 'That address is already on file' };`);
        expect(err.message).toBe("action 'submit' threw: Error: That address is already on file");
        expect(err.innerMessage).toBe('That address is already on file');
        expect(err.code).toBe('EMAIL_TAKEN');
    });

    it('a body that never settles still ends at the wall-clock ceiling, with no innerMessage', async () => {
        const err = await thrownBy(`await new Promise(() => {});`);
        expect(err.message).toMatch(new RegExp(`exceeded wall-clock ceiling of ${CEILING_MS}ms`));
        expect(err.innerMessage).toBeUndefined();
    });
});
