// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The POLICY KEYS of a declarative `apis:` endpoint — `authRequired`,
 * `rateLimit`, `cacheTtl` (#5040 E4).
 *
 * ## What this is, and what it deliberately is not
 *
 * `ApiEndpointSchema` declares three policy keys. Until now every one of them
 * parsed and did nothing — the #4686 shape this whole program exists to end.
 * This module is their single reader. It invents NOTHING: each key is answered
 * with the mechanism the platform already uses for that question, so a declared
 * endpoint cannot drift from the surface next door.
 *
 * | key | answered by | shared with |
 * |---|---|---|
 * | `authRequired` | `shouldDenyAnonymous` + the `ANONYMOUS_DENY_*` constants | `/meta`, `/ai`, `/security` (#2567, #3963) |
 * | `rateLimit` | `deriveBucketConfig` / `resolveRateLimitKey` / `SharedTokenBucketLimiter` | the server-level inbound limiter (#5006, #4910 Q3=C / Q4=B) |
 * | `cacheTtl` | a `Cache-Control` response header, nothing more | — |
 *
 * `cacheTtl` is header semantics ONLY. #5091 narrowed the design's original
 * server-side cache out of scope on purpose: a cache needs an invalidation
 * story, and inventing one for a key whose vocabulary says four words
 * ("Response cache TTL in seconds") is how a runtime dialect is born. A header
 * is the part of the meaning the vocabulary actually fixes.
 *
 * ## Why this is a pure function over explicit deps
 *
 * No service lookup happens in here — the caller passes what it resolved. That
 * keeps the whole policy chain testable against stubs (every case below is), and
 * it keeps the "which kernel / which environment" question where it already
 * lives, in the dispatch seam.
 *
 * ## Order: rate limit BEFORE auth. This is not an accident.
 *
 * #5040 §3 fixes the order as `rateLimit → authRequired → cacheTtl`, and the
 * rationale is worth restating where the code is: the traffic that most needs
 * metering — credential stuffing, token spraying, scraping — is exactly the
 * traffic that will be answered 401. Gating first and metering second would let
 * a scanner make unlimited attempts for free, because none of them would ever
 * reach the meter. So a denied request DOES spend a token. That is the point of
 * the budget, not a leak in it.
 *
 * Resolving WHO is calling is not the same act as gating on it: the principal is
 * looked up first (it keys the bucket — a real session must not share a bucket
 * with anonymous traffic from the same address), then the meter runs, then the
 * gate. One lookup, used twice.
 *
 * ## Live on a real deployment
 *
 * The #5040 E7 flip (`packages/spec/src/api/endpoint-publish-gate.ts`) ended
 * the wholesale refusal of a non-empty `apis:`, so these keys now gate real
 * traffic: `api-endpoint-step.ts` applies this chain on every match, and the
 * showcase's two declared endpoints exercise it over a socket
 * (`packages/qa/dogfood/test/showcase-declarative-endpoints.dogfood.test.ts`
 * pins that `authRequired` denies anonymous and `cacheTtl` reaches the wire).
 * The tests below still drive this module directly — a pure function over
 * explicit deps is worth testing as one.
 */

import {
    ANONYMOUS_DENY_CODE,
    ANONYMOUS_DENY_MESSAGE,
    ANONYMOUS_DENY_STATUS,
    shouldDenyAnonymous,
} from '@objectstack/core';
import { createLazyCounterStore, type CounterStore } from '@objectstack/plugin-auth/rate-limit-storage';
import type { ApiEndpoint } from '@objectstack/spec/api';

import { apiErrorResponse, type ApiErrorEnvelope } from './error-envelope.js';
import {
    deriveBucketConfig,
    resolveRateLimitKey,
    SharedTokenBucketLimiter,
    type RateLimitLogger,
} from './security/inbound-rate-limit.js';

/** Headers as every adapter delivers them. */
export type HeaderBag = Record<string, string | string[] | undefined>;

/**
 * The bucket-key namespace for endpoint-level budgets.
 *
 * The server-level limiter (#5006) keys its buckets `principal:…` / `ip:…` with
 * no prefix. Prefixing here is what makes the two budgets INDEPENDENT rather
 * than one budget counted twice: the server-level middleware is the deployment's
 * global floor, an endpoint's `rateLimit` is that endpoint's own business quota,
 * and a request that passes through both spends one token in each. Sharing a
 * keyspace would silently halve whichever budget was smaller.
 */
export const ENDPOINT_BUCKET_PREFIX = 'apiep:';

/** Bucket key for one endpoint × one caller. Spelled once; asserted in tests. */
export function endpointBucketKey(endpointName: string, callerKey: string): string {
    return `${ENDPOINT_BUCKET_PREFIX}${endpointName}:${callerKey}`;
}

/**
 * Per-endpoint limiters over ONE shared counter store.
 *
 * A limiter is a bucket CONFIG plus a store handle, so one per endpoint is the
 * right granularity — the per-caller keyspace lives inside the store, not here.
 * The cache key includes the derived config, so re-publishing an endpoint with a
 * different budget yields a different limiter without needing an invalidation
 * hook to be wired and remembered; a stale entry cannot outlive its declaration
 * because it is no longer reachable by key.
 */
export interface EndpointRateLimiterRegistry {
    /**
     * The limiter for this endpoint, or `null` when the endpoint declares no
     * `rateLimit` or declares it with `enabled: false` (the schema default).
     *
     * Throws when the endpoint declares an ARMED budget that cannot be honoured
     * (`maxRequests` / `windowMs` ≤ 0). Failing closed is deliberate: the
     * alternative is serving traffic that the author asked to be metered and
     * which silently is not. #5040 E7's publish gate is where an author should
     * meet this, with a prescription, before anything is deployed.
     */
    limiterFor(endpoint: Pick<ApiEndpoint, 'name' | 'rateLimit'>): SharedTokenBucketLimiter | null;
}

export interface EndpointRateLimiterRegistryOptions {
    /** Resolve the kernel `cache` service. Called per consume — ADR-0069 D2 / #4772. */
    resolveCache: () => Promise<CounterStore | undefined>;
    logger?: RateLimitLogger;
    /** Injectable clock — tests only. */
    now?: () => number;
}

export function createEndpointRateLimiterRegistry(
    opts: EndpointRateLimiterRegistryOptions,
): EndpointRateLimiterRegistry {
    // ONE store handle for every endpoint bucket: the degraded-mode warning
    // ("no shared cache, so the effective limit is budget × nodes") is announced
    // once per process rather than once per declared endpoint.
    const resolveStore = createLazyCounterStore({
        resolveCache: opts.resolveCache,
        ...(opts.logger ? { logger: opts.logger as { info?(m: string): void; warn?(m: string): void } } : {}),
        subject: 'declarative endpoint rate-limit buckets',
        degradedImpact:
            'Until a shared cache is registered each node meters endpoint budgets on its own, so the effective '
            + 'limit is the declared budget MULTIPLIED BY the number of nodes, and nothing about the deployment '
            + 'will look wrong.',
        logPrefix: '[dispatcher]',
    });

    const limiters = new Map<string, SharedTokenBucketLimiter>();

    return {
        limiterFor(endpoint) {
            let config;
            try {
                config = deriveBucketConfig(endpoint.rateLimit);
            } catch (err) {
                // `deriveBucketConfig`'s message names `server.security.rateLimit`
                // — right rule, wrong noun for an endpoint declaration. Rethrown
                // with the authoring surface the reader actually edits, rather
                // than duplicating the validation itself.
                throw new Error(
                    `Endpoint '${endpoint.name}' declares an unusable \`rateLimit\`: ${(err as Error).message} `
                    + '(the same rule as the server-level budget; write it on the endpoint, or drop `enabled: true` '
                    + 'to leave the endpoint unmetered).',
                );
            }
            if (!config) return null;

            const cacheKey = `${endpoint.name} ${config.capacity} ${config.refillPerSec}`;
            let limiter = limiters.get(cacheKey);
            if (!limiter) {
                limiter = new SharedTokenBucketLimiter(config, resolveStore, opts.now ?? Date.now);
                limiters.set(cacheKey, limiter);
            }
            return limiter;
        },
    };
}

/** Everything the policy chain needs that it cannot derive from the endpoint. */
export interface EndpointPolicyContext {
    /** Request headers, as the transport reports them. */
    headers?: HeaderBag;
    /** The transport's peer address (`IHttpRequest.remoteAddress`). */
    remoteAddress?: string;
    /**
     * Resolve the caller's principal id from headers — the same
     * `resolveSessionPrincipalId` lookup the server-level limiter and the
     * dispatcher's own route mounts use. `undefined` means anonymous, which is a
     * normal outcome, never an error.
     */
    resolvePrincipalId?: (headers: HeaderBag) => Promise<string | undefined>;
    /** Per-endpoint limiters. Required: an armed budget with nowhere to count is a wiring bug, not a config. */
    limiters: EndpointRateLimiterRegistry;
    /** `server.trustProxy` — believe forwarded headers when keying by address. */
    trustProxy?: boolean;
    logger?: RateLimitLogger;
}

export interface EndpointPolicyInput extends EndpointPolicyContext {
    /** The matched endpoint, ALREADY parsed — `authRequired` is materialized. */
    endpoint: ApiEndpoint;
    /** Request method as the transport reports it. */
    method: string;
}

export type EndpointPolicyVerdict =
    | {
        verdict: 'pass';
        /** Who the request was attributed to, so the executor need not ask twice. */
        principalId?: string;
        /**
         * Headers for the endpoint's eventual SUCCESS answer — today only
         * `Cache-Control`, from `cacheTtl`. Handed back rather than applied
         * because the thing being described (the response body) does not exist
         * yet: execution lands with #5040 E5, and telling a client to cache a
         * 501 for a minute would be worse than saying nothing.
         */
        responseHeaders: Record<string, string>;
    }
    | {
        verdict: 'deny';
        status: number;
        body: { success: false; error: ApiErrorEnvelope };
        /** Headers that are part of the denial (`Retry-After` on a 429). */
        headers?: Record<string, string>;
    };

/**
 * `cacheTtl` → the `Cache-Control` header for a successful response.
 *
 * The vocabulary fixes the unit (seconds) and nothing else, so the rest is
 * stated here, tested, and documented rather than left to a reader's guess:
 *
 *  - **absent** → no header at all. The runtime says nothing about caching, as
 *    it does for every other surface today. "Nothing declared" must not become
 *    an opinion nobody wrote.
 *  - **> 0** → `private, max-age=<ttl>`. `private` is a SECURITY rule, not a
 *    tuning choice, and it holds even for `authRequired: false` endpoints: any
 *    response can be RLS-trimmed for whoever happens to be authenticated, so a
 *    shared cache must never store one and hand it to somebody else. (The
 *    design's per-principal cache key, #5040 §3.3, is the same rule one layer
 *    down; with no server-side cache this is where it survives.)
 *  - **0 or negative** → `no-store`. An author who writes `cacheTtl: 0` said
 *    something; making it identical to saying nothing is exactly the silent
 *    no-op this program exists to remove. (E7's publish gate should reject a
 *    NEGATIVE ttl outright — noted on #5111 — but the runtime still has to
 *    answer coherently if one arrives.)
 *  - **non-GET** → no header, plus a `warn` naming the endpoint. `cacheTtl` is
 *    GET-only (#5040 §3.3) and E7 rejects the combination at publish; until
 *    then the runtime refuses to invent a meaning for it, and says so out loud
 *    instead of dropping it silently.
 */
export function computeCacheControl(
    endpoint: Pick<ApiEndpoint, 'name' | 'cacheTtl'>,
    method: string,
    logger?: RateLimitLogger,
): string | undefined {
    const ttl = endpoint.cacheTtl;
    if (ttl === undefined || ttl === null) return undefined;

    if (method.toUpperCase() !== 'GET') {
        logger?.warn?.(
            `[dispatcher] endpoint '${endpoint.name}' declares \`cacheTtl\` on a ${method.toUpperCase()} endpoint. `
            + '`cacheTtl` is GET-only (#5040 §3.3) and no Cache-Control header will be sent. Remove the key, or '
            + 'declare the endpoint as GET.',
        );
        return undefined;
    }

    if (!Number.isFinite(ttl) || ttl <= 0) return 'no-store';
    return `private, max-age=${Math.floor(ttl)}`;
}

/**
 * The anonymous 401 this seam answers: the same DECISION, {@link ANONYMOUS_DENY_CODE}
 * and {@link ANONYMOUS_DENY_MESSAGE} as every other seam — in the **dispatcher's**
 * envelope, `{ success: false, error: { code, message, httpStatus } }`, which is
 * what `apiErrorResponse` builds.
 *
 * NOT the platform's only 401 body, and this comment used to say it was ("same
 * code, same message, same envelope"). The REST seam — `@objectstack/rest`'s
 * `enforceAuth`, writing `ANONYMOUS_DENY_BODY` — answers the flat
 * `{ error, message }`. Both envelopes are live and sanctioned by ADR-0112's
 * 2026-07-30 amendment (#4007); converging them is a breaking wire change owned
 * by the envelope-convergence line (#3843 family), not by this function. The
 * full two-envelope table lives on `ANONYMOUS_DENY_BODY`
 * (`@objectstack/core`, `security/anonymous-deny.ts`), narrowed there by #5632
 * — this was the same claim surviving on the side that PRODUCES the wrapper,
 * where it reads as authoritative (#5800).
 */
function anonymousDenial(): EndpointPolicyVerdict {
    const { status, body } = apiErrorResponse({
        code: ANONYMOUS_DENY_CODE,
        httpStatus: ANONYMOUS_DENY_STATUS,
        message: ANONYMOUS_DENY_MESSAGE,
    });
    return { verdict: 'deny', status, body };
}

/**
 * Run the policy chain for one matched endpoint.
 *
 * Returns `pass` (with the headers the eventual answer should carry) or the
 * `deny` answer to write. It never executes anything: the target runs after
 * this, and only after this.
 */
export async function applyEndpointPolicies(input: EndpointPolicyInput): Promise<EndpointPolicyVerdict> {
    const { endpoint, method, limiters, logger } = input;

    // ── ⓪ WHO is calling ────────────────────────────────────────────────
    // A lookup, not a gate. It keys the bucket in ① and answers the question
    // in ②; asking twice is how two seams start disagreeing about who counts as
    // authenticated (the reason `resolveSessionPrincipalId` is a module).
    let principalId: string | undefined;
    if (input.resolvePrincipalId) {
        try {
            principalId = await input.resolvePrincipalId(input.headers ?? {});
        } catch {
            // Unresolvable identity is ANONYMOUS, not an error — same rule as
            // the server-level limiter. `authRequired` below still denies it, so
            // an auth hiccup costs a caller a 401, never an outage.
            principalId = undefined;
        }
    }

    // ── ① rateLimit ─────────────────────────────────────────────────────
    const limiter = limiters.limiterFor(endpoint);
    if (limiter) {
        const { key } = resolveRateLimitKey({
            ...(principalId ? { principalId } : {}),
            headers: input.headers ?? {},
            ...(input.remoteAddress ? { remoteAddress: input.remoteAddress } : {}),
            trustProxy: input.trustProxy === true,
        });

        let decision;
        try {
            decision = await limiter.consume(endpointBucketKey(endpoint.name, key));
        } catch {
            // The one fail-open, bounded exactly as #5006 bounds it: a counter
            // store that throws means the cache backend is erroring, which is a
            // louder problem than an unmetered request — and taking the API down
            // with it would be the wrong trade.
            decision = undefined;
        }

        if (decision && !decision.allowed) {
            const retryAfterSec = Math.max(1, Math.ceil(decision.retryAfterMs / 1000));
            // Same body, same message, same details as the server-level 429
            // (`createInboundRateLimitMiddleware`) — one 429 on this wire
            // surface, whichever budget produced it. No explicit `code`: it is
            // derived from the status by `standardErrorCodeForHttpStatus`,
            // exactly as it is there.
            const { status, body } = apiErrorResponse({
                message: 'Rate limit exceeded. Retry after the interval in the Retry-After header.',
                httpStatus: 429,
                details: { retryAfterSeconds: retryAfterSec, resetAt: new Date(decision.resetAt).toISOString() },
            });
            return { verdict: 'deny', status, body, headers: { 'Retry-After': String(retryAfterSec) } };
        }
    }

    // ── ② authRequired ──────────────────────────────────────────────────
    // The key arrives MATERIALIZED (`ApiEndpointSchema` defaults it to `true`),
    // so there is no "omitted" state to read here: forgetting the key gets the
    // safe answer, and `authRequired: false` — the only way to open an endpoint
    // — is a visible line in a diff.
    //
    // ⚠️ The request PATH is deliberately not passed to `shouldDenyAnonymous`.
    // Its optional path argument exempts control-plane paths, and
    // `isAuthGateAllowlisted` treats ANY path containing an `/auth/` segment as
    // one. An app-declared `/api/v1/apps/<ns>/auth/callback` would therefore
    // exempt itself from its own `authRequired: true` — an authoring-time
    // bypass of the platform's default deny. Omitting the argument means no
    // exemption can be reached from a declared path at all.
    if (endpoint.authRequired !== false) {
        if (shouldDenyAnonymous({ userId: principalId, isSystem: false, method })) {
            return anonymousDenial();
        }
    }

    // ── ③ cacheTtl ──────────────────────────────────────────────────────
    const cacheControl = computeCacheControl(endpoint, method, logger);

    return {
        verdict: 'pass',
        ...(principalId ? { principalId } : {}),
        responseHeaders: cacheControl ? { 'Cache-Control': cacheControl } : {},
    };
}
