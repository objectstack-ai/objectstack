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
    const kernel: any = {
        getService: (name: string) => (name === 'protocol' ? protocol : undefined),
        getServiceAsync: async (name: string) => (name === 'protocol' ? protocol : undefined),
    };
    return new HttpDispatcher(kernel);
}

async function putMeta(saveError: unknown) {
    const dispatcher = makeDispatcher(saveError);
    return dispatcher.dispatch(
        'PUT',
        '/meta/object/widget',
        { name: 'widget' },
        {},
        {} as any,
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

    it('preserves structured `details` (code / issues) while sanitising the message', async () => {
        // `details` carries the semantic code and per-field `issues` the UI maps
        // back to inputs; it is never free-form driver prose, so the guard must
        // not touch it.
        const err = Object.assign(new Error(SQL_DUMP), {
            status: 500,
            code: 'STORAGE_FAILURE',
            issues: [{ path: 'name', message: 'taken', code: 'duplicate' }],
        });
        const result: any = await putMeta(err);

        expect(result.response.body.error.message).toBe('Internal server error');
        expect(result.response.body.error.details).toMatchObject({
            code: 'STORAGE_FAILURE',
            issues: [{ path: 'name', message: 'taken', code: 'duplicate' }],
        });
    });
});
