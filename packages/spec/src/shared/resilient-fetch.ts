// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

// Type-only, and deliberately the ONE declaration of this vocabulary rather
// than a second copy of the four strategy words here: `ConnectorRetryStrategy`
// already carries them (and already had to be prefixed to stay distinct from
// `api/errors.zod.ts`'s `RetryStrategy` — ADR-0112 D9a). `import type` is
// erased, so this adds no runtime edge from `shared/` to `integration/`.
import type { ConnectorRetryStrategy } from '../integration/connector.zod';

/**
 * `resilientFetch` — a thin, dependency-free wrapper around `fetch` that gives
 * outbound HTTP calls a **per-attempt timeout** and **bounded exponential
 * backoff** so a slow or rate-limited external API can't hang the caller (e.g. an
 * agent turn) indefinitely with no recovery.
 *
 * Used by the HTTP-based connectors and embedders (`connector-rest`,
 * `connector-slack`, `embedder-openai`). It is intentionally NOT a circuit
 * breaker — that is stateful, per-host, and a separate concern; this fixes the
 * "naked fetch hangs / never retries a transient blip" gap.
 *
 * Behaviour:
 *  - aborts each attempt after `timeoutMs` (default 30s);
 *  - retries on a network error or a retryable status (429 / 5xx) up to
 *    `retries` total attempts (default 3), with exponential backoff + jitter;
 *  - honours a `Retry-After` header (seconds or HTTP-date) on a 429;
 *  - never retries when the **caller's** own `signal` aborts (that's intentional
 *    cancellation, not a transient failure).
 *
 * ## The policy knobs exist so a DECLARED policy can be honoured here
 *
 * `strategy` / `backoffMultiplier` / `maxDelayMs` / `jitter` /
 * `retryOnNetworkError` were added so `connector.retryConfig`
 * (`integration/connector.zod.ts`) has somewhere to land: every one of them is
 * a key an author can already write, and this is the single site that executes
 * them ({@link connectorFetchOptions} in `integration/connector-fetch-policy.ts`
 * is the only mapping). **Each defaults to the behaviour this wrapper already
 * had**, so a caller that passes none is byte-identical to the pre-policy
 * version — the knobs widen what is expressible, they do not re-tune the
 * default path.
 */
export interface ResilientFetchOptions {
    /** fetch implementation (injectable for tests / non-global runtimes). */
    fetchImpl?: typeof fetch;
    /** Per-attempt timeout in ms. Default 30000. */
    timeoutMs?: number;
    /** Total attempts including the first. Default 3. */
    retries?: number;
    /** Base backoff in ms; grown per `strategy` each retry, plus jitter. Default 300. */
    backoffBaseMs?: number;
    /**
     * Shape of the growth between retries. Default `exponential_backoff` — the
     * behaviour this wrapper has always had. `no_retry` makes the first attempt
     * the only one, whatever `retries` says.
     */
    strategy?: ConnectorRetryStrategy;
    /** Growth factor for `exponential_backoff`. Default 2. */
    backoffMultiplier?: number;
    /**
     * Ceiling for one backoff delay (ms), applied AFTER jitter so a declared
     * maximum is never exceeded. Default: uncapped.
     *
     * It bounds a `Retry-After` too — but by STOPPING, not by shortening it. A
     * `Retry-After` longer than this ceiling ends the retry loop and the
     * response is returned to the caller, because the two alternatives are both
     * wrong: sleeping it out would make this not a maximum, and retrying sooner
     * than the upstream asked is the abuse `Retry-After` exists to prevent.
     */
    maxDelayMs?: number;
    /** Randomize each delay by +[0,100)ms. Default true (the prior behaviour). */
    jitter?: boolean;
    /**
     * Retry an attempt that THREW — a network failure, or this wrapper's own
     * per-attempt timeout (both arrive as a rejection, and neither carries a
     * status to judge). Default true (the prior behaviour). A caller abort is
     * never retried whatever this says.
     */
    retryOnNetworkError?: boolean;
    /** Predicate for retryable HTTP statuses. Default: 429 or >= 500. */
    retryableStatus?: (status: number) => boolean;
    /** Sleep impl (injectable for deterministic tests). */
    sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRIES = 3;
const DEFAULT_BACKOFF_BASE_MS = 300;
const DEFAULT_BACKOFF_MULTIPLIER = 2;

const defaultRetryable = (status: number): boolean => status === 429 || status >= 500;
const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The resolved delay policy one attempt's backoff is computed from. */
interface DelayPolicy {
    strategy: ConnectorRetryStrategy;
    backoffBaseMs: number;
    backoffMultiplier: number;
    maxDelayMs?: number;
    jitter: boolean;
}

export async function resilientFetch(
    input: string | URL,
    init: RequestInit = {},
    opts: ResilientFetchOptions = {},
): Promise<Response> {
    const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as typeof fetch | undefined);
    if (!fetchImpl) {
        throw new Error('resilientFetch: no fetch implementation (pass opts.fetchImpl or run on a fetch-capable runtime)');
    }
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const strategy = opts.strategy ?? 'exponential_backoff';
    const maxAttempts = strategy === 'no_retry' ? 1 : Math.max(1, opts.retries ?? DEFAULT_RETRIES);
    const delayPolicy: DelayPolicy = {
        strategy,
        backoffBaseMs: opts.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS,
        backoffMultiplier: opts.backoffMultiplier ?? DEFAULT_BACKOFF_MULTIPLIER,
        maxDelayMs: opts.maxDelayMs,
        jitter: opts.jitter ?? true,
    };
    const retryOnNetworkError = opts.retryOnNetworkError ?? true;
    const isRetryable = opts.retryableStatus ?? defaultRetryable;
    const sleep = opts.sleep ?? defaultSleep;
    const callerSignal = init.signal ?? undefined;

    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const controller = new AbortController();
        const onCallerAbort = () => controller.abort((callerSignal as AbortSignal | undefined)?.reason);
        if (callerSignal) {
            if (callerSignal.aborted) controller.abort((callerSignal as AbortSignal).reason);
            else callerSignal.addEventListener('abort', onCallerAbort, { once: true });
        }
        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            controller.abort(new Error(`resilientFetch: request timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        try {
            const res = await fetchImpl(input, { ...init, signal: controller.signal });
            if (isRetryable(res.status) && attempt < maxAttempts) {
                const wait = retryDelayMs(res, attempt, delayPolicy);
                // The upstream asked to be left alone for LONGER than the
                // declared ceiling allows. Both moves left are wrong: waiting
                // it out makes `maxDelayMs` not a maximum, and retrying sooner
                // than asked is the abuse `Retry-After` exists to prevent. So
                // stop retrying and hand the response back — the caller sees
                // the real status (and its `Retry-After`) and decides. Only a
                // `Retry-After` can reach here: `backoffMs` caps its own output.
                if (delayPolicy.maxDelayMs !== undefined && wait > delayPolicy.maxDelayMs) {
                    return res;
                }
                await sleep(wait);
                continue;
            }
            return res;
        } catch (err) {
            lastError = err;
            // The caller cancelled (not our timeout) → propagate, never retry.
            if (callerSignal?.aborted && !timedOut) throw err;
            // A thrown attempt carries no status, so this is the only switch
            // that can decide it (`retryConfig.retryOnNetworkError`).
            if (!retryOnNetworkError) break;
            if (attempt >= maxAttempts) break;
            await sleep(backoffMs(attempt, delayPolicy));
        } finally {
            clearTimeout(timer);
            callerSignal?.removeEventListener?.('abort', onCallerAbort);
        }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/**
 * Backoff for one retry, per the resolved {@link DelayPolicy}, with small
 * jitter to avoid synchronized retries.
 *
 * Order matters and is deliberate: grow, jitter, THEN cap. Capping last is what
 * keeps a declared `maxDelayMs` an actual maximum — jitter is additive, so
 * capping before it would let the delay land up to 99ms above the declared
 * ceiling, which is the declared-not-enforced shape in miniature.
 */
function backoffMs(attempt: number, policy: DelayPolicy): number {
    const { strategy, backoffBaseMs: base, backoffMultiplier, maxDelayMs, jitter } = policy;
    let delay: number;
    switch (strategy) {
        case 'fixed_delay':
            delay = base;
            break;
        case 'linear_backoff':
            delay = base * attempt;
            break;
        // `no_retry` never reaches here (maxAttempts is forced to 1), but the
        // arm keeps the switch exhaustive rather than falling into growth.
        case 'no_retry':
            delay = 0;
            break;
        default:
            delay = base * backoffMultiplier ** (attempt - 1);
    }
    if (jitter) delay += Math.floor(Math.random() * 100);
    return maxDelayMs === undefined ? delay : Math.min(delay, maxDelayMs);
}

/** Retry delay for a response: honour `Retry-After` on 429, else backoff. */
function retryDelayMs(res: Response, attempt: number, policy: DelayPolicy): number {
    const retryAfter = res.headers.get('retry-after');
    if (retryAfter) {
        const secs = Number(retryAfter);
        if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
        const dateMs = Date.parse(retryAfter);
        if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now());
    }
    return backoffMs(attempt, policy);
}
