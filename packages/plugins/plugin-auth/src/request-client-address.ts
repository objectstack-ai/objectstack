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

import { defineRequestState, runWithRequestState } from '@better-auth/core/context';

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

// ───────────────────────────────────────────────────────────────────────────
// The objectstack mount's door, for a session it reads in process
// ───────────────────────────────────────────────────────────────────────────

/**
 * ADR-0069 TL;DR 6, D5: the address an objectstack mount under the auth base
 * path established for its request, carried to the session read that mount
 * makes IN PROCESS (`auth.api.getSession` — `gateAdmin` and every raw route
 * that reads the caller's session itself).
 *
 * `customSession` judges the organization's IP list again on a session read
 * that came through a door: the better-auth-served door (`handleRequest`)
 * hands it the request, and so the address {@link readRequestClientAddress}
 * holds. An in-process read carries no request, so without this slot it
 * judged the organization's limits but not its list. The mount middleware in
 * `auth-plugin.ts` resolves the request's address by the one trust rule
 * (`AuthManager.resolveClientAddress`, the D5 gate's own reading) and opens
 * this slot around the route ({@link runAtMountDoor}); better-auth's endpoints
 * reuse an open request state (`hasRequestState`), so the in-process read sees
 * it.
 *
 * A slot of its own, deliberately not {@link clientAddressStateEntries}':
 * that one feeds the hooks that stamp an address on a sign-in, a session row
 * and its audit, and a mount's in-process calls stay as they were for those.
 * The carried value is an object, so an address the mount could NOT establish
 * is still a door (`{ address: undefined }`) — refused under a set list, as
 * at the HTTP door — while no slot at all reads as no door.
 */
const mountDoorState = defineRequestState<{ address: string | undefined } | null>(() => null);

/**
 * Run `fn` — an objectstack mount's route, behind the D5 gate — with its
 * established `address` carried to the session reads it makes in process. A
 * fresh request state, scoped to `fn`.
 */
export async function runAtMountDoor<T>(address: string | undefined, fn: () => Promise<T>): Promise<T> {
  const door = { address: address && address.length > 0 ? address : undefined };
  // `await`, not a bare return: `runWithRequestState` is generic over its
  // callback, so the composed call is typed `Promise<Promise<T>>`.
  return await runWithRequestState(new WeakMap<object, unknown>([[mountDoorState.ref, door]]), fn);
}

/**
 * The door an objectstack mount opened for the current request
 * ({@link runAtMountDoor}), or `undefined` when none is open — a programmatic
 * call, a transport outside the auth mount, no request state. Never throws: a
 * session read must not fail on its own judgement's input.
 */
export async function readMountDoor(): Promise<{ address: string | undefined } | undefined> {
  try {
    const door = await mountDoorState.get();
    return door ? { address: door.address } : undefined;
  } catch {
    return undefined;
  }
}
