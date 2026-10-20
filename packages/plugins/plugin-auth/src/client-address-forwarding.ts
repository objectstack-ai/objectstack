// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The forwarding facts the client-address trust rule reads
 * (`./client-address.ts`, ADR-0069 D5/D7), and the one way a request this
 * plugin re-dispatches in-process carries them (#24877).
 *
 * INTERNAL. This module is not on the package's `exports` map, and neither the
 * package root (`index.ts`) nor the published `./client-address` entry
 * re-exports it: nothing outside this package reads the list.
 *
 * ⛔ Keep this module free of imports. The published `./client-address` entry
 * — the lean entry the runtime loads without the better-auth family — imports
 * the list from here, so a value import here would become a load-time
 * dependency of every consumer of that entry.
 */

/**
 * The forwarded headers the rule reads, in the order it believes them, and
 * only when the deployment declares `server.trustProxy`: `X-Forwarded-For`
 * (its leftmost entry), then `X-Real-IP`. Lower-cased, as every adapter
 * delivers them. `resolveClientAddress` reads exactly this list.
 */
export const FORWARDED_CLIENT_ADDRESS_HEADERS: readonly string[] = Object.freeze(['x-forwarded-for', 'x-real-ip']);

/**
 * Carry the forwarding facts the rule reads ({@link FORWARDED_CLIENT_ADDRESS_HEADERS})
 * from the request a bridge serves onto the request it re-dispatches, as the
 * incoming request had them. `AuthManager.handleRequest` judges the
 * re-dispatched request by the rule, so it is judged on the same facts as the
 * request the bridge serves: the forwarded client address behind a declared
 * `server.trustProxy`, the connection peer otherwise, when the rule ignores
 * these headers. The bridges' header builders (`register-sso-provider.ts`,
 * `send-verification-email.ts`, `sys-session-revoke.ts`) call this; none of
 * them names a header itself.
 */
export function carryForwardedClientAddress(from: Headers, to: Headers): void {
  for (const name of FORWARDED_CLIENT_ADDRESS_HEADERS) {
    const value = from.get(name);
    if (value !== null) to.set(name, value);
  }
}
