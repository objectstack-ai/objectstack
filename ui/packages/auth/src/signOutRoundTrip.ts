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
 * It holds a time and the path the provider returns the browser to (the
 * sign-out's `callbackURL`, the sign-in page) and nothing else, and it is
 * honoured only on THAT return: a load of the same path within
 * {@link SIGN_OUT_ROUND_TRIP_MAX_AGE_MS}. A provider that never sends the
 * browser back leaves the note behind, and the next load of the app in the tab
 * is some other page (a deep link, say): that load drops the note unread, so
 * it is a fresh visit and `LoginRedirect` keeps the deep link's `?redirect=`.
 * A tab reused after the window is a fresh visit too. Never throws: storage
 * that is absent or blocked, or a note that does not parse, reads as "no
 * note", which is today's behaviour.
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

/** A path without its query or fragment, and without a trailing slash (`/` stays `/`). */
function barepath(path: string): string {
  const bare = path.split(/[?#]/)[0] || '/';
  return bare.length > 1 ? bare.replace(/\/+$/, '') || '/' : bare;
}

function loadedPath(): string | undefined {
  try {
    return typeof window !== 'undefined' ? window.location.pathname : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Write the note, just before the browser leaves for the provider's logout.
 * `returnPath` is where the provider sends the browser back: the sign-out's
 * `callbackURL`, the sign-in page.
 */
export function markSignOutRoundTrip(returnPath: string, now: number = Date.now()): void {
  try {
    tabStore()?.setItem(SIGN_OUT_ROUND_TRIP_KEY, JSON.stringify({ at: now, path: barepath(returnPath) }));
  } catch {
    /* storage unavailable: the page starts as for a fresh visit */
  }
}

/**
 * Whether this load is the tab coming back from its own sign-out's provider
 * logout: a note within the window whose return path is the path loaded now
 * (`pathname`, the current location's by default). Reads, never clears.
 */
export function readSignOutRoundTrip(now: number = Date.now(), pathname: string | undefined = loadedPath()): boolean {
  let raw: string | null | undefined;
  try {
    raw = tabStore()?.getItem(SIGN_OUT_ROUND_TRIP_KEY);
  } catch {
    return false;
  }
  if (!raw || pathname === undefined) return false;
  let note: { at?: unknown; path?: unknown };
  try {
    note = JSON.parse(raw) as { at?: unknown; path?: unknown };
  } catch {
    return false;
  }
  if (!note || typeof note !== 'object' || typeof note.path !== 'string') return false;
  const at = typeof note.at === 'number' ? note.at : Number.NaN;
  if (!Number.isFinite(at)) return false;
  const age = now - at;
  if (age < 0 || age > SIGN_OUT_ROUND_TRIP_MAX_AGE_MS) return false;
  return barepath(note.path) === barepath(pathname);
}

/** Drop the note: it is read once, by the first `AuthProvider` mount after the round trip. */
export function clearSignOutRoundTrip(): void {
  try {
    tabStore()?.removeItem(SIGN_OUT_ROUND_TRIP_KEY);
  } catch {
    /* storage unavailable */
  }
}
