/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The tab's note that its explicit sign-out left through the identity
 * provider's logout (objectstack#33183, the maintainer's ruling 6879236460:
 * after an explicit sign-out the sign-in page stays, with a button to sign in
 * again).
 *
 * `AuthProvider` remembers an explicit sign-out in React state
 * (`sessionEndedBySignOut`). When the sign-out answers a provider-logout URL,
 * `createAuthClient.signOut` sends the browser to the provider, and the
 * provider sends it back to this SPA's sign-in page as a full page load: the
 * state is gone. This note carries that one fact across the round trip, in the
 * TAB's `sessionStorage` (the provider brings the browser back to the same
 * tab), and `AuthProvider` reads it once when it mounts.
 *
 * It holds a time and nothing else, and it is honoured for
 * {@link SIGN_OUT_ROUND_TRIP_MAX_AGE_MS} only: a tab that never came back from
 * the provider and is reused later is a fresh visit. Never throws: storage
 * that is absent or blocked reads as "no note", which is today's behaviour.
 */

/** The `sessionStorage` key. Kept across the sign-out purge (`ActiveOrganizationStorage`). */
export const SIGN_OUT_ROUND_TRIP_KEY = 'objectui:auth:signed-out-via-provider';

/** How long the note is honoured: a provider logout round trip, not a later visit. */
export const SIGN_OUT_ROUND_TRIP_MAX_AGE_MS = 10 * 60 * 1000;

function tabStore(): Storage | undefined {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : undefined;
  } catch {
    return undefined;
  }
}

/** Write the note, just before the browser leaves for the provider's logout. */
export function markSignOutRoundTrip(now: number = Date.now()): void {
  try {
    tabStore()?.setItem(SIGN_OUT_ROUND_TRIP_KEY, String(now));
  } catch {
    /* storage unavailable: the page starts as for a fresh visit */
  }
}

/** Whether this tab is coming back from its own sign-out's provider logout. Reads, never clears. */
export function readSignOutRoundTrip(now: number = Date.now()): boolean {
  let raw: string | null | undefined;
  try {
    raw = tabStore()?.getItem(SIGN_OUT_ROUND_TRIP_KEY);
  } catch {
    return false;
  }
  if (!raw) return false;
  const at = Number(raw);
  if (!Number.isFinite(at)) return false;
  const age = now - at;
  return age >= 0 && age <= SIGN_OUT_ROUND_TRIP_MAX_AGE_MS;
}

/** Drop the note: it is read once, by the first `AuthProvider` mount after the round trip. */
export function clearSignOutRoundTrip(): void {
  try {
    tabStore()?.removeItem(SIGN_OUT_ROUND_TRIP_KEY);
  } catch {
    /* storage unavailable */
  }
}
