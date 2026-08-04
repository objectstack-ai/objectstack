// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The ENDPOINT DISPATCH STEP for declarative `apis:` endpoints (#5040 E3).
 *
 * ## Where this runs, and why not in `dispatch()`
 *
 * It runs inside the `IHttpServer.setFallbackHandler` seam that
 * `dispatcher-plugin` installs — i.e. only for a request that matched NO
 * registered route on the whole server (ADR-0076 D11: a fallback cannot shadow
 * a route, by construction rather than by convention). It deliberately does
 * NOT re-enter `HttpDispatcher.dispatch()`: that pipeline resolves an
 * environment, an `executionContext` and an anonymous-deny gate, and ends in a
 * SEMANTIC 404 — so routing every unmatched request through it would change
 * what today's unmatched requests answer (a 404 could become a 401, and the
 * bare Hono 404 body would become the `ROUTE_NOT_FOUND` envelope). #5090 keeps
 * that collapse explicitly out of scope: a miss here writes NOTHING and the
 * transport's existing unmatched answer stands, byte for byte.
 *
 * ## What it does today, and what it does not
 *
 * On a match it runs the WHOLE chain: policies (#5040 E4) and then target
 * execution (#5040 E5), wired together here by E5b. It is still structurally
 * unreachable — a non-empty `apis:` is rejected at publish / validate until the
 * E7 flip — so no deployment can observe it; the tests drive `matchEndpoint`
 * through a stub, exactly as #5040 §5 prescribes for every E-series unit that
 * lands before the flip.
 *
 * ## The chain, in the one order it can run in
 *
 * `authRequired` / `rateLimit` / `cacheTtl` are enforced by
 * {@link applyEndpointPolicies}, in the order #5040 §3 fixes, whenever the
 * caller supplies a {@link EndpointPolicyContext}. A denial (401 / 429) is the
 * answer. A pass reaches {@link executeEndpointTarget} — and NOTHING else can:
 * the execution call sits INSIDE the post-policy branch, which is unreachable
 * without a policy context and short-circuited by a denial. "Wired the executor,
 * forgot the policies" is therefore not a mistake a future change can make by
 * omission; there is nowhere else to put the call.
 *
 * `verdict.responseHeaders` (the `Cache-Control` computed from `cacheTtl`) is
 * merged into SUCCESS answers only. An error answer never carries it: the
 * header describes a body the caller should be willing to reuse, and telling a
 * client to cache a 401 / 429 / 500 for a minute is worse than saying nothing.
 *
 * ## The mapping keys, and why they apply exactly here (#5040 E5c)
 *
 * `inputMapping` / `outputMapping` (`api-mapping.ts`) are applied by this
 * module, on the two sides of the delegation:
 *
 *  - **`inputMapping` after the policy pass, before delegation.** It projects
 *    the request the executor sees, so a mapping can never buy a caller past
 *    `authRequired` or the rate limiter — and `endpoint-executor.ts` stays a
 *    pure delegator that does not know mappings exist.
 *  - **`outputMapping` on the SUCCESS body only.** An error answer is never
 *    remapped: a projection that could reshape a 401 / 429 / 500 into data
 *    would be able to disguise a failure as a result, and no declaration should
 *    have that power. This is the same asymmetry `Cache-Control` has above, for
 *    the same reason.
 *
 * A declaration this runtime cannot serve (`transform`, an unusable path,
 * colliding targets) is refused BEFORE the target runs — including
 * `outputMapping`, which is validated pre-delegation so a broken projection
 * cannot let a `create` insert a record and then fail to answer. With neither
 * key declared, the request and the answer pass through byte for byte, by
 * reference: an endpoint that declares no mapping is served exactly as E5b
 * served it.
 */

import { DispatcherErrorCode } from '@objectstack/spec/api';
import type { ApiEndpointMatch, IMetadataService } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { apiErrorResponse } from './error-envelope.js';
import { applyEndpointPolicies, type EndpointPolicyContext } from './endpoint-policy.js';
import {
    applyInputMapping,
    applyOutputMapping,
    mappingDeclarationRejection,
} from './api-mapping.js';
import {
    buildEndpointExecutionContext,
    executeEndpointTarget,
    type EndpointExecutionRequest,
    type EndpointExecutorDeps,
} from './endpoint-executor.js';

/**
 * The platform's single reserved carve-out segment for app-declared endpoints
 * (ADR-0121 D1). A declared `path` is `<runtime prefix>/apps/<namespace>/<sub
 * path>`, the namespace segment derived from stack identity (D2) rather than
 * authored freely.
 *
 * Spelled ONCE, here, and read by everything that needs it — the fallback's
 * scoping test, and the tests that pin it. The E7 publish gate that rejects a
 * path outside this shape lives in `packages/spec` and cannot import runtime;
 * that is a deliberate second spelling on the other side of a package boundary,
 * not a copy to keep in sync by hand (ADR-0121 makes the RULE the contract, so
 * the two sides agree on a rule rather than on a list of prefixes).
 */
export const APP_ENDPOINT_SEGMENT = 'apps';

/**
 * The URL prefix under which app-declared endpoints live for a deployment
 * serving `runtimePrefix` (default `/api/v1`) — `<prefix>/apps/`, trailing
 * slash included so a path test cannot match a sibling like `/api/v1/appsx`.
 */
export function appEndpointMountPrefix(runtimePrefix: string): string {
    return `${runtimePrefix.replace(/\/+$/, '')}/${APP_ENDPOINT_SEGMENT}/`;
}

/**
 * Whether a request path is even a CANDIDATE for the endpoint step.
 *
 * This is a routing question ("is it worth asking the metadata service about
 * this path?"), not a validity question. The exact legal shape of a declared
 * path — namespace segment derived from `manifest.namespace`, non-empty
 * subpath — is enforced where it belongs, at publish (ADR-0121 D1, landing with
 * #5040 E7). Re-deciding validity here would put a second, weaker copy of that
 * rule in a consumer, which is how a runtime dialect starts.
 */
export function isAppEndpointPath(path: string, runtimePrefix: string): boolean {
    const mount = appEndpointMountPrefix(runtimePrefix);
    return path.startsWith(mount) && path.length > mount.length;
}

/** What the step decided: an answer to write, or `undefined` for "not mine". */
export interface AppEndpointStepAnswer {
    status: number;
    body: unknown;
    /**
     * Headers that are part of THIS answer and must be written with it:
     * `Retry-After` on a rate-limit denial (the one piece of information a
     * throttled client needs to behave), and `Cache-Control` on a SUCCESSFUL
     * execution result (from `cacheTtl`).
     *
     * The asymmetry is deliberate and enforced below — `Cache-Control` rides
     * only on a success, never on an error answer.
     */
    headers?: Record<string, string>;
}

/**
 * The execution wiring: everything the step needs to RUN a matched endpoint,
 * resolved by the caller on the request's own kernel.
 *
 * Nothing here is looked up by this module. That is what keeps the "which
 * kernel / which environment" question in the one place that already answers it
 * (`HttpDispatcher.resolveRequestScope`, called by the dispatch seam) instead of
 * growing a second, weaker copy in a consumer.
 */
export interface AppEndpointExecutionInput {
    /** The request as the fallback seam sees it — body and `remoteAddress` included. */
    request: EndpointExecutionRequest;
    /** The `callData` binding and the `automation` slot occupant. */
    deps: EndpointExecutorDeps;
    /**
     * The identity envelope the dispatcher resolved for this request, or
     * `undefined` for anonymous. Threaded into every delegated call so RLS/FLS
     * and the ADR-0049 exposure gate apply exactly as on the built-in route
     * (#5040 §4's red line; #4936 is what its absence looks like).
     */
    executionContext?: ExecutionContext;
    /** Environment scoping for service resolution. */
    environmentId?: string;
    /** Environment-scoped data driver, when the host resolved one. */
    dataDriver?: unknown;
}

export interface AppEndpointStepInput {
    /** Request method, as the transport reports it. */
    method: string;
    /** Request path, as the transport reports it (prefix included). */
    path: string;
    /** The deployment's dispatcher prefix — `DispatcherPluginConfig.prefix`. */
    prefix: string;
    /**
     * The `metadata` slot occupant, or `undefined` when the kernel has none.
     * Passed in rather than resolved here so the caller owns service lookup
     * (and so this module stays a pure function of its inputs, testable with a
     * stub — #5089's real matcher is being built in parallel and this must not
     * depend on its landing).
     */
    metadataService: Pick<IMetadataService, 'matchEndpoint'> | undefined;
    /**
     * Request context + services for the policy chain (#5040 E4): the caller's
     * headers and peer address, the principal lookup, the endpoint limiter
     * registry, `trustProxy`.
     *
     * The real dispatch seam ALWAYS threads it (#5040 E5b), so the branch that
     * answers without one is unreachable in the composed runtime — pinned by
     * the integration test rather than deleted, because the honest report is
     * cheap and a direct caller of this module (a test, a future host) can still
     * omit it. Omitting it does not open anything: the terminal answer without a
     * policy context is a 501, so no request can be SERVED unpoliced, and
     * execution lives strictly on the far side of the chain.
     */
    policy?: EndpointPolicyContext;
    /**
     * Execution wiring (#5040 E5b). Threaded by the same seam that threads
     * {@link policy}; without it a policed request that PASSED still ends in a
     * 501 that says so, which is the honest answer for a host that mounted the
     * step but wired no executor.
     */
    execution?: AppEndpointExecutionInput;
}

/**
 * Run the endpoint step for one unmatched request.
 *
 * Returns `undefined` — meaning "write nothing, leave the transport's own
 * unmatched answer alone" — in every case except a genuine match:
 *
 *  - the path is not under `<prefix>/apps/`;
 *  - the kernel has no `metadata` service;
 *  - the occupant of that slot carries no `matchEndpoint` (probed with
 *    `typeof === 'function'`, the contract's own convention — an
 *    implementation without an endpoint index simply omits it, and #5089's
 *    real matcher may land before or after this seam);
 *  - `matchEndpoint` reported a miss.
 *
 * A THROW from `matchEndpoint` is deliberately NOT swallowed: its contract
 * states that an implementation which cannot read its store must throw rather
 * than report a miss, precisely so an outage cannot masquerade as a 404. The
 * caller turns it into a 5xx through the dispatcher's normal error exit.
 */
export async function runAppEndpointStep(
    input: AppEndpointStepInput,
): Promise<AppEndpointStepAnswer | undefined> {
    const { method, path, prefix, metadataService } = input;

    if (!isAppEndpointPath(path, prefix)) return undefined;
    if (!metadataService || typeof metadataService.matchEndpoint !== 'function') return undefined;

    const match: ApiEndpointMatch | undefined = await metadataService.matchEndpoint({ path, method });
    if (!match) return undefined;

    if (!input.policy) {
        // No policy context threaded (see `AppEndpointStepInput.policy`). The
        // answer is the 501 this seam gave before anything was wired, and the
        // hint says which keys were NOT evaluated — a report that is wrong
        // about what ran is worse than no report.
        return notImplemented(match, method, path,
            'This request reached the step without a policy context, so authRequired / rateLimit / cacheTtl '
            + 'were not evaluated — and nothing was executed either. The composed runtime always threads one '
            + '(#5040 E5b), so reaching this answer means a host mounted the step by hand and omitted it.');
    }

    const verdict = await applyEndpointPolicies({ ...input.policy, endpoint: match.endpoint, method });
    if (verdict.verdict === 'deny') {
        return {
            status: verdict.status,
            body: verdict.body,
            ...(verdict.headers ? { headers: verdict.headers } : {}),
        };
    }

    // ── Everything past this line has been through the policy chain ──────
    // The ONLY place execution can be called from: this branch is unreachable
    // without a policy context, and a denial short-circuits before it.
    if (!input.execution) {
        return notImplemented(match, method, path,
            'Policies (authRequired / rateLimit / cacheTtl) were enforced and this request passed them, but no '
            + 'execution wiring was supplied, so the target was not run. The composed runtime always supplies '
            + 'it (#5040 E5b).');
    }

    const { request, deps, executionContext, environmentId, dataDriver } = input.execution;

    // ── inputMapping: project the request the executor will see ──────────
    // Nothing has been delegated yet, so a declaration this runtime cannot
    // serve is refused before it can have an effect. With no declaration the
    // caller's own request object rides on unchanged, by reference.
    const mappedBody = applyInputMapping(match.endpoint, request.body);
    if (!mappedBody.ok) return mappedBody.rejection;
    const mappedRequest = mappedBody.value === request.body
        ? request
        : { ...request, body: mappedBody.value };

    // `outputMapping` is judged HERE, not after the result arrives: a broken
    // projection must not be able to let a `create` insert its record and then
    // refuse to answer with it.
    const outputRejection = mappingDeclarationRejection(match.endpoint, 'outputMapping');
    if (outputRejection) return outputRejection;

    const answer = await executeEndpointTarget(
        buildEndpointExecutionContext({
            request: mappedRequest,
            match,
            ...(executionContext !== undefined ? { executionContext } : {}),
            ...(environmentId !== undefined ? { environmentId } : {}),
            ...(dataDriver !== undefined ? { dataDriver } : {}),
        }),
        deps,
    );

    // `Cache-Control` (from `cacheTtl`) applies to a SUCCESS and nothing else.
    // `executeEndpointTarget` never throws — a delegated failure is already an
    // error answer here — so the status is the whole test, and an endpoint whose
    // execution failed cannot hand the client a cache directive for the failure.
    // `outputMapping` rides on exactly the same test, and for a stronger reason:
    // a projection applied to an error body could disguise the failure as data.
    const isSuccess = answer.status < 400;
    let body = answer.body;
    if (isSuccess) {
        const mapped = applyOutputMapping(match.endpoint, answer.body);
        // Unreachable: the identical verdict was taken before delegation, above.
        // Restated rather than asserted away, so a future reordering of these
        // two lines cannot turn a refusal into a silently unmapped answer.
        if (!mapped.ok) return mapped.rejection;
        body = mapped.value;
    }

    const headers = {
        ...(answer.headers ?? {}),
        ...(isSuccess ? verdict.responseHeaders : {}),
    };
    return {
        status: answer.status,
        body,
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
    };
}

/**
 * The 501 for a match this step was not given enough to serve.
 *
 * Both callers are INCOMPLETE-WIRING branches, not feature gaps: the composed
 * runtime threads both a policy context and execution wiring, so neither is
 * reachable through `dispatcher-plugin` (pinned in
 * `dispatcher-plugin.endpoint-fallback.integration.test.ts`). They stay because
 * this module is callable directly, and answering an honest "nothing ran"
 * beats pretending — or crashing on a missing collaborator.
 */
function notImplemented(
    match: ApiEndpointMatch,
    method: string,
    path: string,
    hint: string,
): AppEndpointStepAnswer {
    return apiErrorResponse({
        code: DispatcherErrorCode.enum.NOT_IMPLEMENTED,
        httpStatus: 501,
        message:
            `Declarative endpoint '${match.endpoint.name}' claims ${method} ${path}, but the caller of the `
            + 'endpoint step supplied no wiring to serve it with (#5040).',
        extra: { hint },
    });
}
