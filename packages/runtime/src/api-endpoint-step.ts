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
 * Today it answers **501 NOT_IMPLEMENTED** on a match. That is the honest
 * report of the state of the executor: the endpoint IS declared and IS matched,
 * and the thing that would run it lands in 17.x (#5040 E5). It is also
 * structurally unreachable — a non-empty `apis:` is rejected at publish /
 * validate until the E7 flip — so no deployment can observe it; the tests below
 * drive `matchEndpoint` through a stub, exactly as #5040 §5 prescribes for
 * every E-series unit that lands before the flip.
 *
 * ## The policy chain (#5040 E4) now runs between the match and the answer
 *
 * `authRequired` / `rateLimit` / `cacheTtl` are enforced by
 * {@link applyEndpointPolicies}, in the order #5040 §3 fixes, whenever the
 * caller supplies a {@link EndpointPolicyContext}. A denial (401 / 429) is the
 * answer; a pass still ends in the 501 below, because the thing that would run
 * the endpoint is E5.
 *
 * That ordering is structural, not stylistic: execution lands INSIDE the
 * post-policy branch, which is unreachable without a policy context. Wiring an
 * executor without wiring policies is therefore not something a future change
 * can do by forgetting — it would have nowhere to put the call.
 *
 * What it does NOT do yet, so nobody reads more into it than is here:
 * `inputMapping` / `outputMapping` and target execution — `object_operation`
 * via `callData`, `flow` via the automation service (E5).
 */

import { DispatcherErrorCode } from '@objectstack/spec/api';
import type { ApiEndpointMatch, IMetadataService } from '@objectstack/spec/contracts';
import { apiErrorResponse } from './error-envelope.js';
import { applyEndpointPolicies, type EndpointPolicyContext } from './endpoint-policy.js';

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
     * Headers that are part of THIS answer and must be written with it — today
     * only `Retry-After` on a rate-limit denial, where the header carries the
     * one piece of information the client needs to behave.
     *
     * Note what is NOT here: the `Cache-Control` computed from `cacheTtl`. It
     * describes a successful response body that does not exist yet, and telling
     * a client to cache a 501 would be worse than saying nothing. It stays on
     * the policy verdict until execution lands (#5040 E5).
     */
    headers?: Record<string, string>;
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
     * Optional ONLY because the dispatch seam that calls this step does not
     * thread it yet — that plumbing lands with the executor wiring (#5040 E5),
     * which is the same change that needs the request body and the environment
     * anyway. Omitting it does not open anything: the terminal answer without a
     * policy context is the 501 below, so no request can be SERVED unpoliced,
     * and execution can only be added on the far side of the chain.
     */
    policy?: EndpointPolicyContext;
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
        // No policy context threaded yet (see `AppEndpointStepInput.policy`).
        // The answer is the same 501 this seam has always given, and the hint
        // says which keys were NOT evaluated — a report that is wrong about
        // what ran is worse than no report.
        return notImplemented(match, method, path,
            'The mounting seam is in place; execution (target dispatch, mappings) lands with #5040 E5. This '
            + 'request reached the step without a policy context, so authRequired / rateLimit / cacheTtl were '
            + 'not evaluated — nothing was served either. Until the E7 flip a non-empty `apis:` is rejected at '
            + 'publish, so no reachable deployment can produce this answer.');
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
    // This is where target execution lands (#5040 E5), and it is the ONLY place
    // it can land: the branch is unreachable without a policy context, and the
    // deny above short-circuits before it. `verdict.responseHeaders` carries the
    // `Cache-Control` that the executor's success answer should apply — it is
    // deliberately not applied to the 501 (see `AppEndpointStepAnswer.headers`).
    return notImplemented(match, method, path,
        'Policies (authRequired / rateLimit / cacheTtl) were enforced and this request passed them; target '
        + 'execution lands with #5040 E5. Until the E7 flip a non-empty `apis:` is rejected at publish, so no '
        + 'reachable deployment can produce this answer.');
}

/** The one 501 body this step answers with, whichever branch produced it. */
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
            `Declarative endpoint '${match.endpoint.name}' claims ${method} ${path}, but the endpoint `
            + 'executor is not enabled in this build. It lands in 17.x (#5040).',
        extra: { hint },
    });
}
