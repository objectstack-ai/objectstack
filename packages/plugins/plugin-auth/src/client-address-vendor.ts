// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The vendored auth library's OWN client-address source, held to the
 * platform's client-address trust rule (`./client-address.ts`).
 *
 * ## What reads it
 *
 * better-auth resolves a request's client address with its own reader
 * (`@better-auth/core` `utils/ip`, `getIP`), and in a stock composition three
 * things are keyed on its answer:
 *
 *  - the session row's `ip_address`, and through it the `login` / `logout`
 *    audit rows (`auth-session-audit.ts` copies them from the row) — though
 *    where the server established an address, the `session.create.before`
 *    hook stores that address instead of the reader's answer, which masks an
 *    IPv6 address to its /64 network (`client-address-canonical.ts`);
 *  - the `login_failed` / `account_locked` audit fingerprint, which resolves
 *    the same request the same way on purpose (`signInClientFingerprint`), so
 *    a refused and a successful sign-in from one client carry one address;
 *  - the key of the library's own per-address rate limiter (ADR-0069 D2).
 *
 * That reader knows request headers only. It never sees the transport's peer
 * address and knows nothing of `server.trustProxy`, so left at its default it
 * does not answer the address the server established for the request — the
 * one the ADR-0069 D5 allow-list judges and the D7 login audit stamps.
 *
 * ## How it is held to the rule
 *
 * The library offers no resolver hook. Its option surface is a header list
 * (`advanced.ipAddress.ipAddressHeaders`), a proxy-CIDR list for its own walk
 * of a forwarded chain, and an off switch — and the off switch also turns its
 * rate limiter off, so it cannot express "no address where none exists". So:
 *
 *  1. The library is told to read exactly ONE header, which the platform owns:
 *     {@link VENDOR_CLIENT_ADDRESS_HEADER} ({@link vendorClientAddressOptions}).
 *  2. `AuthManager.handleRequest` — the one door to the library's HTTP
 *     handler — rebuilds every request it hands over with
 *     {@link withVendorClientAddress}: any copy of that header the caller sent
 *     is dropped, and the address the server established
 *     (`resolveClientAddress`, the one rule) is written in its place.
 *
 * Every branch of the rule therefore reaches the library as decided: a declared
 * trusted proxy ⇒ the forwarded client address; no declared trust ⇒ the
 * transport's peer address; neither available ⇒ no header at all, and the
 * library resolves no address. What it does with none is its own behaviour: no
 * session address and one shared rate-limit bucket in production; a loopback
 * placeholder in development and test, where its limiter is off by default.
 *
 * ⛔ Only {@link withVendorClientAddress} writes the header. A seam that hands
 * the library a caller's headers some other way (a programmatic `auth.api.*`
 * call) hands it whatever that caller sent: route such a request through
 * `handleRequest`, never around it.
 */

/** The one request header the vendored library reads a client address from. */
export const VENDOR_CLIENT_ADDRESS_HEADER = 'x-objectstack-client-address';

/**
 * better-auth's `advanced.ipAddress`: read the platform-owned header and
 * nothing else. No `trustedProxies`: the header carries one address the server
 * already decided, never a chain for the library to walk.
 */
export function vendorClientAddressOptions(): { ipAddressHeaders: string[] } {
  return { ipAddressHeaders: [VENDOR_CLIENT_ADDRESS_HEADER] };
}

/**
 * `request` as the vendored library may see it: the caller's copy of
 * {@link VENDOR_CLIENT_ADDRESS_HEADER} dropped, and `address` — the address
 * the server established, or `undefined` when it established none — written in
 * its place. Returns `request` itself only when there is nothing to drop and
 * nothing to write.
 *
 * Rebuilt from a CLONE: building a `Request` from another consumes the
 * source's body, and the caller's own request must stay readable — the auth
 * mount hands a path the library does not own on to the next handler, which
 * may read it. ⛔ No catch: a request that cannot be rebuilt must not reach the
 * library carrying a value its caller chose.
 */
export function withVendorClientAddress(request: Request, address: string | undefined): Request {
  if (!address && !request.headers.has(VENDOR_CLIENT_ADDRESS_HEADER)) return request;
  const headers = new Headers(request.headers);
  headers.delete(VENDOR_CLIENT_ADDRESS_HEADER);
  if (address) headers.set(VENDOR_CLIENT_ADDRESS_HEADER, address);
  return new Request(request.clone(), { headers });
}
