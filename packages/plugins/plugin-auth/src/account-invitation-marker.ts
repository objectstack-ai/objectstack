// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23343] The server-only marker that turns ONE password-reset request into an
 * account invitation.
 *
 * ## Why a marker at all
 *
 * The identity import (`admin-import-users.ts`) invites an email row by asking
 * better-auth for a password reset on that address — better-auth's reset mint
 * is what creates the row's credential on first set. But better-auth hands the
 * resulting link only to `sendResetPassword({ user, url, token }, ctx.request)`;
 * `requestPasswordReset` itself answers `{ status, message }` and nothing else
 * (installed better-auth 1.7.3, `dist/api/routes/password.mjs`). So the import
 * never holds the link, and the template choice can only be made inside
 * `sendResetPassword` (`auth-manager.ts`). Without a marker that callback
 * cannot tell an administrator's invitation from a user who forgot their
 * password, and every invited user read "we received a request to reset your
 * password … if you didn't request this, ignore this email".
 *
 * ## Where it lives, and why there: better-auth's own request state
 *
 * The marker is a {@link defineRequestState} slot, written into a FRESH
 * request-state store the import opens around its own `requestPasswordReset`
 * call. better-auth's `auth.api.*` wrapper reuses an open store rather than
 * opening its own (`to-auth-endpoints.mjs`: `if (await hasRequestState())
 * return run()`), so `sendResetPassword`, called from inside that endpoint,
 * reads the same store.
 *
 * That choice answers `auth-manager.ts`'s recorded caveat — WebContainer's
 * `node:async_hooks` does not carry a store across `await`. A private
 * `AsyncLocalStorage` of our own would lose the marker there across
 * better-auth's user lookup and verification-row write. better-auth's
 * request-state slot is the one `auth-manager.ts` seeds with a synchronous
 * polyfill on WebContainer (`installWebContainerRequestStatePolyfill`), so the
 * marker propagates exactly where better-auth's own per-request state does:
 * native `AsyncLocalStorage` on Node, the polyfill on WebContainer. There is
 * no runtime on which better-auth's request state works and this marker is
 * lost.
 *
 * ## Why a public reset request can never select the invitation
 *
 *  1. Nothing on the wire writes it. Only {@link runAsAccountInvitation} sets
 *     the slot, and its only caller is the import, behind the platform-admin
 *     gate. No body, header or query key of `POST /request-password-reset`
 *     reaches it.
 *  2. Every HTTP request runs in its own store: `AuthManager.handleRequest`
 *     opens `runWithRequestState(new WeakMap(), …)` per request, and on Node
 *     each store is async-context-local.
 *  3. It is honoured only when `sendResetPassword` receives NO `Request`.
 *     better-auth passes `ctx.request`, which every HTTP request carries and a
 *     server-side `auth.api.requestPasswordReset({ body })` call does not. The
 *     WebContainer polyfill is process-global (its own single-flight caveat):
 *     a public request interleaved with an import could read the import's
 *     store there, and this leg is what still refuses it.
 *  4. It names its recipient. The marker selects the invitation only for the
 *     address the import invited, so even inside the store no other reset is
 *     re-templated.
 *
 * Absent, unreadable or mismatched, the answer is "no marker" and the send is
 * today's `auth.password_reset`, byte for byte. Absence is never upgraded into
 * an invitation.
 */

import { defineRequestState, runWithRequestState } from '@better-auth/core/context';

/** What the import knows about one invitation it is about to send. */
export interface AccountInvitationMarker {
  /** The invited address. Compared case-insensitively with the reset's recipient. */
  email: string;
  /** The administrator who created the account. Both fields non-empty. */
  inviter: { name: string; email: string };
}

const accountInvitationState = defineRequestState<AccountInvitationMarker | null>(() => null);

/**
 * Run `fn` — the import's own `requestPasswordReset` call — inside a fresh
 * request-state store that carries `marker`. The store lives exactly as long
 * as that one call: a second row opens its own.
 */
export async function runAsAccountInvitation<T>(
  marker: AccountInvitationMarker,
  fn: () => Promise<T>,
): Promise<T> {
  const store = new WeakMap<object, unknown>([
    [accountInvitationState.ref, { email: marker.email.trim().toLowerCase(), inviter: { ...marker.inviter } }],
  ]);
  // `await`, not a bare return: `runWithRequestState` is generic over its
  // callback, so the composed call is typed `Promise<Promise<T>>`.
  return await runWithRequestState(store, fn);
}

/**
 * The invitation a `sendResetPassword` call should send instead of the reset
 * copy, or `undefined` (send the reset copy). See the header for the four
 * legs; every one of them must hold.
 */
export async function readAccountInvitation(
  recipientEmail: string,
  request: unknown,
): Promise<AccountInvitationMarker | undefined> {
  // Leg 3: an HTTP request — the public door — always carries its Request.
  if (request !== undefined && request !== null) return undefined;
  let marker: AccountInvitationMarker | null;
  try {
    marker = await accountInvitationState.get();
  } catch {
    // No request state at all ("No request state found"): no marker.
    return undefined;
  }
  if (!marker) return undefined;
  // Leg 4: only the address the import invited.
  if (marker.email !== String(recipientEmail ?? '').trim().toLowerCase()) return undefined;
  return marker;
}
