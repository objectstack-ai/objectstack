// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22588] A NESTED sandboxed refusal reaches the caller in its author's words.
 *
 * ## What was measured broken
 *
 * On a booted stack at `3d0eeefa`, a script action whose body writes through
 * `ctx.api` and is refused by a sandboxed `beforeUpdate` hook answered
 *
 *   POST /api/v1/actions/mz_task/mz_reopen/ID
 *   400 VALIDATION_ERROR "hook 'mz_guard_reopen' threw: Error: A finished task cannot be reopened. …"
 *
 * while the SAME refusal answered the bare sentence through `PATCH /data/…` and
 * through a declarative (`operation: 'update'`) action. A hook that writes
 * another object through `ctx.api` put the same wrapper on `PATCH /data/…`.
 *
 * Every door was reading the right field. The producer had filled it with the
 * wrong text one VM hop earlier: `hostErrorToVm` marshals a host error into the
 * VM as `name` + `message` only, so the nested refusal crossed as its debug
 * wrapper, and the pump loop built the outer `innerMessage` from that.
 *
 * ## The real runner at every level
 *
 * Every refusal here is produced by {@link QuickJSScriptRunner} running a real
 * hook body — never a hand-built `SandboxError` — so the fixture carries the
 * runner's own `Error: ` token and wrapper exactly as production does. The
 * hand-built shape is what let `toContain(REFUSAL)` pins stay green over the
 * defect (`nested-hook-refusal-is-a-rejection.test.ts`, flipped by this card).
 */

import { describe, it, expect } from 'vitest';

import { QuickJSScriptRunner, SandboxError } from './quickjs-runner.js';
import type { ScriptOrigin } from './script-runner.js';

const REFUSAL = 'A finished task cannot be reopened. Create a follow-up task instead.';

const runner = new QuickJSScriptRunner({ hookTimeoutMs: 10_000, actionTimeoutMs: 10_000 });

const hook = (name: string): { origin: ScriptOrigin } => ({ origin: { kind: 'hook', name } });
const action = (name: string): { origin: ScriptOrigin } => ({ origin: { kind: 'action', name } });

/** Run `source` and return what it rejected with (fails the test if it resolved). */
async function rejectionOf(
    source: string,
    opts: { origin: ScriptOrigin },
    api?: unknown,
): Promise<any> {
    const err = await runner.runScript(
        { language: 'js', source, capabilities: api ? ['api.write'] : [] },
        { input: {}, ...(api ? { api } : {}) } as any,
        opts,
    ).then(() => null, (e: unknown) => e);
    expect(err, 'expected the body to reject, but it resolved').toBeInstanceOf(SandboxError);
    return err;
}

/** A sandboxed `beforeUpdate` guard's REAL refusal, built by the runner itself. */
const guardRefusal = () =>
    rejectionOf(`throw new Error(${JSON.stringify(REFUSAL)});`, hook('guard_reopen'));

/** A `ctx.api` whose `update` is refused by `thrown()` — the engine handing the hook's error back. */
const refusingApi = (thrown: () => Promise<unknown>) => ({
    object: () => ({ update: async () => { throw await thrown(); } }),
});

const WRITE = "await ctx.api.object('mz_task').update({ id: 't1', done: false });";

describe('[#22588] the nested refusal crosses the hop as a sentence', () => {
    it('the fixture is the real shape: the hook frame and the `Error: ` token are in `.message`', async () => {
        const err = await guardRefusal();
        expect(err.message).toBe(`hook 'guard_reopen' threw: Error: ${REFUSAL}`);
        expect(err.innerMessage).toBe(REFUSAL);
    });

    it('action ← hook: the action\'s `innerMessage` is the hook\'s sentence, verbatim', async () => {
        const err = await rejectionOf(WRITE, action('reopen'), refusingApi(guardRefusal));

        // THE defect: this read `hook 'guard_reopen' threw: Error: <sentence>`.
        expect(err.innerMessage).toBe(REFUSAL);
        // The log-only `.message` still names every frame (#17265's half).
        expect(err.message).toContain("action 'reopen' threw:");
        expect(err.message).toContain("hook 'guard_reopen' threw:");
    });

    it('hook ← hook — the `/data` face: a hook writing another object keeps the sentence too', async () => {
        const err = await rejectionOf(WRITE, hook('relay'), refusingApi(guardRefusal));

        expect(err.innerMessage).toBe(REFUSAL);
        expect(err.message).toContain("hook 'relay' threw:");
    });

    it('action ← hook ← hook: the relay is transitive', async () => {
        const middle = () => rejectionOf(WRITE, hook('relay'), refusingApi(guardRefusal));
        const err = await rejectionOf(WRITE, action('reopen'), refusingApi(middle));

        expect(err.innerMessage).toBe(REFUSAL);
    });

    it('a body that catches and re-throws the SAME error still relays the sentence', async () => {
        const err = await rejectionOf(
            `try { ${WRITE} } catch (e) { throw e; }`,
            action('reopen'),
            refusingApi(guardRefusal),
        );

        expect(err.innerMessage).toBe(REFUSAL);
    });
});

describe('[#22588] a body that speaks for itself is relayed in its OWN words', () => {
    it('a body that throws its own error after catching is not overridden', async () => {
        const err = await rejectionOf(
            `try { ${WRITE} } catch (e) { throw new Error('Could not reopen this task.'); }`,
            action('reopen'),
            refusingApi(guardRefusal),
        );

        expect(err.innerMessage).toBe('Could not reopen this task.');
    });

    it('a body that rewrites the caught error\'s message before re-throwing keeps its rewrite', async () => {
        // The relay is gated on the message being UNCHANGED: once the body has
        // reworded the error, the words it threw are its own statement.
        const err = await rejectionOf(
            `try { ${WRITE} } catch (e) { e.message = 'Reopen refused.'; throw e; }`,
            action('reopen'),
            refusingApi(guardRefusal),
        );

        expect(err.innerMessage).toBe('Reopen refused.');
    });

    it('CONTROL — a non-sandboxed host refusal is relayed from its own message, as before', async () => {
        const err = await rejectionOf(
            WRITE,
            action('reopen'),
            refusingApi(async () => Object.assign(new Error('Record is locked.'), { status: 409 })),
        );

        expect(err.innerMessage).toBe('Record is locked.');
        expect(err.status).toBe(409);
    });
});

describe('[#22588] the FAULT side is untouched', () => {
    it('a nested CRASH carries no sentence and stays the sandbox\'s fault', async () => {
        const crash = () => rejectionOf("throw new TypeError('x is not a function');", hook('guard_reopen'));
        const err = await rejectionOf(WRITE, action('reopen'), refusingApi(crash));

        // No `innerMessage` is the #3951 crash mark every door answers 500 for.
        expect(err.innerMessage).toBeUndefined();
    });
});
