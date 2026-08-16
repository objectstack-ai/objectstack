// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #3918 — the runtime dispatcher's two error exits vs. `ValidationError`.
 *
 * `ValidationError` (objectql's record/rule validators) carries
 * `.code = 'VALIDATION_FAILED'` and `.fields[]`, and deliberately carries no
 * `.status` / `.statusCode` and no `.issues`. `@objectstack/rest` maps it to a
 * 400 with `fields[]` (`mapDataError`); both dispatcher exits used to do
 * neither, because each read exactly the properties this error lacks:
 *
 *  - `HttpDispatcher.errorFromThrown` — no `.status` → fell back to the
 *    caller's `fallbackStatus` (500 on `/packages` publish), and built
 *    `details` from `.issues` only, so `fields[]` was dropped.
 *  - `dispatcher-plugin`'s `errorResponseBase` — same 500 fallback, and a body
 *    of only `{message, code}`. Worse, landing on 5xx dragged the message
 *    through the #3867 leak sanitiser, so a bad email address came back as a
 *    500 "Internal server error" with nothing to attach to the input.
 *
 * Both exits are private/module-local, so these drive them the way real
 * traffic does: `errorFromThrown` through `dispatch()` on a route whose
 * service throws, `errorResponseBase` through the real route handler the
 * plugin registers.
 *
 * The fixture below is structurally identical to a real `ValidationError` —
 * same `name`, same `code`, same `.fields[]`, and no status — but hand-built so
 * this package's tests take no dependency on objectql.
 */

import { describe, it, expect } from 'vitest';

import { HttpDispatcher } from './http-dispatcher.js';
import { createDispatcherPlugin } from './dispatcher-plugin.js';

const FIELDS = [
    { field: 'email', code: 'invalid_email', message: 'email must be a valid email address' },
    { field: 'name', code: 'required', message: 'name is required' },
];

/** What `new ValidationError(FIELDS)` looks like on the wire side of a throw. */
function makeValidationError() {
    const err = new Error(
        'email must be a valid email address; name is required',
    ) as Error & { code: string; fields: unknown[] };
    err.name = 'ValidationError';
    err.code = 'VALIDATION_FAILED';
    err.fields = FIELDS;
    return err;
}

// ---------------------------------------------------------------------------
// Exit 1 — HttpDispatcher.errorFromThrown (the RETURNED error path)
// ---------------------------------------------------------------------------

/**
 * `POST /packages/:id/publish-drafts` catches and returns
 * `errorFromThrown(e, 500)` — the 500-fallback caller, i.e. the one where the
 * missing `.status` actually cost a status downgrade. (`/meta` saves pass
 * `400`, so they masked the downgrade while still dropping `fields[]`.)
 */
function makeDispatcher(publishError: unknown) {
    const protocol = {
        publishPackageDrafts: async () => { throw publishError; },
    };
    // The route's 503 pre-check: it needs an objectql service with a registry
    // before it will reach the protocol call at all.
    const objectql = { registry: {} };
    const resolve = (name: string) =>
        name === 'protocol' ? protocol : name === 'objectql' ? objectql : undefined;
    const kernel: any = {
        getService: resolve,
        getServiceAsync: async (name: string) => resolve(name),
    };
    const dispatcher = new HttpDispatcher(kernel);
    // [#7033 / #7023] `POST /packages/:id/publish-drafts` now demands the
    // `manage_metadata` capability on top of the anonymous floor. These cases
    // are about ERROR MAPPING (a returned VALIDATION_FAILED becomes a 400 with
    // fields[], an ordinary throw keeps its 500), so the caller must clear the
    // write gate to reach the mapping under test — otherwise every case stops at
    // the 401/403 gate. `dispatch()` re-resolves the context and this stub has no
    // auth/objectql identity source, so the resolved caller carries no
    // capabilities; only that is stubbed, the mapping and expected statuses are
    // unchanged.
    (dispatcher as any).timedResolveExecutionContext = async () => ({
        userId: 'u1', systemPermissions: ['manage_metadata'],
    });
    return dispatcher;
}

async function publishPackage(publishError: unknown) {
    const dispatcher = makeDispatcher(publishError);
    const result: any = await dispatcher.dispatch(
        'POST',
        '/packages/demo/publish-drafts',
        {},
        {},
        {} as any,
    );
    return result.response;
}

describe('#3918 — HttpDispatcher.errorFromThrown maps VALIDATION_FAILED', () => {
    it('answers 400, not the caller\'s 500 fallback', async () => {
        const res = await publishPackage(makeValidationError());

        expect(res.status).toBe(400);
        expect(res.body.error.httpStatus).toBe(400);
    });

    it('reports VALIDATION_FAILED in `error.code` (#3842)', async () => {
        // Was `details.code`, because `error.code` held the status. The string
        // is unchanged — this moved the field, not the vocabulary.
        const res = await publishPackage(makeValidationError());

        expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('passes `fields[]` through in `details` so the UI can anchor each error', async () => {
        const res = await publishPackage(makeValidationError());

        expect(res.body.error.details).toEqual({ fields: FIELDS });
    });

    it('keeps the human message intact (400 never reaches the 5xx sanitiser)', async () => {
        const res = await publishPackage(makeValidationError());

        expect(res.body.error.message).toBe('email must be a valid email address; name is required');
    });

    it('recognises the shape by `code` alone, for hand-thrown validation errors', async () => {
        // A hook or service that throws `{ code: 'VALIDATION_FAILED', fields }`
        // without extending ValidationError must be served identically — the
        // same both-ways predicate `mapDataError` uses.
        const err = Object.assign(new Error('quantity must be at least 1'), {
            code: 'VALIDATION_FAILED',
            fields: [{ field: 'quantity', code: 'min_value', message: 'quantity must be at least 1' }],
        });
        const res = await publishPackage(err);

        expect(res.status).toBe(400);
        expect(res.body.error.details.fields).toEqual(err.fields);
    });

    it('pins `error.code` to VALIDATION_FAILED when matched by `name` alone', async () => {
        const err = new Error('name is required');
        err.name = 'ValidationError';
        (err as any).fields = [{ field: 'name', code: 'required', message: 'name is required' }];
        const res = await publishPackage(err);

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('defaults `fields` to [] when the error carries none', async () => {
        // `details.fields` is the contract; a caller mapping it must never have
        // to guard for `undefined`.
        const err = Object.assign(new Error('invalid'), { code: 'VALIDATION_FAILED' });
        const res = await publishPackage(err);

        expect(res.status).toBe(400);
        expect(res.body.error.details.fields).toEqual([]);
    });

    it('still lets an explicit `status` win — 400 is only the fallback', async () => {
        const err = Object.assign(makeValidationError(), { status: 422 });
        const res = await publishPackage(err);

        expect(res.status).toBe(422);
        expect(res.body.error.details.fields).toEqual(FIELDS);
    });

    it('leaves a non-validation error on its old path', async () => {
        // Anti-regression for the #3867 tier this sits next to: an ordinary
        // throw still takes the caller's 500 fallback and its `issues`/`code`
        // details shape.
        // [#8087] The vehicle was `STORAGE_FAILURE`, which no producer in this
        // repo emits — the fixture invented it — and which the ledger therefore
        // does not register, so this pin asserted a body `ApiErrorSchema`
        // rejects. Collapsed to `DATABASE_ERROR`, a StandardErrorCode: the
        // producer here is `metadata-protocol`, whose vocabulary IS
        // ledger-governed, so an unregistered string was a fixture bug rather
        // than a wire value worth keeping.
        //
        // Deliberately NOT the status-derived code: 500 derives `INTERNAL_ERROR`
        // (`standardErrorCodeForHttpStatus`), so using it would make the
        // assertion below pass whether the code was promoted or merely derived
        // — a green test over nothing. `DATABASE_ERROR` is registered AND
        // distinct from the derived one, so the pin still proves what it was
        // written to prove: the producer's own code wins.
        const err = Object.assign(new Error('publish backend unavailable'), {
            code: 'DATABASE_ERROR',
            issues: [{ path: 'a', message: 'b', code: 'c' }],
        });
        const res = await publishPackage(err);

        expect(res.status).toBe(500);
        // [#3842] the error's own code reaches the declared field instead of
        // `details`; `issues` stays context.
        expect(res.body.error.code).toBe('DATABASE_ERROR');
        expect(res.body.error.details).toEqual({
            issues: [{ path: 'a', message: 'b', code: 'c' }],
        });
        expect(res.body.error.details.fields).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// Exit 2 — dispatcher-plugin's errorResponseBase (the THROWN error path)
// ---------------------------------------------------------------------------

function makeFakeServer() {
    const handlers: Record<string, (req: any, res: any) => any> = {};
    const rec = (verb: string) => (path: string, handler: any) => {
        handlers[`${verb} ${path}`] = handler;
    };
    return {
        handlers,
        server: {
            get: rec('GET'),
            post: rec('POST'),
            put: rec('PUT'),
            delete: rec('DELETE'),
            patch: rec('PATCH'),
        },
    };
}

function makeCtx(fakeServer: any, analyticsError: unknown) {
    const analytics = {
        query: async () => { throw analyticsError; },
        getMeta: async () => ({ cubes: [] }),
        generateSql: async () => ({ sql: null }),
    };
    const kernel = {
        getService: (name: string) => (name === 'analytics' ? analytics : undefined),
        getServiceAsync: async (name: string) => (name === 'analytics' ? analytics : undefined),
    };
    return {
        getKernel: () => kernel,
        getService: (name: string) => (name === 'http.server' ? fakeServer : undefined),
        environmentId: undefined,
        logger: { info() {}, warn() {}, error() {}, debug() {} },
        hook: () => {},
        on: () => {},
    } as any;
}

function makeRes() {
    const res: any = {
        statusCode: undefined as number | undefined,
        body: undefined as any,
        status(c: number) { res.statusCode = c; return res; },
        header() { return res; },
        json(b: any) { res.body = b; return res; },
    };
    return res;
}

/** Drive `POST /analytics/query` with a service that throws `err`. */
async function postAnalyticsQuery(err: unknown) {
    const { server, handlers } = makeFakeServer();
    const plugin = createDispatcherPlugin({ prefix: '/api/v1', securityHeaders: false });
    await plugin.start?.(makeCtx(server, err));

    const handler = handlers['POST /api/v1/analytics/query'];
    expect(handler, 'POST /api/v1/analytics/query must be mounted').toBeTypeOf('function');

    const res = makeRes();
    // [#3878] Body must pass entry validation so the SERVICE's thrown error —
    // the thing under test — is what reaches the exit, not an entry 400.
    await handler({ body: { cube: 'x', measures: ['count'] }, query: {} }, res);
    return res;
}

describe('#3918 — dispatcher-plugin errorResponseBase maps VALIDATION_FAILED', () => {
    it('answers 400 instead of 500', async () => {
        const res = await postAnalyticsQuery(makeValidationError());

        expect(res.statusCode).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error.httpStatus).toBe(400);
    });

    it('reports VALIDATION_FAILED in `error.code` — same as the returned exit (#3842)', async () => {
        // This exit used to drop a thrown error's code entirely: `errorResponseBase`
        // never read `err.code`, because the field it would have gone in held the
        // status. The two exits of the same surface now agree.
        const res = await postAnalyticsQuery(makeValidationError());

        expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('carries `fields[]` — the body used to be `{message, code}` only', async () => {
        const res = await postAnalyticsQuery(makeValidationError());

        expect(res.body.error.details).toEqual({ fields: FIELDS });
    });

    it('keeps the human message — the 500 fallback used to replace it', async () => {
        // The regression that motivated the issue: on 5xx the #3867 sanitiser
        // swaps the message for INTERNAL_ERROR_MESSAGE, so a user-input mistake
        // was served as a generic "internal error".
        const res = await postAnalyticsQuery(makeValidationError());

        expect(res.body.error.message).toBe('email must be a valid email address; name is required');
        expect(res.body.error.message).not.toBe('Internal server error');
    });

    it('does not record a validation failure as a server fault', async () => {
        // `__obsRecordedError` feeds errorReporter and is set on 5xx only. A bad
        // payload is not an incident — at 400 the side-channel stays clear.
        const res = await postAnalyticsQuery(makeValidationError());

        expect((res as any).__obsRecordedError).toBeUndefined();
    });

    it('still lets an explicit `status` win', async () => {
        const res = await postAnalyticsQuery(Object.assign(makeValidationError(), { status: 422 }));

        expect(res.statusCode).toBe(422);
        expect(res.body.error.details.fields).toEqual(FIELDS);
    });

    it('gives a codeless error the derived code and nothing else', async () => {
        // Was `{ message, code: 500 }` exactly. A plain `Error` carries no
        // semantic code, so #3842 derives one from the status; `details` stays
        // absent rather than becoming an empty object.
        const res = await postAnalyticsQuery(new Error('analytics engine unavailable'));

        expect(res.statusCode).toBe(500);
        expect(res.body.error).toEqual({
            code: 'INTERNAL_ERROR',
            message: 'analytics engine unavailable',
            httpStatus: 500,
        });
    });
});

// ---------------------------------------------------------------------------
// Parity with the surface that already got this right
// ---------------------------------------------------------------------------

describe('#3918 — both dispatcher exits agree with @objectstack/rest', () => {
    it('serves the same status and the same `fields[]` from either exit', async () => {
        const returned = await publishPackage(makeValidationError());
        const thrown = await postAnalyticsQuery(makeValidationError());

        // `mapDataError` answers 400 with `fields` = the error's `.fields`.
        expect(returned.status).toBe(400);
        expect(thrown.statusCode).toBe(400);
        expect(returned.body.error.details.fields).toEqual(FIELDS);
        expect(thrown.body.error.details.fields).toEqual(FIELDS);
    });
});
