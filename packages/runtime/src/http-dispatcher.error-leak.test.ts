// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #3867 follow-up — the OTHER dispatcher error exit.
 *
 * #3867 sanitised `dispatcher-plugin`'s `errorResponseBase`, which handles
 * errors THROWN out of `dispatch()`. It does not cover the errors `dispatch()`
 * RETURNS: a `{handled: true, response}` result goes to `sendResult`, never
 * through that catch. Those bodies are built by `HttpDispatcher.error()` — the
 * single construction point for every returned error — and it passed the
 * message through verbatim.
 *
 * That path is reachable with a raw driver message today via `errorFromThrown`
 * (`/meta` save, `/packages` install) and the MCP transport's
 * `deps.error(err?.message, 500)`.
 *
 * `error()` is private, so these drive it the way real traffic does: through
 * `dispatch()` on routes whose service throws.
 */

import { describe, it, expect } from 'vitest';

import { HttpDispatcher } from './http-dispatcher.js';

const SQL_DUMP = 'insert into `sys_team` (`id`) values (?) - UNIQUE constraint failed: sys_team.id';

/**
 * A kernel whose `protocol` service throws on `saveMetaItem` — the `/meta` PUT
 * route catches it and RETURNS `deps.errorFromThrown(e, 400)`, which is the
 * returned-error path this guard covers (it never reaches the plugin's
 * throw-side `errorResponseBase`).
 */
function makeDispatcher(saveError: unknown) {
    const protocol = {
        saveMetaItem: async () => { throw saveError; },
    };
    // An auth service that resolves an authenticated caller — otherwise the
    // dispatch would 401 at the anonymous-deny gate (#3963) before reaching the
    // error path this test covers.
    const auth = { api: { getSession: async () => ({ user: { id: 'u1' } }) } };
    const svc = (name: string) =>
        name === 'protocol' ? protocol : name === 'auth' ? auth : undefined;
    const kernel: any = {
        getService: svc,
        getServiceAsync: async (name: string) => svc(name),
    };
    const dispatcher = new HttpDispatcher(kernel);
    // [#7019] The `/meta` PUT this guard uses as its vehicle now demands the
    // `manage_metadata` capability — an authoring capability, not just a
    // session. `dispatch()` re-resolves the execution context from the auth /
    // objectql services (overwriting whatever the caller passes in), and these
    // stubs have no objectql, so the resolved caller would hold NO capabilities
    // and be refused before reaching the error path under test. Stubbing the
    // resolution is the dispatcher-side spelling of the `resolveExecCtx`
    // override the REST suites use. What is under test — the sanitisation of a
    // RETURNED error — is untouched.
    (dispatcher as any).timedResolveExecutionContext = async () => ({
        userId: 'u1', systemPermissions: ['manage_metadata'],
    });
    return dispatcher;
}

async function putMeta(saveError: unknown) {
    const dispatcher = makeDispatcher(saveError);
    return dispatcher.dispatch(
        'PUT',
        '/meta/object/widget',
        { name: 'widget' },
        {},
        { executionContext: { userId: 'u1' } } as any,
    );
}

describe('#3867 follow-up — HttpDispatcher.error() does not return raw driver messages', () => {
    it('replaces a SQL dump on a returned 5xx', async () => {
        const err = Object.assign(new Error(SQL_DUMP), { status: 500 });
        const result: any = await putMeta(err);

        expect(result.response.status).toBe(500);
        expect(result.response.body.error.message).toBe('Internal server error');
        expect(String(result.response.body.error.message)).not.toContain('sys_team');
    });

    it('leaves a deliberate 4xx message intact even when it resembles SQL', async () => {
        // The tier that matters: `errorFromThrown` defaults `/meta` saves to
        // 400, and a validation message is the caller's answer — swallowing it
        // would be a worse bug than the leak.
        const err = Object.assign(new Error('unique constraint on name — pick another'), {
            status: 422,
        });
        const result: any = await putMeta(err);

        expect(result.response.status).toBe(422);
        expect(result.response.body.error.message).toBe('unique constraint on name — pick another');
    });

    it('leaves an ordinary 5xx message intact — only leaks are replaced', async () => {
        const err = Object.assign(new Error('metadata store is unavailable'), { status: 503 });
        const result: any = await putMeta(err);

        expect(result.response.status).toBe(503);
        expect(result.response.body.error.message).toBe('metadata store is unavailable');
    });

    it('preserves the structured code / issues while sanitising the message', async () => {
        // The semantic code and the per-field `issues` the UI maps back to inputs
        // are never free-form driver prose, so the 5xx guard must not touch them
        // — it only ever replaces `message`.
        // [#8087] Was `STORAGE_FAILURE` — a code the fixture invented, that no
        // producer emits and the ledger does not register, so the pinned body
        // could never satisfy `ApiErrorSchema`. `DATABASE_ERROR` is a
        // StandardErrorCode and is NOT what 500 derives (`INTERNAL_ERROR`), so
        // the assertion still distinguishes "promoted from the throw" from
        // "derived from the status". See dispatcher-error-vocabulary.ts.
        const err = Object.assign(new Error(SQL_DUMP), {
            status: 500,
            code: 'DATABASE_ERROR',
            issues: [{ path: 'name', message: 'taken', code: 'duplicate' }],
        });
        const result: any = await putMeta(err);

        expect(result.response.body.error.message).toBe('Internal server error');
        // [#3842] The code is in the declared field; `details` keeps the issues.
        expect(result.response.body.error.code).toBe('DATABASE_ERROR');
        expect(result.response.body.error.details).toMatchObject({
            issues: [{ path: 'name', message: 'taken', code: 'duplicate' }],
        });
    });
});
