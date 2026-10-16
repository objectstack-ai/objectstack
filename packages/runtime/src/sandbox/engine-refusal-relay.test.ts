// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23702] An engine refusal a sandboxed body lets leave unchanged leaves the
 * runner as the ENGINE's own error, so every door keys it by its class.
 *
 * Maintainer ruling recorded in commit 65846bc46: one wire spelling on every
 * route, `UNIQUE_VIOLATION`. Every door translates the engine's
 * `DuplicateRecordError` keyed on its declared contract, the registered code
 * AND the class name (`isEngineDuplicateRecordEnvelope`, `@objectstack/types`).
 * The runner used to rebuild the uncaught refusal as a `SandboxError` (code and
 * status lifted, class dropped), so no door recognised it. A producer that
 * merely SPEAKS `DUPLICATE_RECORD` keeps its own code: here, every value the
 * body makes itself, whatever it names itself, and the engine's object once the
 * body rewrote something that crosses the VM on it.
 *
 * The line is the VM OBJECT the host handed in, read off the body's own
 * promise; see `quickjs-runner.ts`'s `HeldEngineRefusal`. Asserted on identity
 * (`toBe`) and on the shared predicate, never on wording.
 */

import { describe, it, expect } from 'vitest';
import { DuplicateRecordError } from '@objectstack/objectql';
import { isEngineDuplicateRecordEnvelope } from '@objectstack/types';

import { QuickJSScriptRunner, SandboxError } from './quickjs-runner.js';
import type { ScriptContext, ScriptOrigin } from './script-runner.js';

const runner = new QuickJSScriptRunner({ hookTimeoutMs: 10_000 });
const ACTION: ScriptOrigin = { kind: 'action', name: 'add_member' };
const HOOK: ScriptOrigin = { kind: 'hook', name: 'mirror_member' };

/** A `ctx.api` whose `insert` rejects with `thrown` every time, and whose `find` answers `[]`. */
function apiRejecting(thrown: unknown) {
    return {
        object: () => ({
            insert: async () => { throw thrown; },
            find: async () => [],
        }),
    } as any;
}

/** Run `source` with `ctx.api` refusing every insert with `thrown`; resolves to what the run threw. */
async function thrownBy(source: string, thrown: unknown, origin: ScriptOrigin = ACTION): Promise<any> {
    try {
        await runner.run(
            { language: 'js', source, capabilities: ['api.read', 'api.write'] },
            { input: {}, api: apiRejecting(thrown) } as ScriptContext,
            { origin },
        );
    } catch (e) {
        return e;
    }
    throw new Error('the body did not throw');
}

const INSERT = `await ctx.api.object('member').insert({ email: 'taken@example.com' });`;

/** The engine's own envelope, as `engine.insert` raises it on a repeated unique value. */
const engineRefusal = () => new DuplicateRecordError('member', new Error('driver refusal'), 'email');

describe('[#23702] the engine\'s refusal, left unchanged, leaves as the engine\'s own error', () => {
    it('uncaught', async () => {
        const refusal = engineRefusal();
        const thrown = await thrownBy(`${INSERT} return { never: true };`, refusal);

        expect(thrown).toBe(refusal);
        expect(isEngineDuplicateRecordEnvelope(thrown)).toBe(true);
    });

    it('caught and re-thrown unchanged — the same object in the same state as uncaught', async () => {
        const refusal = engineRefusal();
        const thrown = await thrownBy(`try { ${INSERT} } catch (e) { throw e; } return { never: true };`, refusal);

        expect(thrown).toBe(refusal);
    });

    it('caught, held across another host call, and thrown later', async () => {
        const refusal = engineRefusal();
        const thrown = await thrownBy(
            `let held; try { ${INSERT} } catch (e) { held = e; }
             await ctx.api.object('member').find({});
             throw held;`,
            refusal,
        );

        expect(thrown).toBe(refusal);
    });

    it('from a hook body too — the relay is the runner\'s, not one origin\'s', async () => {
        const refusal = engineRefusal();
        const thrown = await thrownBy(INSERT, refusal, HOOK);

        expect(thrown).toBe(refusal);
    });
});

describe('[#23702] a body that speaks the code keeps today\'s relay (CONTROLS)', () => {
    /** The relay a speaker gets: a `SandboxError` carrying the code, never the engine's class. */
    function expectSpeaker(thrown: any, refusal: unknown) {
        expect(thrown).not.toBe(refusal);
        expect(thrown).toBeInstanceOf(SandboxError);
        expect(thrown.code).toBe('DUPLICATE_RECORD');
        expect(isEngineDuplicateRecordEnvelope(thrown)).toBe(false);
    }

    it('a deliberate throw of the code', async () => {
        const refusal = engineRefusal();
        const thrown = await thrownBy(
            `throw Object.assign(new Error('That address is already on file'), { code: 'DUPLICATE_RECORD', status: 409 });`,
            refusal,
        );

        expectSpeaker(thrown, refusal);
        expect(thrown.status).toBe(409);
    });

    it('a body\'s own error that names itself the engine\'s class', async () => {
        const refusal = engineRefusal();
        const thrown = await thrownBy(
            `const e = new Error('forged'); e.name = 'DuplicateRecordError'; e.code = 'DUPLICATE_RECORD'; e.status = 409; throw e;`,
            refusal,
        );

        expectSpeaker(thrown, refusal);
    });

    it('a body that copied the engine\'s fields onto its own error', async () => {
        const refusal = engineRefusal();
        const thrown = await thrownBy(
            `try { ${INSERT} } catch (e) { const own = new Error(e.message); own.name = e.name; own.code = e.code; own.status = e.status; throw own; }`,
            refusal,
        );

        expectSpeaker(thrown, refusal);
    });

    it.each([
        ['message', `e.message = 'That address is already on file';`],
        ['userMessage', `e.userMessage = 'Pick another address';`],
    ])('the engine\'s object with its %s rewritten before the throw', async (_field, rewrite) => {
        const refusal = engineRefusal();
        const thrown = await thrownBy(`try { ${INSERT} } catch (e) { ${rewrite} throw e; }`, refusal);

        expectSpeaker(thrown, refusal);
    });

    it('a body that writes `__error` itself while its promise fulfils is never the engine\'s', async () => {
        // The line is read off the body's OWN promise, never a global a body can write.
        const refusal = engineRefusal();
        const thrown = await thrownBy(
            `try { ${INSERT} } catch (e) { globalThis.__error = e.name + ': ' + e.message; } return { ok: true };`,
            refusal,
        );

        expect(thrown).not.toBe(refusal);
        expect(thrown).toBeInstanceOf(SandboxError);
    });
});

describe('[#23702] every other host error crosses exactly as before', () => {
    it('a host refusal that is not the engine\'s duplicate envelope stays a SandboxError carrying its code', async () => {
        const notFound = Object.assign(new Error('Record not found'), { code: 'RECORD_NOT_FOUND', status: 404 });
        const thrown = await thrownBy(`${INSERT} return { never: true };`, notFound);

        expect(thrown).toBeInstanceOf(SandboxError);
        expect(thrown.code).toBe('RECORD_NOT_FOUND');
        expect(thrown.status).toBe(404);
        expect(thrown.innerMessage).toBe('Record not found');
    });
});
