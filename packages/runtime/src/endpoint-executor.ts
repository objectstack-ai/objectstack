// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * EXECUTION-TARGET DELEGATION for declarative `apis:` endpoints (#5040 E5).
 *
 * ## The one rule this module exists to keep
 *
 * A declarative endpoint is a **stable URL alias plus a policy layer over an
 * EXISTING pipeline** — never a second execution dialect. #5040 §4 states it as
 * a ruling: the same operation reached through a declared endpoint and through
 * the built-in route must answer the same thing, because two pipelines for one
 * operation drift, and an endpoint whose semantics cannot be read off the
 * existing docs is a hidden dialect (Prime Directive #12).
 *
 * So there is **zero new execution semantics** here. `object_operation`
 * delegates to `action-execution.callData` — the same call `/data` makes, with
 * the same argument shape, cited line by line below — and `flow` delegates to
 * `IAutomationService.execute` with the context `buildAutomationContext`
 * builds, the same one `POST /automation/:name/trigger` sends. What this module
 * contributes is only: which pipeline, with which arguments, and how its answer
 * (or its throw) becomes an HTTP response.
 *
 * ## What calls this, and since when
 *
 * The dispatch step (`api-endpoint-step.ts`, #5090) calls it on every match:
 * E5b replaced that step's provisional 501 with `policy → execute`, so this
 * module runs whenever a declared endpoint is matched. The E7 publish flip
 * (`packages/spec/src/api/endpoint-publish-gate.ts`) then made declarations
 * possible at all — a non-empty `apis:` is no longer refused wholesale, only
 * shape by shape — so this is LIVE code on a real deployment, not a unit
 * waiting for its seam. The showcase exercises it end to end over a socket
 * (`packages/qa/dogfood/test/showcase-declarative-endpoints.dogfood.test.ts`);
 * the unit tests below still drive it directly with stubs, which is how the
 * exact delegated call shape stays assertable.
 *
 * ## Pure by construction
 *
 * Every collaborator arrives as an argument — the `callData` binding, the
 * `automation` slot occupant, the resolved `executionContext`, the environment
 * scoping. NOTHING is looked up in here. That is what makes the delegated call
 * shape assertable in a unit test (the tests below check the exact arguments
 * `/data` would have passed), and it keeps service resolution owned by the
 * caller that already performs the per-request kernel swap.
 */

import { DispatcherErrorCode } from '@objectstack/spec/api';
import type { ApiEndpoint } from '@objectstack/spec/api';
import type { ApiEndpointMatch, IAutomationService } from '@objectstack/spec/contracts';
import type { AutomationContext } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { serviceUnavailableMessage } from '@objectstack/spec/system';
import { INTERNAL_ERROR_MESSAGE, looksLikeInternalErrorLeak, resolveThrownHttpError, demotedDeclaredCode } from '@objectstack/types';
import { apiErrorResponse } from './error-envelope.js';
import { isServiceServeable } from './service-serveable.js';
import { validationFailure } from './validation-failure.js';
import { buildAutomationContext } from './domains/automation.js';
import type { HttpProtocolContext } from './http-dispatcher.js';

// ============================================================================
// Request → execution context
// ============================================================================

/**
 * The request as the `setFallbackHandler` seam sees it — the `IHttpRequest`
 * members an endpoint execution can legitimately read.
 *
 * `params` is deliberately NOT here: the transport's own route params are
 * meaningless for a path no route matched, and the endpoint's path parameters
 * arrive on {@link ApiEndpointMatch.params} instead (always `{}` in 17.x — the
 * frozen vocabulary defines no template syntax).
 */
export interface EndpointExecutionRequest {
    method: string;
    path: string;
    query?: Record<string, string | string[]>;
    headers?: Record<string, string | string[]>;
    /** Parsed body. The fallback seam populates it exactly as a route does. */
    body?: unknown;
    /** The transport's own peer address — never a header (#4910). */
    remoteAddress?: string;
}

export interface BuildEndpointExecutionContextInput {
    request: EndpointExecutionRequest;
    /** The matcher's verdict — endpoint with schema defaults MATERIALIZED. */
    match: ApiEndpointMatch;
    /**
     * The identity envelope the dispatcher resolved for this request, or
     * `undefined` for anonymous. Threaded into every delegated call so RLS/FLS
     * and the ADR-0049 exposure gate apply as they do on the built-in route.
     *
     * #5040 §4 makes this a red line, and names the defect it guards against:
     * the dead `handleApiEndpoint` code removed in #4936 called
     * `callData('query', …)` with NO context, so had it ever run it would have
     * read as a system principal with RLS bypassed.
     */
    executionContext?: ExecutionContext;
    /** Environment scoping for service resolution (`HttpProtocolContext`). */
    environmentId?: string;
    /** Environment-scoped data driver, when the host resolved one. */
    dataDriver?: unknown;
}

/**
 * Everything a target delegation needs about one request, derived once.
 *
 * The members mirror what the existing callers of these pipelines read off
 * their own `HttpProtocolContext` (`domains/data.ts`, `domains/automation.ts`) —
 * no context member is invented here.
 */
export interface EndpointExecutionContext {
    /** Matched endpoint, schema defaults materialized. */
    endpoint: ApiEndpoint;
    /**
     * Path parameters from the match. **Always `{}` in 17.x** and deliberately
     * NOT consulted when resolving a record id — the id comes from `query.id`
     * (#5040 §2), because reading it from a template segment would require a
     * template syntax the vocabulary does not define.
     */
    params: Record<string, string>;
    /** Upper-cased, as every method comparison in the dispatcher stack is. */
    method: string;
    path: string;
    query: Record<string, string | string[]>;
    headers: Record<string, string | string[]>;
    body: unknown;
    remoteAddress?: string;
    environmentId?: string;
    dataDriver?: unknown;
    executionContext?: ExecutionContext;
    /**
     * The `HttpProtocolContext` shape the existing domain handlers receive, so
     * a collaborator that already takes one (`buildAutomationContext`) is fed
     * the same object it is fed on the built-in route rather than a lookalike.
     */
    protocolContext: HttpProtocolContext;
}

/**
 * Derive the execution context for one matched endpoint request.
 *
 * A pure projection: it reads its inputs and writes nothing. `query`, `headers`
 * and `body` ride through VERBATIM — normalising them here would put a second,
 * weaker copy of each pipeline's own input handling in front of it (the
 * `/data` list route carries the same note about transport query params:
 * `domains/data.ts:109-118`).
 */
export function buildEndpointExecutionContext(
    input: BuildEndpointExecutionContextInput,
): EndpointExecutionContext {
    const { request, match, executionContext, environmentId, dataDriver } = input;
    const query = request.query ?? {};
    const headers = request.headers ?? {};

    const protocolContext: HttpProtocolContext = {
        // `{ request: req }` is how every dispatcher-plugin route builds this
        // (dispatcher-plugin.ts, ~40 call sites) — the raw request object,
        // unwrapped.
        request,
        ...(environmentId !== undefined ? { environmentId } : {}),
        ...(dataDriver !== undefined ? { dataDriver } : {}),
        ...(executionContext !== undefined ? { executionContext } : {}),
    };

    return {
        endpoint: match.endpoint,
        params: match.params,
        method: request.method.toUpperCase(),
        path: request.path,
        query,
        headers,
        body: request.body,
        ...(request.remoteAddress !== undefined ? { remoteAddress: request.remoteAddress } : {}),
        ...(environmentId !== undefined ? { environmentId } : {}),
        ...(dataDriver !== undefined ? { dataDriver } : {}),
        ...(executionContext !== undefined ? { executionContext } : {}),
        protocolContext,
    };
}

// ============================================================================
// What a declaration asks for — and what this executor can honour
// ============================================================================

/** The record operations `callData` serves, as the vocabulary spells them. */
export type ObjectOperation = 'find' | 'get' | 'create' | 'update' | 'delete';

/**
 * The executor's reading of one declaration.
 *
 * The `unsupported` arm is the point of this type: the subset of the FROZEN
 * vocabulary that 17.x does not execute is enumerated **once, here**, so the
 * E7 publish gate (`packages/spec`) has a single place to read the list off
 * rather than restating it. Every `unsupported` shape is one the gate rejects
 * at publish — so this arm is a structural backstop for a declaration that
 * reached the store some other way (a direct `metadata.register()`), never a
 * silent degradation of a legal one.
 */
export type EndpointTargetPlan =
    | { kind: 'object_operation'; object: string; operation: ObjectOperation }
    | { kind: 'flow'; flow: string }
    | { kind: 'unsupported'; reason: string; hint: string };

/**
 * Classify a declaration into the pipeline that will run it.
 *
 * `script` and `proxy` are declared by the vocabulary and NOT executed in 17.x,
 * on purpose (#5040 §7-3, restated in the E5 card): the automation contract's
 * `execute` doc mentions "flow or script" but nothing in this repo verifies a
 * script target is reachable that way, and `proxy` is an entirely new outbound
 * surface (SSRF / egress policy) that needs its own security ruling. Answering
 * "not implemented" is the declared=enforced posture for them — inventing
 * semantics here is precisely what a frozen vocabulary forbids.
 */
export function planEndpointTarget(endpoint: ApiEndpoint): EndpointTargetPlan {
    if (endpoint.type === 'object_operation') {
        const object = endpoint.objectParams?.object;
        const operation = endpoint.objectParams?.operation;
        if (!object || !operation) {
            return {
                kind: 'unsupported',
                reason:
                    `Endpoint '${endpoint.name}' declares type 'object_operation' but `
                    + `objectParams.${!object ? 'object' : 'operation'} is missing.`,
                hint: 'An object_operation endpoint must declare both `objectParams.object` and '
                    + '`objectParams.operation`; publish rejects the incomplete form (#5040 E7).',
            };
        }
        return { kind: 'object_operation', object, operation };
    }

    if (endpoint.type === 'flow') {
        const flow = endpoint.target;
        if (!flow) {
            return {
                kind: 'unsupported',
                reason: `Endpoint '${endpoint.name}' declares type 'flow' but names no target flow.`,
                hint: 'Set `target` to the flow name (snake_case) this endpoint triggers.',
            };
        }
        return { kind: 'flow', flow };
    }

    return {
        kind: 'unsupported',
        reason: `Endpoint '${endpoint.name}' declares type '${endpoint.type}', which this runtime does not execute.`,
        hint: "Only 'object_operation' and 'flow' endpoints execute in 17.x. 'script' and 'proxy' "
            + 'are rejected at publish pending their own rulings — script reachability through the '
            + 'automation service is unverified, and proxy is an outbound (SSRF) surface (#5040 §7-3).',
    };
}

// ============================================================================
// Answers
// ============================================================================

/** What the executor decided: a response for the caller to write. */
export interface EndpointExecutionAnswer {
    status: number;
    body: unknown;
    headers?: Record<string, string>;
}

/**
 * The success envelope, built exactly as `HttpDispatcher.success` builds it
 * (`http-dispatcher.ts:460-465`) — `{ success, data, meta }`, `meta` present as
 * a key even when undefined so it drops out of JSON the same way.
 */
function successAnswer(data: unknown, status = 200): EndpointExecutionAnswer {
    return { status, body: { success: true, data, meta: undefined } };
}

/**
 * A 5xx message is sanitised before it reaches the wire, exactly as both
 * existing dispatcher exits do it (`HttpDispatcher.error`,
 * `dispatcher-plugin.errorResponseBase`): a delegated pipeline can be carrying
 * a driver message that names physical tables and columns. 4xx messages are
 * deliberate business answers and pass through intact (#3867).
 */
function sanitizeMessage(message: string, httpStatus: number): string {
    return httpStatus >= 500 && looksLikeInternalErrorLeak(message) ? INTERNAL_ERROR_MESSAGE : message;
}

/**
 * A THROWN failure from a delegated pipeline → the existing error envelope.
 *
 * [#9106] No longer a restatement of `HttpDispatcher.errorFromThrown` — a
 * DELEGATION to the same shared resolver that exit and the REST door call
 * (`resolveThrownHttpError`, `@objectstack/types`): same status precedence
 * (`.status` → `.statusCode` → validation ⇒ 400 → fallback), same `details`
 * assembly (non-string `code` as context, `issues`, `fields[]`), and — the
 * #9106 ruling — the same closed `error.code`: the resolver's narrowed `code`
 * is what reaches the declared field, and a producer's unregistered spelling
 * rides the wire's `declaredCode` sibling instead (presence means demotion).
 * This matters HERE because a delegated pipeline runs tenant-authored hooks —
 * the same author-thrown limb `domains/actions.ts` serves. The 5xx
 * sanitisation stays this module's (a boundary property, not the throw's).
 */
export function endpointErrorAnswer(e: any, fallbackStatus = 500): EndpointExecutionAnswer {
    const thrown = resolveThrownHttpError(e, fallbackStatus);
    const declaredCode = demotedDeclaredCode(thrown);
    return apiErrorResponse({
        message: sanitizeMessage(thrown.message, thrown.status),
        httpStatus: thrown.status,
        code: thrown.code,
        details: thrown.details,
        ...(declaredCode !== undefined ? { extra: { declaredCode } } : {}),
    });
}

/** The 501 answer for a declaration this runtime cannot delegate. */
function unsupportedAnswer(plan: { reason: string; hint: string }): EndpointExecutionAnswer {
    return apiErrorResponse({
        code: DispatcherErrorCode.enum.NOT_IMPLEMENTED,
        httpStatus: 501,
        message: sanitizeMessage(plan.reason, 501),
        extra: { hint: plan.hint },
    });
}

// ============================================================================
// Delegation
// ============================================================================

/**
 * The `callData` bridge, as a value.
 *
 * Identical to `action-execution.callData` with its `deps` argument already
 * bound — the caller supplies
 * `(action, params, driver, scope, ec) => callData(deps, action, params, driver, scope, ec)`.
 * Injected rather than imported so this module performs no lookup of its own
 * and a test can assert the EXACT delegated call, which is the property that
 * keeps "same pipeline, same arguments as `/data`" honest over time.
 */
export type CallDataFn = (
    action: string,
    params: any,
    dataDriver?: any,
    scopeId?: string,
    executionContext?: ExecutionContext,
) => Promise<any>;

export interface EndpointExecutorDeps {
    callData: CallDataFn;
    /**
     * The `automation` slot occupant, or `undefined` when the slot is empty.
     * Resolved by the caller (per request, on the request's own kernel) and
     * checked here with `isServiceServeable`, the same predicate `/automation`
     * applies — a self-declared non-handler is as much capability as an empty
     * slot (ADR-0076 D12).
     */
    automationService?: unknown;
}

/** `query.id`, or a 400-class validation failure naming the missing parameter. */
function requireRecordId(ctx: EndpointExecutionContext): string {
    const raw = ctx.query.id;
    if (typeof raw !== 'string' || raw === '') {
        // Thrown, not returned, so it lands in the SAME mapping as a pipeline
        // failure — one error path, one envelope. `validationFailure` is the
        // repo's constructor for the shape both dispatcher exits map to 400 +
        // `fields[]` (#3878/#3918).
        throw validationFailure(
            `Query parameter 'id' is required for a '${ctx.endpoint.objectParams?.operation}' endpoint.`,
            [{ field: 'id', code: 'required', message: "Record id must be supplied as `?id=<record id>`." }],
        );
    }
    return raw;
}

/**
 * `object_operation` → `callData`, with the argument shape `/data` uses.
 *
 * Each mapping is the one the built-in route already performs, cited so a
 * reader can check it rather than take it on trust:
 *
 * | operation | delegated call | mirrors |
 * |---|---|---|
 * | `find`   | `('query',  { object, query: {…query} })` | `domains/data.ts:119` (GET list — transport query params ride through verbatim; folding them into QueryAST names belongs to the protocol's own normalizer, #3795) |
 * | `get`    | `('get',    { object, id, select?, expand? })` | `domains/data.ts:87` (GET by id — `select`/`expand` are the ONLY allowlisted query params, everything else is dropped to prevent parameter pollution) |
 * | `create` | `('create', { object, data: body })` | `domains/data.ts:126` (POST) |
 * | `update` | `('update', { object, id, data: body })` | `domains/data.ts:95` (PATCH) |
 * | `delete` | `('delete', { object, id })` | `domains/data.ts:103` (DELETE) |
 *
 * The record id comes from `query.id` for `get`/`update`/`delete` (#5040 §2):
 * `/data` takes it from a path segment, which a declared endpoint has no way to
 * express — the vocabulary defines no path templates and this executor does not
 * invent one.
 *
 * `object` comes from `objectParams.object`, NEVER from the request. `/data`
 * had the mirror-image bug (#3946: a body key could move the read to a
 * different object than the URL named); here the declaration is the only
 * source, so a request cannot redirect the operation at all.
 *
 * The success status mirrors `/data` too: 201 for a create (`data.ts:127-128`),
 * 200 otherwise.
 */
async function executeObjectOperation(
    ctx: EndpointExecutionContext,
    deps: EndpointExecutorDeps,
    plan: { object: string; operation: ObjectOperation },
): Promise<EndpointExecutionAnswer> {
    const { object, operation } = plan;
    const call = (action: string, params: Record<string, unknown>) =>
        deps.callData(action, params, ctx.dataDriver, ctx.environmentId, ctx.executionContext);

    if (operation === 'find') {
        return successAnswer(await call('query', { object, query: { ...ctx.query } }));
    }

    if (operation === 'get') {
        const id = requireRecordId(ctx);
        const { select, expand } = ctx.query;
        const allowedParams: Record<string, unknown> = {};
        if (select != null) allowedParams.select = select;
        if (expand != null) allowedParams.expand = expand;
        return successAnswer(await call('get', { object, id, ...allowedParams }));
    }

    if (operation === 'create') {
        return successAnswer(await call('create', { object, data: ctx.body }), 201);
    }

    if (operation === 'update') {
        const id = requireRecordId(ctx);
        return successAnswer(await call('update', { object, id, data: ctx.body }));
    }

    const id = requireRecordId(ctx);
    return successAnswer(await call('delete', { object, id }));
}

/**
 * `flow` → `IAutomationService.execute`, with the context the trigger route
 * builds.
 *
 * `buildAutomationContext` (`domains/automation.ts`) is THE construction point
 * for both existing trigger routes, and reusing it is what carries the parts
 * that are easy to omit and expensive to omit: the `{recordId, objectName,
 * params}` translation flow variables resolve from, and the FULLY-RESOLVED
 * identity envelope (`userId` / `positions` / `permissions` / `tenantId`) a
 * `runAs:'user'` flow needs — without which its data operations are REFUSED
 * fail-closed (#3760) or, worse, run as somebody else (#1888). #5040 §4 is
 * explicit that the executor uses this and not the `runFlow({flowId, inputs})`
 * shape the removed dead code invented, which no contract ever declared.
 *
 * The request body is the flow input, exactly as on `POST
 * /automation/:name/trigger`.
 */
async function executeFlow(
    ctx: EndpointExecutionContext,
    deps: EndpointExecutorDeps,
    plan: { flow: string },
): Promise<EndpointExecutionAnswer> {
    const service = deps.automationService;
    // Empty slot, or a slot filled by a self-declared non-handler — the same
    // amount of automation capability, and the same answer `/automation` gives:
    // 501 carrying the remedy sentence discovery reports for the slot
    // (`domains/unavailable.ts`, `serviceUnavailableMessage`). NOT a 404: the
    // endpoint IS declared and IS matched; what is missing is the implementation
    // behind it.
    if (!isServiceServeable(service)) {
        return apiErrorResponse({
            code: DispatcherErrorCode.enum.NOT_IMPLEMENTED,
            httpStatus: 501,
            message: serviceUnavailableMessage('automation'),
        });
    }

    const automation = service as Pick<IAutomationService, 'execute'>;
    if (typeof automation.execute !== 'function') {
        // A serveable occupant that cannot execute is the same wall from the
        // caller's side, and saying so is more use than letting a TypeError
        // become an opaque 500.
        return apiErrorResponse({
            code: DispatcherErrorCode.enum.NOT_IMPLEMENTED,
            httpStatus: 501,
            message: serviceUnavailableMessage('automation'),
        });
    }

    const automationContext = buildAutomationContext(ctx.body, ctx.protocolContext) as AutomationContext;
    return successAnswer(await automation.execute(plan.flow, automationContext));
}

/**
 * Execute one matched endpoint and map the outcome onto an HTTP answer.
 *
 * Never throws: a throw out of a delegated pipeline is mapped by
 * {@link endpointErrorAnswer} into the existing envelope, so the caller has one
 * answer type to write and cannot accidentally give a delegated failure a
 * different shape than a policy failure.
 */
export async function executeEndpointTarget(
    ctx: EndpointExecutionContext,
    deps: EndpointExecutorDeps,
): Promise<EndpointExecutionAnswer> {
    const plan = planEndpointTarget(ctx.endpoint);
    if (plan.kind === 'unsupported') return unsupportedAnswer(plan);

    try {
        return plan.kind === 'object_operation'
            ? await executeObjectOperation(ctx, deps, plan)
            : await executeFlow(ctx, deps, plan);
    } catch (err) {
        return endpointErrorAnswer(err);
    }
}
