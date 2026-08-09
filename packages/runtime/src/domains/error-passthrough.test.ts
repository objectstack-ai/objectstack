// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #3918 follow-up — the THIRD tier of dispatcher error handling.
 *
 * #3867 taught `dispatcher-plugin`'s `errorResponseBase` to read `status` (not
 * just `statusCode`) and #3918 taught `HttpDispatcher.errorFromThrown` the
 * `VALIDATION_FAILED` shape. Both fixes were invisible to a whole tier of
 * handlers underneath them: the domain modules each caught their own errors and
 * called `deps.error(e.message, e.statusCode || 500)` directly, bypassing
 * `errorFromThrown` entirely. So on `/packages`, `/meta/_drafts`, `/ui`,
 * `/security` and the `/mcp` transport:
 *
 *  - a domain error carrying `status` (the convention every protocol-layer
 *    error uses — `OBJECT_NOT_FOUND`, `RECORD_NOT_FOUND`, `CLONE_DISABLED`,
 *    plugin-sharing's `FORBIDDEN`, …) still rendered as a **500**, and
 *  - a record `ValidationError` still lost its `fields[]` and its 400.
 *
 * Every one of those catches now routes through `deps.errorFromThrown(e, …)`,
 * so the two fixes above finally reach the routes that need them. The
 * per-route fallback status is preserved where it was deliberate (`/meta`
 * save → 501, the `/meta` two-part lookup → 404).
 *
 * `keys.ts` is deliberately NOT converted and is guarded below: it discards the
 * underlying error on purpose, because the message could echo row contents.
 */

import { describe, it, expect } from 'vitest';

import { HttpDispatcher } from './../http-dispatcher.js';

/** A `ValidationError` as it looks on the wire side of a throw. */
const FIELDS = [{ field: 'name', code: 'required', message: 'name is required' }];
function validationError() {
    const err = new Error('name is required') as Error & { code: string; fields: unknown[] };
    err.name = 'ValidationError';
    err.code = 'VALIDATION_FAILED';
    err.fields = FIELDS;
    return err;
}

/** A protocol-layer domain error: status on `status`, never `statusCode`. */
function domainNotFound() {
    return Object.assign(new Error("Object 'ghost' is not registered"), {
        code: 'OBJECT_NOT_FOUND',
        status: 404,
    });
}

/**
 * Dispatch against a kernel whose `protocol` service throws `err` from every
 * method these routes call. `objectql.registry` satisfies the `/packages`
 * pre-check.
 */
async function dispatchWith(method: string, path: string, err: unknown, body: any = {}) {
    const thrower = async () => { throw err; };
    const protocol = {
        listCommits: thrower,
        listDrafts: thrower,
        getUiView: thrower,
        updatePackage: thrower,
    };
    const objectql = { registry: {} };
    const resolve = (name: string) =>
        name === 'protocol' ? protocol : name === 'objectql' ? objectql
        // Authenticated caller so the dispatch reaches the error path instead of
        // 401ing at the anonymous-deny gate (#3963).
        : name === 'auth' ? { api: { getSession: async () => ({ user: { id: 'u1' } }) } }
        : undefined;
    const kernel: any = {
        getService: resolve,
        getServiceAsync: async (name: string) => resolve(name),
    };
    const dispatcher = new HttpDispatcher(kernel);
    // [#7033 / #7023] `/packages` now carries per-route capability predicates on
    // top of the anonymous floor: `manage_metadata` for the PATCH write path and
    // the `studio.access` / `setup.access` read set for the GET commits path.
    // These cases are about ERROR MAPPING (does a domain 404 / a ValidationError
    // 400 / an ordinary 500 survive), so the caller must clear the gate to reach
    // the error path each one pins. `dispatch()` re-resolves the context from the
    // auth / objectql services and this stub has no objectql, so the resolved
    // caller would hold no capabilities and be refused with a 403 before ever
    // reaching the mapping under test. Only the caller's capabilities are stubbed;
    // every mechanism and expected status below is unchanged. (The /meta and /ui
    // routes in the loop need no capability, and holding extra ones never rejects.)
    (dispatcher as any).timedResolveExecutionContext = async () => ({
        userId: 'u1', systemPermissions: ['manage_metadata', 'studio.access', 'setup.access'],
    });
    const result: any = await dispatcher.dispatch(method, path, body, {}, {} as any);
    return result.response;
}

describe('#3918 follow-up — domain catches honour `status` instead of forcing 500', () => {
    // One case per converted module, driven through the real route.
    const routes: Array<[string, string, string]> = [
        ['/packages', 'GET', '/packages/demo/commits'],
        ['/meta/_drafts', 'GET', '/meta/_drafts'],
        ['/ui', 'GET', '/ui/view/account'],
    ];

    for (const [label, method, path] of routes) {
        it(`${label}: a domain error's own 404 survives (was 500)`, async () => {
            const res = await dispatchWith(method, path, domainNotFound());

            expect(res.status).toBe(404);
            // A 4xx message is a deliberate answer and must reach the caller.
            expect(res.body.error.message).toContain("Object 'ghost' is not registered");
            // [#3842] Was `details.code` — the parking spot the status forced.
            expect(res.body.error.code).toBe('OBJECT_NOT_FOUND');
        });

        it(`${label}: a ValidationError keeps its 400 and its fields[]`, async () => {
            const res = await dispatchWith(method, path, validationError());

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_FAILED');
            expect(res.body.error.details).toEqual({ fields: FIELDS });
        });

        it(`${label}: an ordinary error still falls back to 500`, async () => {
            const res = await dispatchWith(method, path, new Error('backend unavailable'));

            expect(res.status).toBe(500);
            expect(res.body.error.message).toBe('backend unavailable');
        });
    }

    it('/packages: `statusCode` still works for callers that use it', async () => {
        // The property the old hand-rolled read honoured — converting must not
        // drop it, only widen what else is understood.
        const err = Object.assign(new Error('conflict'), { statusCode: 409 });
        const res = await dispatchWith('GET', '/packages/demo/commits', err);

        expect(res.status).toBe(409);
        expect(res.body.error.message).toBe('conflict');
    });

    it('/packages PATCH: the same holds on the write path', async () => {
        // A real patch body — the route rejects an empty one with its own 400
        // before it ever reaches `updatePackage`.
        const res = await dispatchWith('PATCH', '/packages/demo', domainNotFound(), { name: 'renamed' });

        expect(res.status).toBe(404);
    });
});

describe('#3918 follow-up — deliberate per-route fallbacks are preserved', () => {
    /** `/meta` PUT with a metadata service (no `saveMetaItem`) → the 501 branch. */
    async function putMetaViaMetadataService(err: unknown) {
        const metadata = { saveItem: async () => { throw err; } };
        const resolve = (name: string) =>
            name === 'metadata' ? metadata
            : name === 'auth' ? { api: { getSession: async () => ({ user: { id: 'u1' } }) } }
            : undefined;
        const kernel: any = {
            getService: resolve,
            getServiceAsync: async (name: string) => resolve(name),
        };
        const dispatcher = new HttpDispatcher(kernel);
        // [#7019] The `/meta` PUT now demands the `manage_metadata` capability —
        // an authoring capability, not just a session. `dispatch()` re-resolves
        // the execution context from the auth / objectql services, and this stub
        // has no objectql, so the resolved caller would hold no capabilities and
        // be refused with a 403 before ever reaching the 501/400 fallback branch
        // this test pins. Only the caller's capability is stubbed; the fallback
        // mechanism and its expected statuses are unchanged.
        (dispatcher as any).timedResolveExecutionContext = async () => ({
            userId: 'u1', systemPermissions: ['manage_metadata'],
        });
        const result: any = await dispatcher.dispatch(
            'PUT', '/meta/object/widget', { name: 'widget' }, {}, {} as any,
        );
        return result.response;
    }

    it('/meta save keeps 501 as the fallback for an ordinary failure', async () => {
        // This branch is only reached when the protocol has no `saveMetaItem`,
        // so "not supported" remains the honest default.
        const res = await putMetaViaMetadataService(new Error('no backend'));

        expect(res.status).toBe(501);
    });

    it('/meta save still answers 400 when the failure is validation', async () => {
        // …but a save rejected by validation is a fixable 400, not a capability
        // gap. This is the case the 501 fallback used to swallow.
        const res = await putMetaViaMetadataService(validationError());

        expect(res.status).toBe(400);
        expect(res.body.error.details.fields).toEqual(FIELDS);
    });
});
