// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0069 D7: carry the client address the server established for one auth
 * request from `AuthManager.handleRequest` to the hook that stamps
 * `last_login_ip`.
 *
 * ## Why a carrier at all
 *
 * The address is decided by the client-address trust rule
 * (`./client-address.ts`), and half of that rule's input is the transport's
 * peer address, which a Fetch `Request` does not carry. `handleRequest` is the
 * one place that receives both the `Request` and (from the route that calls it)
 * the peer, so it resolves the address there, once, and the sign-in after-hook
 * reads that answer instead of re-deriving one from headers.
 *
 * ## Where it lives: better-auth's own request state
 *
 * A {@link defineRequestState} slot in the store `handleRequest` opens per
 * request (`runWithRequestState(new WeakMap(entries), …)`), for the reason
 * `account-invitation-marker.ts` gives: better-auth's request state is the one
 * per-request store that `auth-manager.ts` polyfills on WebContainer, so the
 * address propagates wherever better-auth's own per-request state does.
 *
 * ## Absence
 *
 * No slot (a programmatic `auth.api.*` call, a door that passed no address, no
 * request state at all) reads as `undefined`: the address is undetermined and
 * the audit records no address. ⛔ It never falls back to a header.
 */

import { defineRequestState } from '@better-auth/core/context';

const requestClientAddressState = defineRequestState<string | undefined>(() => undefined);

/**
 * The request-state entries that record `address` for the request about to
 * run: none when it is undetermined, so the slot reads as absent.
 */
export function clientAddressStateEntries(address: string | undefined): Array<[object, unknown]> {
  return address ? [[requestClientAddressState.ref, address]] : [];
}

/**
 * The client address the server established for the current auth request, or
 * `undefined` when it established none or no request state is open. Never
 * throws: the login audit must not fail the sign-in it describes.
 */
export async function readRequestClientAddress(): Promise<string | undefined> {
  try {
    const address = await requestClientAddressState.get();
    return typeof address === 'string' && address.length > 0 ? address : undefined;
  } catch {
    return undefined;
  }
}
