// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { ResilientFetchOptions } from '../shared/resilient-fetch';
import { RetryConfigSchema, type RetryConfig } from './connector.zod';

/**
 * @module integration/connector-fetch-policy
 *
 * The **one** mapping from a connector's declared resilience policy onto the
 * platform's outbound-HTTP wrapper (`shared/resilient-fetch.ts`). Every
 * built-in HTTP connector routes its one `fetch` through that wrapper, and this
 * function is the only thing that fills its options from authored metadata — so
 * `connector.retryConfig` has exactly one execution site, not one per connector
 * package (Route & surface ownership §1).
 *
 * ## What each declared key becomes
 *
 * | authored key | wrapper option | note |
 * |---|---|---|
 * | `retryConfig.strategy` | `strategy` | the four words are executed, not just parsed |
 * | `retryConfig.maxAttempts` | `retries` (`+ 1`) | see the reading below |
 * | `retryConfig.initialDelayMs` | `backoffBaseMs` | |
 * | `retryConfig.backoffMultiplier` | `backoffMultiplier` | |
 * | `retryConfig.maxDelayMs` | `maxDelayMs` | capped after jitter, so it is a real maximum |
 * | `retryConfig.jitter` | `jitter` | |
 * | `retryConfig.retryableStatusCodes` | `retryableStatus` | the list becomes the predicate |
 * | `retryConfig.retryOnNetworkError` | `retryOnNetworkError` | |
 * | `requestTimeoutMs` | `timeoutMs` | per-attempt deadline |
 *
 * ## `maxAttempts` counts RETRIES, not total calls
 *
 * The key is bounded `min(0)`, and zero total calls is not a thing a connector
 * can do — so `0` can only mean "do not retry", which fixes the count as
 * *attempts after the first*. Its own prose says so too ("Maximum retry
 * attempts"), and the repo already reads a retry count that way: the converged
 * `shared/retry-policy.zod.ts` compares the retired `ETLPipeline.retry`'s
 * `maxAttempts: 3` directly against `maxRetries` (= "retry attempts after the
 * initial one"). Hence `retries = maxAttempts + 1`, `retries` being the
 * wrapper's *total* including the first.
 *
 * ## ⚠️ `connectionTimeoutMs` is deliberately NOT mapped here
 *
 * Measured at the fetch site rather than assumed: a connector's outbound call is
 * a WHATWG `fetch`, whose only cancellation surface is one `AbortSignal`
 * covering the whole operation. Nothing in that interface observes the
 * connection phase separately, so a connect-only bound is not expressible —
 * bounding "time until the response arrives" with it would kill a slow-but-
 * connected upstream that the author meant to allow via a large
 * `requestTimeoutMs`, i.e. it would break the very promise it claims to keep.
 * (Node's undici exposes `connectTimeout` through a custom dispatcher, but that
 * is Node-only and a new subsystem underneath every connector.) So the key
 * stays unenforced and `packages/spec/liveness/connector.json` keeps it `dead`
 * with that reason. ⛔ Do not "fix" this by aliasing it onto `timeoutMs`: two
 * keys that silently mean one thing is the declared-not-enforced shape this
 * mapping exists to remove.
 */

/** The slice of a {@link Connector} this mapping reads. */
export interface ConnectorFetchPolicy {
  /** Declared retry policy. Absent ⇒ the wrapper keeps its own defaults. */
  retryConfig?: RetryConfig;
  /** Declared per-request deadline (ms). Absent ⇒ the wrapper's 30s default. */
  requestTimeoutMs?: number;
}

/**
 * Resolve a connector's declared policy into {@link ResilientFetchOptions}.
 *
 * `base` carries the caller's own injections (`fetchImpl` for a test double,
 * `sleep` for a deterministic clock); the policy wins over nothing in it,
 * because the two sets are disjoint.
 *
 * An absent `retryConfig` returns `base` plus at most `timeoutMs` — the wrapper
 * then behaves exactly as it did before any of this existed, which is what
 * keeps every connector that declares no policy on its current behaviour.
 */
export function connectorFetchOptions(
  policy: ConnectorFetchPolicy,
  base: Pick<ResilientFetchOptions, 'fetchImpl' | 'sleep'> = {},
): ResilientFetchOptions {
  const opts: ResilientFetchOptions = { ...base };
  if (policy.requestTimeoutMs !== undefined) opts.timeoutMs = policy.requestTimeoutMs;
  if (policy.retryConfig === undefined) return opts;

  // Parse rather than read raw: the defaults an author relies on
  // (`maxAttempts: 3`, `[408, 429, 500, 502, 503, 504]`, …) are declared on the
  // schema, and this keeps them declared in exactly one place.
  const retry = RetryConfigSchema.parse(policy.retryConfig);
  const codes: number[] = retry.retryableStatusCodes;

  opts.strategy = retry.strategy;
  opts.retries = retry.maxAttempts + 1;
  opts.backoffBaseMs = retry.initialDelayMs;
  opts.backoffMultiplier = retry.backoffMultiplier;
  opts.maxDelayMs = retry.maxDelayMs;
  opts.jitter = retry.jitter;
  opts.retryOnNetworkError = retry.retryOnNetworkError;
  opts.retryableStatus = (status: number): boolean => codes.includes(status);
  return opts;
}
