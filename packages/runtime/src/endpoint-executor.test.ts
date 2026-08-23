// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Execution-target delegation in isolation (#5040 E5 / #5092).
 *
 * The suite is organised around the ONE claim the module makes: a declared
 * endpoint delegates to an EXISTING pipeline, with the arguments that pipeline
 * already receives on its built-in route. So most cases here assert the exact
 * delegated call — `callData('query', { object, query }, driver, env, ec)` and
 * friends — rather than the response, because a drifting argument is how the
 * "same pipeline" claim would quietly stop being true while every response
 * assertion stayed green.
 *
 * Nothing is resolved inside the module, so everything is a stub: the `callData`
 * binding and the `automation` slot occupant arrive as arguments.
 */

import { describe, it, expect, vi } from 'vitest';
import { ApiEndpointSchema, ApiErrorSchema, BaseResponseSchema, DispatcherErrorCode, envelopeViolations, SERVICE_SELF_INFO_KEY } from '@objectstack/spec/api';
import type { ApiEndpoint } from '@objectstack/spec/api';
import type { ApiEndpointMatch } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { serviceUnavailableMessage } from '@objectstack/spec/system';
import { INTERNAL_ERROR_MESSAGE } from '@objectstack/types';

import {
    buildEndpointExecutionContext,
    endpointErrorAnswer,
    executeEndpointTarget,
    planEndpointTarget,
    type EndpointExecutionAnswer,
    type EndpointExecutionRequest,
    type EndpointExecutorDeps,
} from './endpoint-executor.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A declared endpoint in the ADR-0121 D1 shape, defaults materialized. */
function endpoint(overrides: Record<string, unknown>): ApiEndpoint {
    return ApiEndpointSchema.parse({
        name: 'showcase_tasks',
        path: '/api/v1/apps/showcase/tasks',
        method: 'GET',
        type: 'object_operation',
        target: 'showcase_task',
        objectParams: { object: 'showcase_task', operation: 'find' },
        ...overrides,
    });
}

const EC: ExecutionContext = {
    userId: 'user-1',
    positions: ['sales_rep'],
    permissions: ['task_edit'],
    tenantId: 'tenant-9',
} as ExecutionContext;

const DRIVER = { __driver: true };

function request(overrides: Partial<EndpointExecutionRequest> = {}): EndpointExecutionRequest {
    return {
        method: 'GET',
        path: '/api/v1/apps/showcase/tasks',
        query: {},
        headers: {},
        ...overrides,
    };
}

function contextFor(ep: ApiEndpoint, req: Partial<EndpointExecutionRequest> = {}) {
    const match: ApiEndpointMatch = { endpoint: ep, params: {} };
    return buildEndpointExecutionContext({
        request: request(req),
        match,
        executionContext: EC,
        environmentId: 'env-7',
        dataDriver: DRIVER,
    });
}

/** The same, for a request the dispatcher resolved no identity for. */
function anonymousContextFor(ep: ApiEndpoint, req: Partial<EndpointExecutionRequest> = {}) {
    return buildEndpointExecutionContext({
        request: request(req),
        match: { endpoint: ep, params: {} },
        environmentId: 'env-7',
        dataDriver: DRIVER,
    });
}

function depsWith(overrides: Partial<EndpointExecutorDeps> = {}): EndpointExecutorDeps & { callData: ReturnType<typeof vi.fn> } {
    const callData = vi.fn().mockResolvedValue({ ok: true });
    return { callData, ...overrides } as EndpointExecutorDeps & { callData: ReturnType<typeof vi.fn> };
}

/** Every error answer must be the declared envelope, whatever produced it. */
function expectConformantError(answer: EndpointExecutionAnswer) {
    const body: any = answer.body;
    expect(BaseResponseSchema.safeParse(body).success).toBe(true);
    expect(envelopeViolations(body), `not the declared envelope: ${JSON.stringify(body)}`).toEqual([]);
    expect(body.success).toBe(false);
    expect(ApiErrorSchema.safeParse(body.error).success).toBe(true);
    expect(typeof body.error.code).toBe('string');
    expect(body.error.code).not.toBe(String(answer.status));
    expect(body.error.httpStatus).toBe(answer.status);
    return body.error;
}

// ---------------------------------------------------------------------------
// Context construction
// ---------------------------------------------------------------------------

describe('buildEndpointExecutionContext — a projection, not an interpretation', () => {
    it('carries method/path/query/headers/body/remoteAddress through verbatim', () => {
        const ctx = contextFor(endpoint({}), {
            method: 'post',
            path: '/api/v1/apps/showcase/tasks',
            query: { status: 'open', tag: ['a', 'b'] },
            headers: { 'x-request-id': 'req-1', accept: 'application/json' },
            body: { title: 'write the executor' },
            remoteAddress: '203.0.113.9',
        });

        // Upper-cased, as every method comparison in this stack is.
        expect(ctx.method).toBe('POST');
        expect(ctx.path).toBe('/api/v1/apps/showcase/tasks');
        // Verbatim: normalising here would put a second, weaker copy of each
        // pipeline's own input handling in front of it.
        expect(ctx.query).toEqual({ status: 'open', tag: ['a', 'b'] });
        expect(ctx.headers).toEqual({ 'x-request-id': 'req-1', accept: 'application/json' });
        expect(ctx.body).toEqual({ title: 'write the executor' });
        expect(ctx.remoteAddress).toBe('203.0.113.9');
    });

    it('carries the match: the parsed endpoint, and `params` — always {} in 17.x', () => {
        const ep = endpoint({});
        const ctx = contextFor(ep);
        expect(ctx.endpoint).toBe(ep);
        // The vocabulary defines no path template syntax, so the matcher never
        // extracts anything. The member exists so adding templates later is
        // additive; the executor reads record ids from `query.id` instead.
        expect(ctx.params).toEqual({});
    });

    it('builds the HttpProtocolContext the existing domain handlers receive', () => {
        const req = request({ body: { a: 1 } });
        const ctx = buildEndpointExecutionContext({
            request: req,
            match: { endpoint: endpoint({}), params: {} },
            executionContext: EC,
            environmentId: 'env-7',
            dataDriver: DRIVER,
        });

        // `{ request: req }` — the raw request object, exactly as every
        // dispatcher-plugin route builds it.
        expect(ctx.protocolContext.request).toBe(req);
        expect(ctx.protocolContext.environmentId).toBe('env-7');
        expect(ctx.protocolContext.dataDriver).toBe(DRIVER);
        expect(ctx.protocolContext.executionContext).toBe(EC);
    });

    it('omits the identity envelope for an anonymous request rather than faking one', () => {
        const ctx = anonymousContextFor(endpoint({}));
        expect('executionContext' in ctx).toBe(false);
        expect('executionContext' in ctx.protocolContext).toBe(false);
    });

    it('defaults absent query/headers to empty objects, never undefined', () => {
        const ctx = buildEndpointExecutionContext({
            request: { method: 'GET', path: '/api/v1/apps/showcase/tasks' },
            match: { endpoint: endpoint({}), params: {} },
        });
        expect(ctx.query).toEqual({});
        expect(ctx.headers).toEqual({});
        expect(ctx.body).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// Target classification
// ---------------------------------------------------------------------------

describe('planEndpointTarget — the unsupported subset is enumerated once', () => {
    it('reads an object_operation declaration off objectParams', () => {
        expect(planEndpointTarget(endpoint({ objectParams: { object: 'task', operation: 'update' } })))
            .toEqual({ kind: 'object_operation', object: 'task', operation: 'update' });
    });

    it('reads a flow declaration off `target`', () => {
        expect(planEndpointTarget(endpoint({ type: 'flow', target: 'purge_inquiries', objectParams: undefined })))
            .toEqual({ kind: 'flow', flow: 'purge_inquiries' });
    });

    it.each<[string, Record<string, unknown>, string]>([
        ['object missing', { object: undefined, operation: 'find' }, 'objectParams.object'],
        ['operation missing', { object: 'task', operation: undefined }, 'objectParams.operation'],
    ])('refuses an incomplete object_operation (%s)', (_label, objectParams, expected) => {
        const plan = planEndpointTarget(endpoint({ objectParams }));
        expect(plan.kind).toBe('unsupported');
        expect((plan as any).reason).toContain(expected);
    });

    it.each(['script', 'proxy'])('refuses `%s` — declared by the vocabulary, not executed in 17.x', (type) => {
        const plan = planEndpointTarget(endpoint({ type, objectParams: undefined }));
        expect(plan.kind).toBe('unsupported');
        // The reason names the type so an author is not left guessing which of
        // their endpoints the runtime declined.
        expect((plan as any).reason).toContain(`'${type}'`);
        expect((plan as any).hint).toContain('#5040 §7-3');
    });
});

// ---------------------------------------------------------------------------
// object_operation delegation
// ---------------------------------------------------------------------------

describe('object_operation delegates to callData with the argument shape /data uses', () => {
    it('find → callData("query", { object, query }) with the request query verbatim', async () => {
        const deps = depsWith();
        deps.callData.mockResolvedValue({ object: 'showcase_task', records: [{ id: '1' }], total: 1 });
        const ctx = contextFor(endpoint({}), { query: { status: 'open', $top: '10' } });

        const answer = await executeEndpointTarget(ctx, deps);

        expect(deps.callData).toHaveBeenCalledTimes(1);
        expect(deps.callData).toHaveBeenCalledWith(
            'query',
            { object: 'showcase_task', query: { status: 'open', $top: '10' } },
            DRIVER,
            'env-7',
            EC,
        );
        // `domains/data.ts:119-120` answers `success(result)` — the FindDataResponse
        // as the protocol built it, not a reshaped copy of it.
        expect(answer).toEqual({ status: 200, body: { success: true, data: { object: 'showcase_task', records: [{ id: '1' }], total: 1 }, meta: undefined } });
    });

    it('get → callData("get", { object, id }) with id from `query.id`', async () => {
        const deps = depsWith();
        const ctx = contextFor(endpoint({ objectParams: { object: 'showcase_task', operation: 'get' } }), {
            query: { id: 'rec-1' },
        });

        await executeEndpointTarget(ctx, deps);

        expect(deps.callData).toHaveBeenCalledWith('get', { object: 'showcase_task', id: 'rec-1' }, DRIVER, 'env-7', EC);
    });

    it('get allowlists exactly select/expand and drops every other query param', async () => {
        const deps = depsWith();
        const ctx = contextFor(endpoint({ objectParams: { object: 'showcase_task', operation: 'get' } }), {
            // `filters` is the parameter-pollution case `domains/data.ts:80-85`
            // allowlists against — it must not reach the read.
            query: { id: 'rec-1', select: 'name', expand: 'owner', filters: '[["id","!=","rec-1"]]' },
        });

        await executeEndpointTarget(ctx, deps);

        expect(deps.callData).toHaveBeenCalledWith(
            'get',
            { object: 'showcase_task', id: 'rec-1', select: 'name', expand: 'owner' },
            DRIVER,
            'env-7',
            EC,
        );
    });

    it('create → callData("create", { object, data: body }) and answers 201 like POST /data/:object', async () => {
        const deps = depsWith();
        const ctx = contextFor(
            endpoint({ method: 'POST', objectParams: { object: 'showcase_task', operation: 'create' } }),
            { method: 'POST', body: { title: 'new' } },
        );

        const answer = await executeEndpointTarget(ctx, deps);

        expect(deps.callData).toHaveBeenCalledWith('create', { object: 'showcase_task', data: { title: 'new' } }, DRIVER, 'env-7', EC);
        expect(answer.status).toBe(201);
    });

    it('update → callData("update", { object, id, data: body })', async () => {
        const deps = depsWith();
        const ctx = contextFor(
            endpoint({ method: 'PATCH', objectParams: { object: 'showcase_task', operation: 'update' } }),
            { method: 'PATCH', query: { id: 'rec-1' }, body: { title: 'renamed' } },
        );

        const answer = await executeEndpointTarget(ctx, deps);

        expect(deps.callData).toHaveBeenCalledWith(
            'update',
            { object: 'showcase_task', id: 'rec-1', data: { title: 'renamed' } },
            DRIVER,
            'env-7',
            EC,
        );
        expect(answer.status).toBe(200);
    });

    it('delete → callData("delete", { object, id })', async () => {
        const deps = depsWith();
        const ctx = contextFor(
            endpoint({ method: 'DELETE', objectParams: { object: 'showcase_task', operation: 'delete' } }),
            { method: 'DELETE', query: { id: 'rec-1' } },
        );

        await executeEndpointTarget(ctx, deps);

        expect(deps.callData).toHaveBeenCalledWith('delete', { object: 'showcase_task', id: 'rec-1' }, DRIVER, 'env-7', EC);
    });

    it('takes `object` from the DECLARATION — a request cannot redirect the operation', async () => {
        const deps = depsWith();
        const ctx = contextFor(endpoint({}), {
            // The #3946 shape: a caller naming a different object. On `/data` the
            // body could once move the read; here the declaration is the only
            // source, so the request cannot reach the object at all.
            query: { object: 'sys_user' },
            body: { object: 'sys_user' },
        });

        await executeEndpointTarget(ctx, deps);

        const [, params] = deps.callData.mock.calls[0]!;
        expect(params.object).toBe('showcase_task');
    });

    it.each(['get', 'update', 'delete'] as const)(
        'refuses a %s endpoint with no `?id=` — 400 VALIDATION_FAILED with fields[], not a 500',
        async (operation) => {
            const deps = depsWith();
            const ctx = contextFor(endpoint({ objectParams: { object: 'showcase_task', operation } }));

            const answer = await executeEndpointTarget(ctx, deps);

            expect(deps.callData).not.toHaveBeenCalled();
            expect(answer.status).toBe(400);
            const error = expectConformantError(answer);
            expect(error.code).toBe('VALIDATION_FAILED');
            // `code` was PROMOTED into the declared field by the shared builder,
            // so `details` carries genuine context only — the per-field envelope
            // a UI maps back onto the form.
            expect(error.details).toEqual({
                fields: [{ field: 'id', code: 'required', message: expect.any(String) }],
            });
        },
    );

    it('rejects a repeated `?id=` rather than silently taking one of them', async () => {
        const deps = depsWith();
        const ctx = contextFor(endpoint({ objectParams: { object: 'showcase_task', operation: 'get' } }), {
            query: { id: ['rec-1', 'rec-2'] },
        });

        const answer = await executeEndpointTarget(ctx, deps);

        expect(deps.callData).not.toHaveBeenCalled();
        expect(answer.status).toBe(400);
    });

    it.each(['find', 'get', 'create', 'update', 'delete'] as const)(
        'forwards the identity envelope on %s — the #5040 §4 red line',
        async (operation) => {
            const deps = depsWith();
            const ctx = contextFor(endpoint({ objectParams: { object: 'showcase_task', operation } }), {
                query: { id: 'rec-1' },
                body: {},
            });

            await executeEndpointTarget(ctx, deps);

            // The dead `handleApiEndpoint` code removed in #4936 dropped this
            // argument, which would have read as a system principal with RLS
            // bypassed had it ever run.
            const [, , driver, scope, ec] = deps.callData.mock.calls[0]!;
            expect(driver).toBe(DRIVER);
            expect(scope).toBe('env-7');
            expect(ec).toBe(EC);
        },
    );

    it('forwards `undefined` identity for an anonymous request — never a substitute', async () => {
        const deps = depsWith();
        const ctx = anonymousContextFor(endpoint({}));

        await executeEndpointTarget(ctx, deps);

        expect(deps.callData.mock.calls[0]![4]).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// flow delegation
// ---------------------------------------------------------------------------

describe('flow delegates to IAutomationService.execute with the trigger route’s own context', () => {
    const FLOW = () => endpoint({ type: 'flow', target: 'purge_inquiries', method: 'POST', objectParams: undefined });

    it('calls execute(target, buildAutomationContext(body, ctx)) and answers like the trigger route', async () => {
        const execute = vi.fn().mockResolvedValue({ success: true, runId: 'run-1' });
        const deps = depsWith({ automationService: { execute } });
        const ctx = contextFor(FLOW(), {
            method: 'POST',
            body: { recordId: 'rec-1', objectName: 'showcase_inquiry', params: { reason: 'spam' } },
        });

        const answer = await executeEndpointTarget(ctx, deps);

        expect(execute).toHaveBeenCalledTimes(1);
        const [flowName, automationContext] = execute.mock.calls[0]!;
        expect(flowName).toBe('purge_inquiries');
        // The `{recordId, objectName, params}` translation flow variables resolve
        // from, plus the `<object>Id` alias — none of it re-implemented here.
        expect(automationContext).toEqual({
            params: { reason: 'spam', recordId: 'rec-1', showcaseInquiryId: 'rec-1' },
            object: 'showcase_inquiry',
            event: 'manual',
            // The FULLY-RESOLVED identity envelope: without it a `runAs:'user'`
            // flow's data operations are refused fail-closed (#3760) or run as
            // somebody else (#1888).
            userId: 'user-1',
            positions: ['sales_rep'],
            permissions: ['task_edit'],
            tenantId: 'tenant-9',
        });
        expect(answer).toEqual({ status: 200, body: { success: true, data: { success: true, runId: 'run-1' }, meta: undefined } });
    });

    it('passes a flat body through as flow params, exactly as POST /automation/:name/trigger does', async () => {
        const execute = vi.fn().mockResolvedValue({});
        const deps = depsWith({ automationService: { execute } });
        const ctx = contextFor(FLOW(), { method: 'POST', body: { olderThanDays: 30 } });

        await executeEndpointTarget(ctx, deps);

        expect(execute.mock.calls[0]![1].params).toEqual({ olderThanDays: 30 });
    });

    it('answers 501 with the slot’s own remedy sentence when the automation slot is empty', async () => {
        const deps = depsWith({ automationService: undefined });

        const answer = await executeEndpointTarget(contextFor(FLOW(), { method: 'POST' }), deps);

        expect(answer.status).toBe(501);
        const error = expectConformantError(answer);
        expect(error.code).toBe(DispatcherErrorCode.enum.NOT_IMPLEMENTED);
        // The same sentence discovery reports for the slot — one remedy, so the
        // 501 body and the discovery entry cannot name different fixes.
        expect(error.message).toBe(serviceUnavailableMessage('automation'));
    });

    it('answers 501 for a self-declared non-handler — a stub is as much capability as an empty slot', async () => {
        const execute = vi.fn().mockResolvedValue({ success: true });
        const stub = { execute, [SERVICE_SELF_INFO_KEY]: { status: 'stub', handlerReady: false } };
        const deps = depsWith({ automationService: stub });

        const answer = await executeEndpointTarget(contextFor(FLOW(), { method: 'POST' }), deps);

        expect(answer.status).toBe(501);
        // The point of the gate: a stub whose `execute` returns `{success:true}`
        // must not answer 200 for a flow that never ran (ADR-0076 D12).
        expect(execute).not.toHaveBeenCalled();
    });

    it('keeps serving a `degraded` occupant — degraded is not a stub', async () => {
        const execute = vi.fn().mockResolvedValue({ success: true });
        const degraded = { execute, [SERVICE_SELF_INFO_KEY]: { status: 'degraded' } };
        const deps = depsWith({ automationService: degraded });

        const answer = await executeEndpointTarget(contextFor(FLOW(), { method: 'POST' }), deps);

        expect(answer.status).toBe(200);
        expect(execute).toHaveBeenCalledTimes(1);
    });

    it('answers 501 for an occupant that carries no `execute` rather than throwing a TypeError', async () => {
        const deps = depsWith({ automationService: { listFlows: async () => [] } });

        const answer = await executeEndpointTarget(contextFor(FLOW(), { method: 'POST' }), deps);

        expect(answer.status).toBe(501);
        expect(expectConformantError(answer).code).toBe(DispatcherErrorCode.enum.NOT_IMPLEMENTED);
    });

    it('never reaches the data pipeline', async () => {
        const deps = depsWith({ automationService: { execute: vi.fn().mockResolvedValue({}) } });
        await executeEndpointTarget(contextFor(FLOW(), { method: 'POST' }), deps);
        expect(deps.callData).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// The unsupported subset
// ---------------------------------------------------------------------------

describe('an unsupported declaration gets a structured 501, never invented semantics', () => {
    it.each(['script', 'proxy'])('%s answers 501 NOT_IMPLEMENTED with a hint', async (type) => {
        const deps = depsWith({ automationService: { execute: vi.fn() } });
        const ctx = contextFor(endpoint({ type, target: 'whatever', objectParams: undefined }));

        const answer = await executeEndpointTarget(ctx, deps);

        expect(answer.status).toBe(501);
        const error = expectConformantError(answer);
        expect(error.code).toBe(DispatcherErrorCode.enum.NOT_IMPLEMENTED);
        expect(error.hint).toContain('script');
        // Nothing was delegated: refusing is the whole behavior.
        expect(deps.callData).not.toHaveBeenCalled();
    });

    it('an object_operation with no objectParams answers 501 and touches no pipeline', async () => {
        const deps = depsWith();
        const ctx = contextFor(endpoint({ objectParams: undefined }));

        const answer = await executeEndpointTarget(ctx, deps);

        expect(answer.status).toBe(501);
        expect(deps.callData).not.toHaveBeenCalled();
    });

    it('a flow with an empty target answers 501 and calls nothing', async () => {
        const execute = vi.fn();
        const deps = depsWith({ automationService: { execute } });
        const ctx = contextFor(endpoint({ type: 'flow', target: '', objectParams: undefined }));

        expect((await executeEndpointTarget(ctx, deps)).status).toBe(501);
        expect(execute).not.toHaveBeenCalled();
    });

    // [#10338] `target` is OPTIONAL in the vocabulary now, so a flow endpoint
    // with the key OMITTED is a parseable declaration — the publish gate
    // refuses it (`apis-publish-gates.test.ts`), and this is the runtime
    // counterpart that gate mirrors (`planEndpointTarget`), for a declaration
    // that reached the store without passing publish. Pinned as `code` AND
    // `status` (ADR-0112): a bare status assertion would stay green on a
    // refusal that lost its envelope.
    it('a flow that OMITS target answers 501 NOT_IMPLEMENTED — code AND status — and calls nothing', async () => {
        const execute = vi.fn();
        const deps = depsWith({ automationService: { execute } });
        const ctx = contextFor(endpoint({ type: 'flow', target: undefined, objectParams: undefined }));

        const answer = await executeEndpointTarget(ctx, deps);

        expect(answer.status).toBe(501);
        const error = expectConformantError(answer);
        expect(error.code).toBe(DispatcherErrorCode.enum.NOT_IMPLEMENTED);
        expect(error.message).toContain('names no target flow');
        expect(execute).not.toHaveBeenCalled();
        expect(deps.callData).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// Failure mapping
// ---------------------------------------------------------------------------

describe('a delegated failure maps onto the EXISTING envelope, class by class', () => {
    async function failWith(err: unknown): Promise<EndpointExecutionAnswer> {
        const deps = depsWith();
        deps.callData.mockRejectedValue(err);
        return executeEndpointTarget(contextFor(endpoint({})), deps);
    }

    it('honours the error’s own status — a 404 stays a 404', async () => {
        const answer = await failWith({ status: 404, message: 'Record not found' });
        expect(answer.status).toBe(404);
        expect(expectConformantError(answer).message).toBe('Record not found');
    });

    it('honours `statusCode` too — the shape callData’s exposure gate throws', async () => {
        // `action-execution.callData` throws `{ statusCode, message }` for an
        // object whose `apiEnabled`/`apiMethods` deny the operation (ADR-0049).
        const answer = await failWith({ statusCode: 403, message: 'API access denied' });
        expect(answer.status).toBe(403);
        expect(expectConformantError(answer).message).toBe('API access denied');
    });

    it('maps a record ValidationError to 400 with fields[] (#3918)', async () => {
        const err = Object.assign(new Error('title is required'), {
            name: 'ValidationError',
            code: 'VALIDATION_FAILED',
            fields: [{ field: 'title', message: 'required' }],
        });

        const answer = await failWith(err);

        expect(answer.status).toBe(400);
        const error = expectConformantError(answer);
        expect(error.code).toBe('VALIDATION_FAILED');
        expect((error.details as any).fields).toEqual([{ field: 'title', message: 'required' }]);
    });

    it('falls back to 500 for an error carrying no status', async () => {
        const answer = await failWith(new Error('something broke'));
        expect(answer.status).toBe(500);
        expect(expectConformantError(answer).message).toBe('something broke');
    });

    it('sanitises a 5xx message that looks like an internal leak (#3867)', async () => {
        const answer = await failWith(new Error('SQLITE_CONSTRAINT: UNIQUE constraint failed: showcase_task.name'));
        expect(answer.status).toBe(500);
        // The physical table/column name must not reach the caller.
        expect(expectConformantError(answer).message).toBe(INTERNAL_ERROR_MESSAGE);
    });

    it('leaves a 4xx message intact even when it would trip the leak heuristic', async () => {
        // A 4xx is a deliberate business answer and must reach the caller whole —
        // the guard is scoped to 5xx exactly as the dispatcher’s own exits scope it.
        const answer = await failWith({ status: 400, message: 'select a valid owner' });
        expect(answer.status).toBe(400);
        expect(expectConformantError(answer).message).toBe('select a valid owner');
    });

    it('carries the producer’s own code into the declared field', async () => {
        const answer = await failWith({ status: 409, message: 'conflict', code: 'RECORD_LOCKED' });
        expect(expectConformantError(answer).code).toBe('RECORD_LOCKED');
    });

    it('maps a flow failure the same way — one error path for both pipelines', async () => {
        const deps = depsWith({
            automationService: { execute: vi.fn().mockRejectedValue({ status: 422, message: 'flow refused input' }) },
        });
        const ctx = contextFor(endpoint({ type: 'flow', target: 'purge_inquiries', objectParams: undefined }), { method: 'POST' });

        const answer = await executeEndpointTarget(ctx, deps);

        expect(answer.status).toBe(422);
        expect(expectConformantError(answer).message).toBe('flow refused input');
    });

    it('executeEndpointTarget never throws — the caller has exactly one answer type', async () => {
        const deps = depsWith();
        deps.callData.mockRejectedValue('a bare string, not an Error');
        await expect(executeEndpointTarget(contextFor(endpoint({})), deps)).resolves.toMatchObject({ status: 500 });
    });

    it('endpointErrorAnswer is usable directly with a caller-chosen fallback status', async () => {
        expect(endpointErrorAnswer(new Error('nope'), 502).status).toBe(502);
    });
});
