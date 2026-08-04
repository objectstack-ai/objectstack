// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Inbound rate limiting — the seam between the authored
 * `server.security.rateLimit` budget and a request that actually gets a 429.
 *
 * ## Why this file exists (#4910, #4937, #4686)
 *
 * `packages/spec` declared three `RateLimitConfig` embeddings and the repo had
 * ZERO readers for any of them: an author wrote a budget, it parsed, and nothing
 * happened (#4686). `runtime/security/rate-limit.ts` held a token bucket whose
 * comments claimed, in the present tense, to be wired into the dispatcher — it
 * had no call sites at all (#4937). Two halves of one mechanism, neither
 * touching the other, each documented as if it did.
 *
 * This module is the connective tissue the maintainer adjudicated on
 * 2026-08-03: a NARROW authorable `server:` key (Q1=B), server-level only
 * (Q2=B — endpoint-level `rateLimit` stays knowingly unwired, tracked by
 * #4936), keyed principal-first with IP fallback and forwarded headers believed
 * only under an explicit `trustProxy` (Q3=C), counting in the kernel cache with
 * an announced per-process fallback (Q4=B / ADR-0069 D2).
 *
 * ## Shape of the thing
 *
 * ```
 *  authored budget            derived bucket             per-request
 *  ────────────────           ──────────────             ───────────
 *  { enabled, windowMs,  →   { capacity,          →     resolveRateLimitKey()
 *    maxRequests }             refillPerSec }            → consume() → 429?
 * ```
 *
 * Every key the authoring surface exposes is consumed here — `enabled` arms it,
 * `windowMs` + `maxRequests` size it, `trustProxy` decides whose address counts.
 * That is the per-key liveness bar #4910 set: no key arrives without its reader.
 */

import type { Middleware, IHttpRequest, IHttpResponse } from '@objectstack/core';
import { createLazyCounterStore, type CounterStore } from '@objectstack/plugin-auth';

import { buildApiError } from '../error-envelope.js';
import {
    applyTokenBucket,
    bucketIdleTtlSeconds,
    type BucketState,
    type RateLimitBucketConfig,
    type RateLimitDecision,
} from './rate-limit.js';

/**
 * The authored budget, as it arrives from `server.security.rateLimit`
 * (`@objectstack/spec` `ServerRateLimitConfigSchema`). Restated structurally
 * rather than imported as a type so `packages/runtime` keeps depending on the
 * spec's SHAPE, not on a Zod inference chain.
 */
export interface InboundRateLimitBudget {
    /** Arm the limiter. `false` (the default) leaves every request unmetered. */
    enabled?: boolean;
    /** Budget window in milliseconds. */
    windowMs?: number;
    /** Requests permitted per window. */
    maxRequests?: number;
}

/**
 * Derive the token bucket from an authored budget.
 *
 * The mapping (#4686's, confirmed against `RateLimitConfigSchema` on
 * `origin/main`):
 *
 *   capacity     = maxRequests                        — a full bucket absorbs
 *                                                       one whole window's worth
 *                                                       of traffic as a burst
 *   refillPerSec = maxRequests / (windowMs / 1000)    — and sustains exactly the
 *                                                       declared long-run rate
 *
 * Returns `null` when the budget is absent or `enabled` is not set — "not
 * armed" is a normal state, not an error.
 *
 * Throws when the budget is armed but unusable. `maxRequests: 0` or
 * `windowMs: 0` would produce a bucket that can never admit anything or a
 * division by zero, and the schema's `.int()` alone does not exclude them. The
 * error is prescriptive because it surfaces at boot, where the author can still
 * act on it — silently clamping to a default would be the "parses, then does
 * something other than what you wrote" failure this whole issue exists to end.
 */
export function deriveBucketConfig(budget: InboundRateLimitBudget | undefined): RateLimitBucketConfig | null {
    if (!budget?.enabled) return null;

    const maxRequests = budget.maxRequests ?? 100;
    const windowMs = budget.windowMs ?? 60_000;

    if (!Number.isFinite(maxRequests) || maxRequests <= 0) {
        throw new Error(
            `server.security.rateLimit.maxRequests must be greater than 0 (got ${String(budget.maxRequests)}). `
            + 'A zero budget rejects every request including your own health checks; to turn rate limiting off, '
            + 'set `enabled: false` instead.',
        );
    }
    if (!Number.isFinite(windowMs) || windowMs <= 0) {
        throw new Error(
            `server.security.rateLimit.windowMs must be greater than 0 (got ${String(budget.windowMs)}). `
            + 'It is the budget window in MILLISECONDS — 60000 is one minute.',
        );
    }

    return {
        capacity: maxRequests,
        refillPerSec: maxRequests / (windowMs / 1000),
    };
}

/** How a rate-limit key was determined — reported once at boot, and in tests. */
export type RateLimitKeyKind = 'principal' | 'ip' | 'unknown';

export interface RateLimitKeyInput {
    /** Resolved principal id, when the request carried a valid session. */
    principalId?: string;
    /** Request headers, lower-cased as every adapter delivers them. */
    headers?: Record<string, string | string[] | undefined>;
    /** The transport's peer address (`IHttpRequest.remoteAddress`). */
    remoteAddress?: string;
    /** `server.trustProxy` — believe forwarded headers. */
    trustProxy: boolean;
}

function firstHeader(
    headers: Record<string, string | string[] | undefined> | undefined,
    name: string,
): string | undefined {
    if (!headers) return undefined;
    const raw = headers[name] ?? headers[name.toLowerCase()];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value !== 'string') return undefined;
    // `X-Forwarded-For: client, proxy1, proxy2` — the LEFTMOST entry is the
    // original client. It is also the entry a client controls, which is exactly
    // why reading it at all requires `trustProxy`.
    const first = value.split(',')[0]?.trim();
    return first ? first : undefined;
}

/**
 * Q3=C, in code: the bucket is keyed by **who**, and only falls back to
 * **where** when there is no who.
 *
 *  - a resolved principal keys its own bucket, so one abusive session cannot
 *    spend another user's budget, and a user behind a shared NAT is not
 *    throttled by their neighbours;
 *  - anonymous traffic — credential stuffing, scraping, the traffic that most
 *    needs a limit and has no identity yet — keys off the caller address;
 *  - that address comes from `X-Forwarded-For` / `X-Real-IP` **only** when
 *    `server.trustProxy` was declared. Untrusted, those headers are attacker
 *    input: honouring them by default would let anyone mint unlimited buckets
 *    (bypass) or drain a chosen victim's (weaponise). Undeclared, the address is
 *    the transport peer, which a client cannot influence.
 *
 * When neither is available (a runtime that exposes no peer address, no trusted
 * header) the key is a single shared `ip:unknown` bucket. That deliberately
 * over-throttles rather than failing open: an unlimited unknown is the one
 * outcome a rate limiter must never produce, and the caller announces the
 * condition once — see {@link createInboundRateLimitMiddleware}.
 */
export function resolveRateLimitKey(input: RateLimitKeyInput): { key: string; kind: RateLimitKeyKind } {
    if (input.principalId) return { key: `principal:${input.principalId}`, kind: 'principal' };

    const forwarded = input.trustProxy
        ? firstHeader(input.headers, 'x-forwarded-for') ?? firstHeader(input.headers, 'x-real-ip')
        : undefined;
    const address = forwarded ?? input.remoteAddress;

    if (address) return { key: `ip:${address}`, kind: 'ip' };
    return { key: 'ip:unknown', kind: 'unknown' };
}

/** The stored bucket envelope. Private to this module — every read goes through {@link parseBucket}. */
interface StoredBucket {
    /** tokens */
    t: number;
    /** lastRefill (epoch ms) */
    r: number;
}

/**
 * Read back a bucket envelope. Cache adapters differ on whether a value comes
 * back as the stored string (Redis) or the original object (memory), so both
 * are accepted; anything else is treated as absent, which restarts the bucket
 * full rather than throwing on a live request. Same tolerance, and the same
 * reason, as `plugin-auth`'s `parseCounter`.
 */
function parseBucket(raw: unknown): BucketState | undefined {
    if (raw === undefined || raw === null) return undefined;
    let value: unknown = raw;
    if (typeof raw === 'string') {
        try { value = JSON.parse(raw); } catch { return undefined; }
    }
    if (typeof value !== 'object' || value === null) return undefined;
    const { t, r } = value as Partial<StoredBucket>;
    if (typeof t !== 'number' || !Number.isFinite(t)) return undefined;
    if (typeof r !== 'number' || !Number.isFinite(r)) return undefined;
    return { tokens: t, lastRefill: r };
}

/**
 * A token bucket whose state lives in a {@link CounterStore} — the kernel
 * `cache` service when one is registered, a bounded per-process map otherwise.
 *
 * ADR-0069 D2, and the #4772 lesson it was written from: per-instance counters
 * mean the effective limit is `declared × instances`, which is a SILENT
 * under-enforcement — nothing looks wrong, the limit simply is not the limit.
 * The store is resolved at CONSUME time, never at plugin init, because a cache
 * plugin can register after this one (that exact ordering bug is #4772).
 *
 * Like plugin-auth's fixed-window counter this stays read-modify-write in the
 * absence of an atomic primitive, so two nodes can both admit a request at the
 * boundary and the limit can over-admit slightly under concurrency. That is
 * strictly better than counting per node, and the day `ICacheService` grows an
 * atomic increment this is where it plugs in.
 */
export class SharedTokenBucketLimiter {
    constructor(
        private readonly config: RateLimitBucketConfig,
        private readonly resolveStore: () => Promise<CounterStore>,
        private readonly now: () => number = Date.now,
    ) {}

    async consume(key: string, cost = this.config.defaultCost ?? 1): Promise<RateLimitDecision> {
        const store = await this.resolveStore();
        const now = this.now();
        const current = parseBucket(await store.get<unknown>(key));
        const { state, decision } = applyTokenBucket(current, this.config, now, cost);
        const envelope: StoredBucket = { t: state.tokens, r: state.lastRefill };
        await store.set(key, JSON.stringify(envelope), bucketIdleTtlSeconds(this.config));
        return decision;
    }
}

/** Minimal logger surface — matches the kernel logger without importing it. */
export interface RateLimitLogger {
    info?(message: string, meta?: unknown): void;
    warn?(message: string, meta?: unknown): void;
}

export interface InboundRateLimitOptions {
    /** The authored `server.security.rateLimit` budget. */
    budget?: InboundRateLimitBudget;
    /** The authored `server.trustProxy`. */
    trustProxy?: boolean;
    /**
     * Resolve the caller's principal id from request headers. Returning
     * `undefined` means anonymous, which is a normal outcome and keys by IP.
     */
    resolvePrincipalId?: (headers: Record<string, string | string[] | undefined>) => Promise<string | undefined>;
    /** Resolve the kernel `cache` service. Called per consume — see ADR-0069 D2. */
    resolveCache: () => Promise<CounterStore | undefined>;
    logger?: RateLimitLogger;
    /** Injectable clock — tests only. */
    now?: () => number;
}

/**
 * HTTP methods that are never metered.
 *
 * A CORS preflight carries no credentials and performs no work; throttling it
 * does not slow an attacker down (they can skip it) but does break every
 * cross-origin caller of a legitimately busy app, in a way that surfaces in the
 * browser as an opaque CORS failure rather than a 429.
 */
const UNMETERED_METHODS = new Set(['OPTIONS']);

/**
 * Build the inbound rate-limit middleware, or `null` when the budget is not
 * armed (so a caller can skip registering anything at all).
 *
 * The 429 body goes through {@link buildApiError} like every other error on
 * this wire surface (#3842), and carries `Retry-After` in seconds — computed
 * from the bucket's own `retryAfterMs`, so the number a client is told to wait
 * is the number the bucket will actually take to refill.
 */
export function createInboundRateLimitMiddleware(opts: InboundRateLimitOptions): Middleware | null {
    const config = deriveBucketConfig(opts.budget);
    if (!config) return null;

    const trustProxy = opts.trustProxy === true;
    const resolveStore = createLazyCounterStore({
        resolveCache: opts.resolveCache,
        ...(opts.logger ? { logger: opts.logger as { info?(m: string): void; warn?(m: string): void } } : {}),
        subject: 'inbound rate-limit buckets',
        degradedImpact:
            'Until a shared cache is registered the effective limit is the declared budget MULTIPLIED BY the number '
            + 'of nodes, and nothing about the deployment will look wrong.',
        logPrefix: '[dispatcher]',
    });
    const limiter = new SharedTokenBucketLimiter(config, resolveStore, opts.now ?? Date.now);

    let unknownKeyWarned = false;

    return async (req: IHttpRequest, res: IHttpResponse, next: () => void | Promise<void>) => {
        if (UNMETERED_METHODS.has(String(req.method ?? '').toUpperCase())) {
            await next();
            return;
        }

        let principalId: string | undefined;
        if (opts.resolvePrincipalId) {
            try {
                principalId = await opts.resolvePrincipalId(req.headers ?? {});
            } catch {
                // Unresolvable identity is anonymous, not an error — the route's
                // own auth gate still runs. Failing the request here would turn
                // an auth hiccup into an outage.
                principalId = undefined;
            }
        }

        const { key, kind } = resolveRateLimitKey({
            ...(principalId ? { principalId } : {}),
            headers: req.headers ?? {},
            ...(req.remoteAddress ? { remoteAddress: req.remoteAddress } : {}),
            trustProxy,
        });

        if (kind === 'unknown' && !unknownKeyWarned) {
            unknownKeyWarned = true;
            // Functional degradation, not durability — the limit is still
            // enforced, just coarsely — so `warn` per the repo's log-level rule.
            opts.logger?.warn?.(
                '[dispatcher] inbound rate limit cannot identify anonymous callers: this transport exposes no peer '
                + 'address and no trusted forwarded header, so ALL anonymous traffic shares ONE bucket and will '
                + 'throttle each other. Fix by terminating on a proxy that sets X-Forwarded-For and declaring '
                + '`server.trustProxy: true`, or by serving through an adapter that reports the socket address.',
            );
        }

        let decision: RateLimitDecision;
        try {
            decision = await limiter.consume(key);
        } catch {
            // A store that throws must not take the API down with it. This is
            // the one fail-open in the file, and it is bounded: it can only
            // happen when the cache backend itself is erroring, at which point
            // the deployment has a louder problem than an unmetered request.
            await next();
            return;
        }

        if (decision.allowed) {
            await next();
            return;
        }

        const retryAfterSec = Math.max(1, Math.ceil(decision.retryAfterMs / 1000));
        res.status(429);
        res.header('Retry-After', String(retryAfterSec));
        res.json({
            success: false,
            error: buildApiError({
                message: 'Rate limit exceeded. Retry after the interval in the Retry-After header.',
                httpStatus: 429,
                details: { retryAfterSeconds: retryAfterSec, resetAt: new Date(decision.resetAt).toISOString() },
            }),
        });
    };
}
