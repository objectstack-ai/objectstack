// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { ResilientFetchOptions } from '../shared/resilient-fetch';
import { RetryConfigSchema, type RetryConfig } from './connector.zod';
import type { ConnectorRequestSigner } from './connector-provider';

/**
 * Re-exported so the type this module's return value has is nameable from the
 * entry that leaks it (`@objectstack/spec/integration`): a consumer writing an
 * un-annotated `export const opts = connectorFetchOptions(…)` gets TS2883
 * otherwise. ONE declaration, re-exported — `@objectstack/spec/shared` remains
 * where it is declared.
 */
export type { ResilientFetchOptions } from '../shared/resilient-fetch';

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
 * | `retryConfig.maxAttempts` | `retries` | see the reading below |
 * | `retryConfig.initialDelayMs` | `backoffBaseMs` | |
 * | `retryConfig.backoffMultiplier` | `backoffMultiplier` | |
 * | `retryConfig.maxDelayMs` | `maxDelayMs` | capped after jitter, so it is a real maximum |
 * | `retryConfig.jitter` | `jitter` | |
 * | `retryConfig.retryableStatusCodes` | `retryableStatus` | the list becomes the predicate |
 * | `retryConfig.retryOnNetworkError` | `retryOnNetworkError` | |
 * | `requestTimeoutMs` | `timeoutMs` | per-attempt deadline |
 *
 * ## `maxAttempts` counts TOTAL calls, the first one included
 *
 * ⛔ Not "retries after the first" — that is `maxRetries`, a **different key on
 * a different schema**, and the two names differ precisely because the counting
 * base does. `content/docs/automation/flows.mdx` states this contrast for
 * authors in as many words: "A connector's `retryConfig` counts attempts the
 * other way round: its `maxAttempts` **includes** the first attempt, so
 * `maxAttempts: 3` is `maxRetries: 2` here". Two more readings agree: the
 * wrapper's own `retries` is documented "Total attempts including the first"
 * and defaults to 3, which is exactly this key's default — they line up only
 * under this reading — and `shared/retry-policy.zod.ts` converged the
 * `maxRetries` family on purpose, leaving the differently-named key alone.
 *
 * Hence `retries = maxAttempts`, one to one. The degenerate `maxAttempts: 0`
 * that `min(0)` admits needs no arithmetic here: `resilientFetch` already
 * floors its attempt count at 1, so a connector still makes its one call and
 * never retries — ONE owner for that floor, not a second one in this mapping.
 *
 * ## ⚠️ `connectionTimeoutMs` was never mapped here, and is now RETIRED
 *
 * Measured at the fetch site rather than assumed: a connector's outbound call is
 * a WHATWG `fetch`, whose only cancellation surface is one `AbortSignal`
 * covering the whole operation. Nothing in that interface observes the
 * connection phase separately, so a connect-only bound is not expressible —
 * bounding "time until the response arrives" with it would kill a slow-but-
 * connected upstream that the author meant to allow via a large
 * `requestTimeoutMs`, i.e. it would break the very promise it claims to keep.
 * (Node's undici exposes `connectTimeout` through a custom dispatcher, but that
 * is Node-only and a new subsystem underneath every connector.)
 *
 * That measurement is what made this an ADR-0049 removal rather than an
 * implementation: the key is gone from `ConnectorSchema` (a `retiredKey()`
 * tombstone) and from `ConnectorProviderContext`, so the absent row above is no
 * longer a declared-but-unmapped key — there is nothing left to map. ⛔ Do not
 * "restore" it by aliasing a connect deadline onto `timeoutMs`: two keys that
 * silently mean one thing is the declared-not-enforced shape this mapping
 * exists to remove, and it is the shape the retirement just closed.
 *
 * ## A `signed` instance is signed per ATTEMPT, here (ADR-0143 D2.3)
 *
 * `resilientFetch` re-sends a request on a retryable status or a network
 * error. A request signature carries a timestamp and a nonce, and an upstream
 * refuses one it has seen (Alibaba Cloud's `x-acs-signature-nonce` is
 * single-use), so a signature computed once and replayed on the retry would
 * turn every transient blip into an authentication failure. Handing a
 * {@link ConnectorRequestSigner} to {@link connectorFetchOptions} wraps the
 * fetch the wrapper calls, so EVERY attempt is signed fresh — and this stays
 * the one site that does it for both built-in HTTP connectors, rather than one
 * copy per connector package. {@link readConnectorResponse} is the matching
 * one site for the response half: a scheme's `verifyResponse` runs over the
 * raw body before anything is parsed or returned.
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
  signer?: ConnectorRequestSigner,
): ResilientFetchOptions {
  const opts: ResilientFetchOptions = { ...base };
  if (signer) opts.fetchImpl = signingFetch(signer, base.fetchImpl);
  if (policy.requestTimeoutMs !== undefined) opts.timeoutMs = policy.requestTimeoutMs;
  if (policy.retryConfig === undefined) return opts;

  // Parse rather than read raw: the defaults an author relies on
  // (`maxAttempts: 3`, `[408, 429, 500, 502, 503, 504]`, …) are declared on the
  // schema, and this keeps them declared in exactly one place.
  const retry = RetryConfigSchema.parse(policy.retryConfig);
  const codes: number[] = retry.retryableStatusCodes;

  opts.strategy = retry.strategy;
  opts.retries = retry.maxAttempts;
  opts.backoffBaseMs = retry.initialDelayMs;
  opts.backoffMultiplier = retry.backoffMultiplier;
  opts.maxDelayMs = retry.maxDelayMs;
  opts.jitter = retry.jitter;
  opts.retryOnNetworkError = retry.retryOnNetworkError;
  opts.retryableStatus = (status: number): boolean => codes.includes(status);
  return opts;
}

/**
 * A fetch that signs each call with `signer` before sending it through
 * `fetchImpl` (the global `fetch` when absent). `resilientFetch` calls it once
 * per attempt, which is what makes a retry carry a fresh signature.
 *
 * Only the URL-plus-init form is signed: a `Request` object carries its own
 * method, headers and body where this wrapper cannot see them, and a body that
 * is not text cannot be canonicalised — both are refused rather than sent with
 * a signature over something else.
 */
function signingFetch(signer: ConnectorRequestSigner, fetchImpl: typeof fetch | undefined): typeof fetch {
  return async (input, init = {}) => {
    const doFetch = fetchImpl ?? (globalThis.fetch as typeof fetch | undefined);
    if (!doFetch) {
      throw new Error('connectorFetchOptions: no fetch implementation (pass fetchImpl or run on a fetch-capable runtime)');
    }
    if (typeof input !== 'string' && !(input instanceof URL)) {
      throw new Error(`connector '${signer.connector}': a signed request is sent as a URL and its init, not as a Request object`);
    }
    const body = init.body ?? undefined;
    if (body !== undefined && typeof body !== 'string') {
      throw new Error(`connector '${signer.connector}': a signed request's body must be text, so the signature can cover it`);
    }
    const url = typeof input === 'string' ? input : input.href;
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((value, name) => { headers[name] = value; });
    const signature = await signer.sign({
      method: (init.method ?? 'GET').toUpperCase(),
      url,
      headers: { ...headers },
      ...(body === undefined ? {} : { body }),
    });
    // `Headers` hands names back lower-cased, so lower-casing the signer's
    // makes a signer header REPLACE a same-named request header, never sit
    // beside it.
    for (const [name, value] of Object.entries(signature.headers)) headers[name.toLowerCase()] = value;
    return doFetch(signature.url ?? url, { ...init, headers });
  };
}

/** What a built-in HTTP connector's action answers: the upstream's status, and its body parsed when JSON. */
export interface ConnectorHttpResult extends Record<string, unknown> {
  status: number;
  ok: boolean;
  body: unknown;
}

/**
 * Read a connector response into {@link ConnectorHttpResult} — the body parsed
 * when the upstream advertises JSON, its text otherwise, so a non-JSON
 * endpoint does not throw.
 *
 * With a `signer` whose scheme verifies responses, the raw body is read first
 * and handed to `verifyResponse` before anything is parsed: a response that
 * fails verification throws here, and its body never reaches the flow.
 * Without one, this is exactly the read both built-in HTTP connectors always
 * made.
 */
export async function readConnectorResponse(
  response: Response,
  signer?: ConnectorRequestSigner,
): Promise<ConnectorHttpResult> {
  const json = (response.headers.get('content-type') ?? '').includes('application/json');
  if (!signer?.verifyResponse) {
    const body: unknown = json ? await response.json() : await response.text();
    return { status: response.status, ok: response.ok, body };
  }
  const raw = await response.text();
  await signer.verifyResponse({ status: response.status, headers: response.headers, body: raw });
  return { status: response.status, ok: response.ok, body: json ? JSON.parse(raw) as unknown : raw };
}
