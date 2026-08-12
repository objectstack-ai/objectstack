// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#3946] `POST /data/:object/query` spread the request body OVER
// `{ object: objectName }`, so a body `object` key moved the read to a
// different object than the URL named — the same shape #3933 fixed on the REST
// bulk routes, found by the follow-up sweep for that pattern.
//
// These run through the REAL `callData`, so they pin both halves at once: the
// object the ADR-0049 exposure gate consults and the object actually queried
// are the same one, and it is the one in the path.
//
// [#6719] The `DomainHandlerDeps` stand-in below used to HAND-WRITE its three
// error exits, and what they answered was not the ADR-0112 envelope:
//
//     error:           (message, code = 500) => ({ status: code, body: { error: message } })
//     routeNotFound:   (route)               => ({ status: 404, body: { route } })
//     errorFromThrown: (e)                   => ({ status: …,   body: { error: e?.message } })
//
// A bare string where production answers `{ success: false, error: { code,
// message, httpStatus, details? } }`. So every `/data` case driven through this
// harness was STRUCTURALLY incapable of going red on an envelope regression —
// a wrong `error.code`, a dropped `httpStatus`, an unpromoted `details.code`, a
// missing `success` — because none of those fields existed here to be wrong.
// The exits are now taken off a real dispatcher (see `realDomainDeps`), and the
// cases at the bottom of this file drive the two error branches `/data` owns.
//
// [#7362] The mirror-image half of the same gap, on the SUCCESS exit. The
// stand-in used to answer:
//
//     success: (data: any) => ({ status: 200, body: data })
//
// — the domain's return value handed straight back AS the whole body. No
// `success: true` flag, no `data` nesting, no `meta`, while production's
// `HttpDispatcher.success()` wraps all three:
// `{ status: 200, body: { success: true, data, meta } }`. `success` is now
// taken off the same real dispatcher as the error exits (`realDomainDeps`),
// and the `[#7362]` describe block below drives a real `/data` success path
// through it and reads the envelope off the response body — not a hand-built
// object — so a dropped `success`/`data`/`meta` can go red here too.

import { describe, it, expect, vi } from 'vitest';
import { ApiErrorSchema, BaseResponseSchema, envelopeViolations } from '@objectstack/spec/api';
import { handleDataRequest } from './data.js';
import { HttpDispatcher } from '../http-dispatcher.js';
import type { DomainHandlerDeps } from '../domain-handler-registry.js';

/**
 * [#6719] [#7362] The dispatcher's OWN `DomainHandlerDeps` success + error
 * exits — not a lookalike. `HttpDispatcher.domainDeps` is the exact object
 * every `/data` request runs against in production; it is borrowed off a real
 * dispatcher built over a kernel stub, exactly as
 * `error-envelope.conformance.test.ts`'s `makeDispatcher()` does (these
 * branches never reach a service).
 *
 * Deliberately NOT `apiErrorResponse({ … })` / `{ success: true, data }`
 * re-expressed here: `error()` also carries the #3867 5xx message-leak guard,
 * and a restatement would make these cases green against the restatement's
 * rules instead of production's — the same class of mistake as the
 * hand-written doubles this replaces.
 *
 * `routeNotFound` is unreachable from `handleDataRequest` today (the domain has
 * no route-resolution exit of its own) and `errorFromThrown` is applied one
 * layer up, by the dispatcher, to what this domain THROWS. Both are supplied
 * real anyway so a future `/data` branch is born conformant rather than
 * inheriting a stand-in.
 */
const realDomainDeps = (() => {
    const dispatcher: any = new HttpDispatcher({ context: { getService: () => null } } as any);
    const domainDeps: DomainHandlerDeps = dispatcher.domainDeps;
    return {
        success: domainDeps.success,
        error: domainDeps.error,
        routeNotFound: domainDeps.routeNotFound,
        errorFromThrown: domainDeps.errorFromThrown,
    };
})();

/**
 * [#6719] Every assertion a `/data` error body must satisfy, spelled once.
 *
 * The rules are IMPORTED from `packages/spec` (`BaseResponseSchema` /
 * `ApiErrorSchema` / `envelopeViolations`), never restated here — a local
 * restatement could drift from the schema it claims to check. The explicit
 * `httpStatus` line is load-bearing on top of the schemas: `ApiErrorSchema`
 * declares `httpStatus` OPTIONAL (a producer emitting only the semantic `code`
 * is conformant), so a dispatcher that dropped it would still parse clean. The
 * dispatcher stack promises to mirror it, and that promise is checked here.
 *
 * Sibling of `expectConformantError` in `error-envelope.conformance.test.ts`,
 * which is file-local to that suite; importing it would register that file's
 * `describe`s in this one.
 */
function expectDataErrorEnvelope(response: { status: number; body: any } | undefined) {
    expect(response, 'branch produced no response').toBeTruthy();
    const body = response!.body;

    expect(BaseResponseSchema.safeParse(body).success).toBe(true);
    expect(envelopeViolations(body), `not the declared envelope: ${JSON.stringify(body)}`).toEqual([]);
    expect(body.success).toBe(false);

    const parsed = ApiErrorSchema.safeParse(body.error);
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(parsed.success).toBe(true);

    // `code` is the semantic string, never the status; `httpStatus` is the number.
    expect(typeof body.error.code).toBe('string');
    expect(body.error.code).not.toBe(String(response!.status));
    expect(body.error.httpStatus).toBe(response!.status);

    // The parking spots #3842 emptied stay empty.
    expect(body.error.type).toBeUndefined();
    expect(body.error.details?.code).toBeUndefined();
    expect(body.error.details?.type).toBeUndefined();

    return body.error;
}

/**
 * [#7362] Every assertion a `/data` SUCCESS body must satisfy, spelled once —
 * the mirror of `expectDataErrorEnvelope` above. Production's
 * `HttpDispatcher.success()` wraps the domain's return value as
 * `{ success: true, data, meta }`. The OLD stand-in
 * (`success: (data) => ({ status: 200, body: data })`) handed that same
 * return value back AS the whole body, so none of these assertions were ever
 * true of a case driven through it — `envelopeViolations` alone catches the
 * missing `success` flag and the un-nested payload; the explicit `data` /
 * `meta` checks below are what pins the shape on top of that.
 */
function expectDataSuccessEnvelope(response: { status: number; body: any } | undefined) {
    expect(response, 'branch produced no response').toBeTruthy();
    const body = response!.body;

    expect(BaseResponseSchema.safeParse(body).success).toBe(true);
    expect(envelopeViolations(body), `not the declared envelope: ${JSON.stringify(body)}`).toEqual([]);
    expect(body.success).toBe(true);
    expect(body.data).toBeDefined();
    // Production's `success()` always writes the `meta` key — `{ success:
    // true, data, meta }` — even when the caller passed no second argument,
    // which every `/data` call site does (`deps.success(result)`, one arg).
    // The key is therefore present but `undefined`-valued here; the OLD
    // stand-in never had the key at all, since it returned the payload AS
    // the body rather than wrapping it.
    expect(Object.prototype.hasOwnProperty.call(body, 'meta')).toBe(true);

    return body.data;
}

/** Records what the protocol service was asked for. */
function setup(
    objectDefs: Record<string, any> = {},
    opts: { multiTenantHost?: boolean; engine?: any } = {},
) {
    const findData = vi.fn(async (req: any) => ({ object: req.object, records: [], total: 0 }));
    const protocol = { findData };
    const metadata = { getObject: async (name: string) => objectDefs[name] };
    const engine = opts.engine ?? null;
    const deps: any = {
        // [#5155] The request is the first argument of every kernel-reading
        // facility now; the fake takes it so a call site that forgot to pass
        // one cannot silently resolve the wrong slot name.
        resolveService: async (_ctx: any, name: string) =>
            name === 'protocol' ? protocol
            : name === 'metadata' ? metadata
            : name === 'objectql' ? engine
            : null,
        getService: () => null,
        getObjectQL: async () => engine,
        getRequestKernelService: async () => null,
        isMultiTenantHost: () => opts.multiTenantHost === true,
        // [#6719] [#7362] The REAL success + error exits — see `realDomainDeps`.
        ...realDomainDeps,
        resolveActiveOrganizationId: async () => undefined,
        announceKernelEvent: async () => {},
    };
    const context: any = { dataDriver: undefined, environmentId: undefined, executionContext: { userId: 'u1' } };
    return { deps, context, findData };
}

const post = (deps: any, context: any, path: string, body: any) =>
    handleDataRequest(deps, path, 'POST', body, {}, context);

describe('POST /data/:object/query binds to the object in the path (#3946)', () => {
    it('a body `object` cannot move the read to another object', async () => {
        const { deps, context, findData } = setup();
        const res = await post(deps, context, 'crm_account/query', {
            object: 'sys_user',
            where: { name: 'x' },
        });

        expect(res.handled).toBe(true);
        expect(findData).toHaveBeenCalledTimes(1);
        expect(findData.mock.calls[0][0].object).toBe('crm_account');
    });

    it('the exposure gate and the read agree on the path object', async () => {
        // `sys_user` is hidden from the API; `crm_account` is not. Pointing the
        // URL at the exposed object and naming the hidden one in the body must
        // not read the hidden one — and must not be refused on its behalf
        // either. Both decisions follow the path.
        const { deps, context, findData } = setup({
            crm_account: { apiEnabled: true },
            sys_user: { apiEnabled: false },
        });

        const res: any = await post(deps, context, 'crm_account/query', { object: 'sys_user' });
        expect(res.response.status).toBe(200);
        expect(findData.mock.calls[0][0].object).toBe('crm_account');

        // Addressed directly, the hidden object is still refused. The gate
        // THROWS a `{ statusCode }` shape; the dispatcher above turns it into
        // an envelope (`errorFromThrown`), so assert the throw here.
        await expect(post(deps, context, 'sys_user/query', {})).rejects.toMatchObject({ statusCode: 404 });
        expect(findData).toHaveBeenCalledTimes(1); // the refused call never read
    });

    it('still forwards the rest of the body as the query', async () => {
        const { deps, context, findData } = setup();
        await post(deps, context, 'crm_account/query', { where: { status: 'open' }, limit: 5 });

        const req = findData.mock.calls[0][0];
        expect(req.object).toBe('crm_account');
        expect(req.query).toMatchObject({ where: { status: 'open' }, limit: 5 });
    });

    it('still honours an explicit `query` envelope', async () => {
        const { deps, context, findData } = setup();
        await post(deps, context, 'crm_account/query', { query: { where: { status: 'open' } } });

        expect(findData.mock.calls[0][0].query).toEqual({ where: { status: 'open' } });
    });

    it('threads the caller execution context through unchanged', async () => {
        const { deps, context, findData } = setup();
        await post(deps, context, 'crm_account/query', { context: { userId: 'root', isSystem: true } });

        expect(findData.mock.calls[0][0].context).toBe(context.executionContext);
    });
});

/**
 * [#6719] The cases the old harness could not host.
 *
 * `handleDataRequest` has exactly TWO error exits of its own — both
 * `deps.error(…)` — and the old stand-in answered both with a bare string, so
 * no case in this file ever read an error body. These do, through the real
 * exits, and each asserts the ADR-0112 triple (`success: false` + `error.code`
 * + `error.httpStatus`) rather than status-and-message.
 *
 * The domain's other failure mode is a THROW (the ADR-0049 exposure gate, a
 * record miss). `handleDataRequest` does not catch it — the dispatcher above
 * maps it with `errorFromThrown`, which is why the two throw cases apply that
 * same real method at the boundary instead of pretending the domain returns
 * there.
 */
describe('[#6719] /data error exits answer in the ADR-0112 envelope', () => {
    it('a missing object name is refused in the declared envelope (400)', async () => {
        const { deps, context } = setup();
        const res: any = await handleDataRequest(deps, '', 'GET', undefined, {}, context);

        expect(res.handled).toBe(true);
        expect(res.response.status).toBe(400);
        const error = expectDataErrorEnvelope(res.response);
        expect(error.code).toBe('VALIDATION_ERROR');
        expect(error.message).toBe('Object name required');
    });

    it('an unresolved environment on a multi-tenant host is refused in the declared envelope (428)', async () => {
        // The one `/data` branch with a status outside the common set — 428 is
        // in the spec's status→code map, so `error.code` is the precondition
        // code and not the generic 4xx bucket.
        const { deps, context } = setup({}, { multiTenantHost: true });
        const res: any = await handleDataRequest(deps, 'crm_account', 'GET', undefined, {}, context);

        expect(res.handled).toBe(true);
        expect(res.response.status).toBe(428);
        const error = expectDataErrorEnvelope(res.response);
        expect(error.code).toBe('PRECONDITION_REQUIRED');
        expect(error.message).toMatch(/^Project not resolved\./);
    });

    it("the exposure gate's throw reaches the wire as a conformant 404", async () => {
        const { deps, context } = setup({ sys_user: { apiEnabled: false } });

        const thrown = await post(deps, context, 'sys_user/query', {}).then(
            () => undefined,
            (e: any) => e,
        );
        expect(thrown).toMatchObject({ statusCode: 404 });

        const response = deps.errorFromThrown(thrown);
        expect(response.status).toBe(404);
        const error = expectDataErrorEnvelope(response);
        expect(error.code).toBe('RESOURCE_NOT_FOUND');
    });

    it('a record miss keeps its OWN code — promoted into `error.code`, not derived from the status', async () => {
        // The promotion rule, driven by a real `/data` throw: the ObjectQL
        // fallback's miss carries `.code = 'RECORD_NOT_FOUND'`, which
        // `errorFromThrown` passes as `details.code` for `buildApiError` to
        // lift into the declared field. Leave it unpromoted and `error.code`
        // silently degrades to the status-derived `RESOURCE_NOT_FOUND` while
        // the real code hides in `details` — exactly the drift #3842 closed.
        const engine = { find: vi.fn(async () => []) };
        const { deps, context } = setup({}, { engine });

        const thrown = await handleDataRequest(deps, 'crm_account/rec_missing', 'GET', undefined, {}, context).then(
            () => undefined,
            (e: any) => e,
        );
        expect(thrown?.code).toBe('RECORD_NOT_FOUND');

        const response = deps.errorFromThrown(thrown);
        expect(response.status).toBe(404);
        const error = expectDataErrorEnvelope(response);
        expect(error.code).toBe('RECORD_NOT_FOUND');
        // The code was LIFTED, not copied: nothing else was in `details`, so
        // `details` disappears rather than lingering as `{}`.
        expect(error.details).toBeUndefined();
    });
});

/**
 * [#7362] The mirror-image half of the #6719 error-exit convergence: `/data`'s
 * SUCCESS exit, driven through a real `/data` success path (not a hand-built
 * object), reading the envelope off the actual response body.
 *
 * Every existing case above asserts through `findData`'s call arguments, not
 * the response body — none of them would flip if the success exit regressed.
 * These do: `expectDataSuccessEnvelope` reads the exact fields the old
 * stand-in dropped (`success: true`, the `data` nesting, the `meta` key) off
 * a response `handleDataRequest` actually produced.
 */
describe('[#7362] /data success exit answers in the production envelope', () => {
    it('a real query success is wrapped in success/data/meta, not returned bare', async () => {
        const { deps, context, findData } = setup({ crm_account: { apiEnabled: true } });
        const res: any = await post(deps, context, 'crm_account/query', { where: { status: 'open' } });

        expect(res.handled).toBe(true);
        expect(res.response.status).toBe(200);
        const data = expectDataSuccessEnvelope(res.response);

        // The domain's return value is NESTED under `data` — not spread as
        // the whole body, which is what the old stand-in produced.
        expect(data).toEqual({ object: 'crm_account', records: [], total: 0 });
        expect((res.response.body as any).object).toBeUndefined();
        expect((res.response.body as any).records).toBeUndefined();
        expect(findData).toHaveBeenCalledTimes(1);
    });

    it('a create success (201) still answers in the envelope, status override included', async () => {
        // Distinct call site from every other branch: `domains/data.ts`
        // mutates the ALREADY-WRAPPED response's `status` to 201 rather than
        // building a fresh one — pin that the envelope survives the mutation.
        // The fake `protocol` only implements `findData`, so this goes
        // through the ObjectQL fallback (`ql.insert`), same pattern as the
        // record-miss case above (`setup({}, { engine })`).
        const engine = { insert: vi.fn(async (_object: string, data: any) => ({ id: 'rec_1', ...data })) };
        const { deps, context } = setup({ crm_account: { apiEnabled: true } }, { engine });
        const res: any = await handleDataRequest(deps, 'crm_account', 'POST', { name: 'Acme' }, {}, context);

        expect(res.handled).toBe(true);
        expect(res.response.status).toBe(201);
        const data = expectDataSuccessEnvelope(res.response);

        expect(data).toEqual({ object: 'crm_account', id: 'rec_1', record: { name: 'Acme', id: 'rec_1' } });
        expect(engine.insert).toHaveBeenCalledTimes(1);
    });
});
