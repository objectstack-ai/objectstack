// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #3918 follow-up — structured host errors crossing the sandbox boundary.
 *
 * Found by dogfooding the merged #3918 chain against a running app: submitting
 * a record that fails validation through a form ACTION came back as
 *
 *   HTTP 200  { success: true, data: { success: false,
 *                                      error: "ValidationError: issued_on is required" } }
 *
 * — no status a client could branch on, no code, and no `fields[]`. The chain's
 * dispatcher fixes could not help, because the field list was already gone
 * before any dispatcher exit ran. It was lost at the VM boundary, twice:
 *
 *   1. host → VM: `vm.newError({ name, message })` dropped every other property.
 *   2. VM → host: the wrapper's reject handler flattened the error to the
 *      string `<name>: <message>`.
 *
 * Both hops now carry an explicit ALLOWLIST (`code`, `fields`) alongside the
 * message. The allowlist is the security-relevant part and is asserted here:
 * host errors routinely hang driver state, connection details or whole record
 * payloads off themselves, and anything that crosses INTO the VM is readable by
 * untrusted sandboxed code.
 */

import { describe, it, expect } from 'vitest';
import { ValidationError } from '@objectstack/objectql';

import { QuickJSScriptRunner, SandboxError } from './quickjs-runner.js';
import type { ScriptContext, ScriptRunOptions } from './script-runner.js';

const runner = new QuickJSScriptRunner({ hookTimeoutMs: 10_000 });
const actionOpts: ScriptRunOptions = { origin: { kind: 'action', name: 'submit' } };

const FIELDS = [
    { field: 'issued_on', code: 'required' as const, message: 'issued_on is required' },
];

/** A ctx.api whose single write rejects with `thrown`. */
function apiThrowing(thrown: unknown) {
    return { object: () => ({ update: async () => { throw thrown; } }) } as any;
}

/** Run an action body against that api. */
function run(source: string, thrown: unknown) {
    return runner.run(
        { language: 'js', source, capabilities: ['api.write'] },
        { input: {}, api: apiThrowing(thrown) } as ScriptContext,
        actionOpts,
    );
}

describe('#3918 follow-up — host error → VM', () => {
    it('a body can read `code` and `fields` off a rejected write', async () => {
        const r = await run(
            `try { await ctx.api.object('invoice').update({ id: 1 }); }
             catch (e) { return { code: e.code, fields: e.fields, message: e.message, name: e.name }; }
             return { never: true };`,
            new ValidationError(FIELDS),
        );

        expect(r.value).toEqual({
            code: 'VALIDATION_FAILED',
            fields: FIELDS,
            message: 'issued_on is required',
            name: 'ValidationError',
        });
    });

    it('does NOT carry anything outside the allowlist into the VM', async () => {
        // The security assertion. `internal` stands in for the driver handles,
        // DSNs and record payloads real host errors carry; sandboxed code must
        // not be able to read them off a rejection.
        const err = Object.assign(new ValidationError(FIELDS), {
            internal: { dsn: 'postgres://user:pw@host/db' },
            record: { ssn: '000-00-0000' },
        });
        const r = await run(
            `try { await ctx.api.object('invoice').update({ id: 1 }); }
             catch (e) { return { internal: e.internal ?? null, record: e.record ?? null, keys: Object.keys(e) }; }
             return { never: true };`,
            err,
        );

        const v = r.value as any;
        expect(v.internal).toBeNull();
        expect(v.record).toBeNull();
        // Nothing beyond the message channels and the two allowlisted keys.
        // (`vm.newError` makes `name`/`message` own enumerable props in QuickJS.)
        expect(v.keys.sort()).toEqual(['code', 'fields', 'message', 'name']);
    });

    it('leaves an ordinary error as bare name/message', async () => {
        const r = await run(
            `try { await ctx.api.object('invoice').update({ id: 1 }); }
             catch (e) { return { name: e.name, message: e.message, code: e.code ?? null, fields: e.fields ?? null }; }
             return { never: true };`,
            new Error('backend unavailable'),
        );

        expect(r.value).toEqual({
            name: 'Error', message: 'backend unavailable', code: null, fields: null,
        });
    });
});

describe('#3918 follow-up — VM error → host', () => {
    /** Let the rejection escape the body, the way a real action body does. */
    const UNCAUGHT = `await ctx.api.object('invoice').update({ id: 1 }); return { never: true };`;

    it('carries `code` and `fields` onto the thrown SandboxError', async () => {
        const err = await run(UNCAUGHT, new ValidationError(FIELDS)).catch((e) => e);

        expect(err).toBeInstanceOf(SandboxError);
        expect(err.code).toBe('VALIDATION_FAILED');
        expect(err.fields).toEqual(FIELDS);
    });

    it('leaves the message channels byte-identical', async () => {
        // `.message` (server log, with the debug wrapper) and `.innerMessage`
        // (what a toast shows) are what every existing consumer reads. The
        // structured payload rides ALONGSIDE them, never instead of them.
        const err = await run(UNCAUGHT, new ValidationError(FIELDS)).catch((e) => e);

        expect(err.message).toBe("action 'submit' threw: ValidationError: issued_on is required");
        expect(err.innerMessage).toBe('ValidationError: issued_on is required');
    });

    it('leaves an ordinary failure with no code/fields at all', async () => {
        const err = await run(UNCAUGHT, new Error('backend unavailable')).catch((e) => e);

        expect(err).toBeInstanceOf(SandboxError);
        expect(err.code).toBeUndefined();
        expect(err.fields).toBeUndefined();
        expect(err.innerMessage).toBe('backend unavailable');
    });

    it('carries the payload for an error the BODY re-throws', async () => {
        // A body that catches, inspects and re-throws must not lose it either.
        const err = await run(
            `try { await ctx.api.object('invoice').update({ id: 1 }); }
             catch (e) { throw e; }`,
            new ValidationError(FIELDS),
        ).catch((e) => e);

        expect(err.code).toBe('VALIDATION_FAILED');
        expect(err.fields).toEqual(FIELDS);
    });

    it('survives a body that throws its own error with a code', async () => {
        // Author-thrown structured errors get the same treatment — nothing here
        // is objectql-specific.
        const err = await run(
            `var e = new Error('pick another'); e.code = 'DUPLICATE'; throw e;`,
            new Error('unused'),
        ).catch((e) => e);

        expect(err.code).toBe('DUPLICATE');
        expect(err.fields).toBeUndefined();
    });
});

/* ────────────────────────────────────────────────────────────────────────────
 * [#7867] `status` — the third allowlisted property, and why it had to join
 * ──────────────────────────────────────────────────────────────────────────── */

describe('[#7867] an error that names its own HTTP status keeps it across the boundary', () => {
    /** The exact shape `@objectstack/core`'s `recordNotFoundError` produces. */
    const recordNotFound = () =>
        Object.assign(new Error('Record ghost not found in invoice'), {
            code: 'RECORD_NOT_FOUND',
            status: 404,
            object: 'invoice',
        });

    const UNCAUGHT = `await ctx.api.object('invoice').update({ id: 'ghost' }); return { never: true };`;

    it('carries `status` onto the thrown SandboxError, so /actions can serve 404', async () => {
        // Without this the action surface answered the RIGHT diagnosis at the
        // WRONG status — `{ code: 'RECORD_NOT_FOUND', httpStatus: 400 }` —
        // because `domains/actions.ts`'s "an error that NAMES its own HTTP
        // status is asking to be served with it" branch reads `.status`, and
        // the number never arrived. 404 and 400 mean different things to a
        // client's retry and cache policy, so a half-carried error is not a fix.
        const err = await run(UNCAUGHT, recordNotFound()).catch((e) => e);

        expect(err).toBeInstanceOf(SandboxError);
        expect(err.code).toBe('RECORD_NOT_FOUND');
        expect(err.status).toBe(404);
    });

    it('a body can read `status` off a rejected write', async () => {
        const r = await run(
            `try { await ctx.api.object('invoice').update({ id: 'ghost' }); }
             catch (e) { return { code: e.code, status: e.status }; }
             return { never: true };`,
            recordNotFound(),
        );

        expect(r.value).toEqual({ code: 'RECORD_NOT_FOUND', status: 404 });
    });

    it('still carries NOTHING outside the allowlist — `object` does not cross', async () => {
        // The allowlist widened by exactly one property, and the security
        // assertion widens with it rather than being relaxed. `recordNotFound`
        // also hangs an `object` off itself; it must not become readable.
        const r = await run(
            `try { await ctx.api.object('invoice').update({ id: 'ghost' }); }
             catch (e) { return { object: e.object ?? null, keys: Object.keys(e) }; }
             return { never: true };`,
            recordNotFound(),
        );

        const v = r.value as any;
        expect(v.object).toBeNull();
        expect(v.keys.sort()).toEqual(['code', 'message', 'name', 'status']);
    });

    it('leaves an error with no status alone — `status` stays undefined', async () => {
        // The contrast pin. A record `ValidationError` deliberately carries no
        // `.status` (`validation-failure.ts`), which is what keeps it out of
        // the classifier's status branch and on the 400 rejection exit.
        const err = await run(UNCAUGHT, new ValidationError(FIELDS)).catch((e) => e);

        expect(err.code).toBe('VALIDATION_FAILED');
        expect(err.status).toBeUndefined();
    });

    it('ignores a non-finite status rather than serving a nonsense one', async () => {
        const err = await run(
            `var e = new Error('nope'); e.code = 'WEIRD'; e.status = NaN; throw e;`,
            new Error('unused'),
        ).catch((e) => e);

        expect(err.code).toBe('WEIRD');
        expect(err.status).toBeUndefined();
    });
});

/* ────────────────────────────────────────────────────────────────────────────
 * [#9934] `userMessage` — the fourth allowlisted property: the producer-side
 * user-facing marking (objectui#5210 ruling). A sandboxed BODY is the authoring
 * surface the marking exists for, so the author's opt-in must survive the VM
 * flattening the throw to a string — in both directions, like the other three.
 * ──────────────────────────────────────────────────────────────────────────── */

describe('[#9934] a body-authored user-facing marking crosses the boundary', () => {
    const USER_TEXT = '该记录已进入结账期，暂不能修改。';

    it('carries `userMessage` onto the thrown SandboxError — the marking the HTTP doors read', async () => {
        const err = await run(
            `var e = new Error('close-period guard refused');
             e.status = 403;
             e.userMessage = ${JSON.stringify(USER_TEXT)};
             throw e;`,
            new Error('unused'),
        ).catch((e) => e);

        expect(err).toBeInstanceOf(SandboxError);
        expect(err.status).toBe(403);
        expect(err.userMessage).toBe(USER_TEXT);
        // The message channels are untouched — the marking rides ALONGSIDE.
        expect(err.innerMessage).toBe('close-period guard refused');
    });

    it('an unmarked throw carries NO userMessage — the sandbox never invents one', async () => {
        const err = await run(
            `var e = new Error('refused'); e.status = 403; throw e;`,
            new Error('unused'),
        ).catch((e) => e);

        expect(err).toBeInstanceOf(SandboxError);
        expect(err.userMessage).toBeUndefined();
    });

    it('a blank marking is not a declaration', async () => {
        const err = await run(
            `var e = new Error('refused'); e.userMessage = '   '; throw e;`,
            new Error('unused'),
        ).catch((e) => e);

        expect(err.userMessage).toBeUndefined();
    });

    it('a body can read `userMessage` off a rejected host write, and a re-throw keeps it', async () => {
        // Host → VM → host, the round trip the other three properties already
        // guarantee: a body that catches, inspects and re-throws a marked host
        // refusal must not strip the marking.
        const marked = Object.assign(new Error('guard refused'), {
            code: 'PERMISSION_DENIED',
            status: 403,
            userMessage: USER_TEXT,
        });
        const err = await run(
            `try { await ctx.api.object('invoice').update({ id: 1 }); }
             catch (e) { if (e.userMessage !== ${JSON.stringify(USER_TEXT)}) throw new Error('lost'); throw e; }`,
            marked,
        ).catch((e) => e);

        expect(err).toBeInstanceOf(SandboxError);
        expect(err.userMessage).toBe(USER_TEXT);
        expect(err.code).toBe('PERMISSION_DENIED');
    });
});
