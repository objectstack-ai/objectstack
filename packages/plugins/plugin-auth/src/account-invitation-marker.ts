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
 *  1. Nothing on the wire writes it. Only {@link runImportPasswordReset} sets
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
 *
 * ## [#23598] The delivery receipt: how the import learns its send failed
 *
 * better-auth runs `sendResetPassword` through `runInBackgroundOrAwait`, which
 * CATCHES and logs whatever the send throws, and `requestPasswordReset` still
 * answers `{ status: true }` (installed 1.7.3, `dist/context/create-context.mjs`
 * and `dist/api/routes/password.mjs`). That is right for the public door — the
 * answer must not say whether an address exists or whether its mail went out —
 * and it means a throw inside the send can never reach the import. No
 * better-auth option makes the call rethrow: `advanced.backgroundTasks.handler`
 * only stops it being awaited at all, and this plugin does not set it.
 *
 * So the import's store carries a second slot beside the marker: a receipt the
 * import creates, that `sendResetPassword` settles ({@link
 * settleImportResetDelivery}), and that the import reads after its request
 * returns ({@link runImportPasswordReset}). It is its own slot because it is
 * not about the copy: a row whose inviter cannot be named gets the reset copy
 * and no marker, and its delivery is still the import's to report. The legs
 * that keep the marker server-only hold for it the same way — only the import
 * creates one, each HTTP request runs in its own store, a call that carries a
 * `Request` neither reads nor settles it, and it names its recipient — and on
 * WebContainer it rides the same polyfilled request state, so it is read at the
 * start of the send and settled on the object the import holds, never looked
 * up again after an `await`.
 *
 * A receipt nobody settled is NOT a delivery. It is reported as unconfirmed,
 * which the import reports as a failed invitation: a send better-auth never
 * started (no account behind the address) or did not await (a background-task
 * handler) has not been shown to reach anyone. Absence is never upgraded into
 * "delivered".
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
 * [#23598] What `sendResetPassword` reports about the one send it made for the
 * import. `accepted`: the email service answered `sent` or `queued`. `failed`:
 * it answered `failed`, or the send threw. `unconfirmed`: nothing settled the
 * receipt (see the header) — not a delivery.
 */
export type ImportResetDelivery =
  | { status: 'accepted' }
  | { status: 'failed'; reason: string }
  | { status: 'unconfirmed' };

interface ImportResetReceipt {
  /** The address the import asked a reset for, lowercased. */
  email: string;
  /** Set once, by the send. */
  settled?: Exclude<ImportResetDelivery, { status: 'unconfirmed' }>;
}

const importResetReceiptState = defineRequestState<ImportResetReceipt | null>(() => null);

const normalise = (email: unknown) => String(email ?? '').trim().toLowerCase();

/**
 * Run `fn` — the import's own `requestPasswordReset` call for one row — inside
 * a fresh request-state store, and answer how its send went. The store carries
 * the delivery receipt always, and the invitation marker when `inviter` is
 * given (an invitation names its inviter; without one the send is the reset
 * copy). It lives exactly as long as that one call: a second row opens its own.
 */
export async function runImportPasswordReset<T>(
  scope: { email: string; inviter?: AccountInvitationMarker['inviter'] },
  fn: () => Promise<T>,
): Promise<{ result: T; delivery: ImportResetDelivery }> {
  const email = normalise(scope.email);
  const receipt: ImportResetReceipt = { email };
  const entries: Array<[object, unknown]> = [[importResetReceiptState.ref, receipt]];
  if (scope.inviter) entries.push([accountInvitationState.ref, { email, inviter: { ...scope.inviter } }]);
  // `await`, not a bare return: `runWithRequestState` is generic over its
  // callback, so the composed call is typed `Promise<Promise<T>>`.
  const result = await runWithRequestState(new WeakMap<object, unknown>(entries), fn);
  return { result, delivery: receipt.settled ?? { status: 'unconfirmed' } };
}

/**
 * [#23598] Run `send` — `sendResetPassword`'s own body — and, when it is the
 * import's request for `recipientEmail`, settle that request's receipt with how
 * it went. The outcome is re-raised unchanged either way, so better-auth logs a
 * failure exactly as before.
 *
 * A call that carries a `Request` (every HTTP request; the public door) is
 * handed straight to `send` — the same promise, not one extra tick — so what a
 * public `POST /request-password-reset` caller observes cannot change.
 */
export function settleImportResetDelivery<T>(
  recipientEmail: string,
  request: unknown,
  send: () => Promise<T>,
): Promise<T> {
  if (request !== undefined && request !== null) return send();
  return settleInsideImport(recipientEmail, send);
}

async function settleInsideImport<T>(recipientEmail: string, send: () => Promise<T>): Promise<T> {
  let receipt: ImportResetReceipt | null = null;
  try {
    // Read once, BEFORE the send's awaits, and settled on the object itself.
    receipt = await importResetReceiptState.get();
  } catch {
    // No request state at all ("No request state found"): no receipt.
  }
  // Only the address the import asked for.
  if (receipt && receipt.email !== normalise(recipientEmail)) receipt = null;
  if (!receipt) return send();
  try {
    const result = await send();
    receipt.settled ??= { status: 'accepted' };
    return result;
  } catch (e) {
    receipt.settled ??= { status: 'failed', reason: (e as Error)?.message ?? String(e) };
    throw e;
  }
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
