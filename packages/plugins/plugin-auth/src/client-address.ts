// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The client-address trust rule: the ONE answer to "which address made this
 * request", for every consumer that keys a decision on it.
 *
 * ## The rule
 *
 *  - `X-Forwarded-For` (its leftmost entry), then `X-Real-IP`, are believed
 *    **only** when the deployment declares `server.trustProxy`. Untrusted,
 *    those headers are caller input, and a decision keyed on them is a decision
 *    the caller makes.
 *  - Otherwise the address is the transport's own peer address
 *    (`IHttpRequest.remoteAddress`, `@objectstack/spec` `contracts/http-server.ts`),
 *    which a client cannot influence.
 *  - Neither available ⇒ `undefined`: the address is UNDETERMINED. This never
 *    fabricates a value and never substitutes a header for the peer silently.
 *    What "undetermined" means is each consumer's own deliberate decision, made
 *    where the consumer is: the inbound rate limiter keys one shared bucket
 *    (over-throttling rather than failing open), and the ADR-0069 D5 allow-list
 *    refuses the request.
 *
 * ## Consumers (each hands over the same three facts)
 *
 *  - `@objectstack/runtime` `security/inbound-rate-limit.ts` `resolveRateLimitKey`:
 *    the key of an anonymous caller's bucket.
 *  - `AuthManager.resolveClientAddress` (this package): the address the
 *    ADR-0069 D5 allow-list judges and the D7 login audit stamps as
 *    `last_login_ip` — and the only address `AuthManager.handleRequest` hands
 *    the vendored auth library's own reader (`client-address-vendor.ts`).
 *
 * ## Why it lives here
 *
 * `@objectstack/runtime` depends on this package (it already counts through the
 * `./rate-limit-storage` entry), so the rule cannot stay in the runtime and be
 * read from plugin-auth: that would close a dependency cycle. It moved here
 * unchanged and the runtime imports it back. It is published as its own
 * `./client-address` subpath entry, like `./rate-limit-storage`, so the runtime
 * reaches it without loading the better-auth family (see `tsup.config.ts`).
 * ⛔ Keep this module free of imports: a value import here becomes a load-time
 * dependency of every consumer of the entry.
 */

/**
 * The forwarded headers the rule reads, in the order it believes them, and
 * only when the deployment declares `server.trustProxy`: `X-Forwarded-For`
 * (its leftmost entry), then `X-Real-IP`. Lower-cased, as every adapter
 * delivers them. {@link resolveClientAddress} reads exactly this list, so a
 * seam that builds a request of its own from one it was handed — an
 * in-process re-dispatch — carries the facts the rule reads by iterating it,
 * never a hand-copied set of names (#24877).
 */
export const FORWARDED_CLIENT_ADDRESS_HEADERS: readonly string[] = Object.freeze(['x-forwarded-for', 'x-real-ip']);

/** The three facts the rule decides from. */
export interface ClientAddressInput {
  /** Request headers, lower-cased as every adapter delivers them. */
  headers?: Record<string, string | string[] | undefined>;
  /** The transport's peer address (`IHttpRequest.remoteAddress`). */
  remoteAddress?: string;
  /** `server.trustProxy`: believe forwarded headers. */
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
  // `X-Forwarded-For: client, proxy1, proxy2`: the LEFTMOST entry is the
  // original client. It is also the entry a client controls, which is exactly
  // why reading it at all requires `trustProxy`.
  const first = value.split(',')[0]?.trim();
  return first ? first : undefined;
}

/**
 * The address the server has established for this request, or `undefined`
 * when it has established none. See the module header for the rule.
 */
export function resolveClientAddress(input: ClientAddressInput): string | undefined {
  let forwarded: string | undefined;
  if (input.trustProxy) {
    for (const name of FORWARDED_CLIENT_ADDRESS_HEADERS) {
      forwarded = firstHeader(input.headers, name);
      if (forwarded !== undefined) break;
    }
  }
  const address = forwarded ?? input.remoteAddress;
  return address ? address : undefined;
}
