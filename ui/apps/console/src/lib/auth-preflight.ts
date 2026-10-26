// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Auth preflight — validate any stale Bearer token sitting in localStorage
 * BEFORE `<AuthProvider>` mounts.
 *
 * # Why this exists
 *
 * `@object-ui/auth`'s `createAuthClient` wraps fetch in `createBearerFetch`,
 * which injects `Authorization: Bearer <token>` from
 * `localStorage['auth-session-token']` on every `/api/*` request.
 *
 * Cookie-based sign-in (better-auth sets a session cookie) does NOT touch
 * this localStorage key. So a stale Bearer can linger: a user signs out,
 * signs back in as a different user (new cookie), but localStorage still
 * holds the old token from a previous visit. The Console's AuthProvider
 * then sends that **stale Bearer** to `get-session`; the server prefers
 * Bearer over cookie and returns null, so AuthProvider wrongly treats the
 * user as unauthenticated and bounces them to the login page even though
 * the cookie session is valid.
 *
 * # What this does
 *
 * Run BEFORE React renders. If `auth-session-token` is present, probe
 * `/api/v1/auth/get-session` with that Bearer. If the response is not
 * authenticated, delete the stale token + every stale active-organization id
 * (the bare pre-objectui#5664 key and each `auth-active-organization-id:u:`
 * scope) so AuthProvider's first `getSession()` falls back to cookie auth
 * cleanly.
 *
 * # Why the cookie rides along (objectui#12892)
 *
 * The probe sends `credentials: 'include'`. Adding the cookie does not blunt
 * the stale-token check: better-auth's `bearer()` plugin writes the Bearer's
 * token over the request's session cookie, so a stale Bearer still answers
 * null with a live cookie beside it. What the cookie buys is the renewal. Past
 * better-auth's `updateAge` this read extends the session row and re-issues the
 * cookie in `Set-Cookie`, and a fetch with `credentials: 'omit'` never stores a
 * response cookie, so the row outlived the cookie the browser kept. Since
 * objectui#12808 this is the boot's only session read, so it must be the
 * cookie-storing one: the framework's rule is that a browser session renews
 * only on the `get-session` route, which re-issues the cookie, so cookie expiry
 * and session expiry cannot split (objectstack's `auth-service.ts` contract,
 * objectstack-ai/objectstack#22384).
 *
 * Idempotent, runs once per page load, < 50 ms when the token is valid
 * (single round-trip), no UI flicker (happens before render).
 *
 * # The answer is handed on (objectui#12808)
 *
 * When the token is valid this request already IS the session `AuthProvider`
 * would ask for next, with the same Bearer and the same cookie. The body is
 * left on `globalThis` under `Symbol.for('objectui.authPreflightSession')`,
 * with the auth URL and the
 * token it was asked with, and `AuthProvider` takes it, once, for its first
 * state (`takePreflightSession` in `@object-ui/auth`'s `createAuthClient.ts`)
 * instead of issuing a second `get-session`. A stale or unanswered token leaves
 * nothing behind, and every later session read asks the server as before.
 */

const TOKEN_KEY = 'auth-session-token';
/**
 * Base name of the active-organization key. Since objectui#5664 the live key
 * is per-user (`auth-active-organization-id:u:<userId>`) and the bare name is
 * the retired pre-#5664 spelling, so the purge below matches BOTH by prefix.
 *
 * Spelled out rather than imported from `@object-ui/auth`: this module runs
 * BEFORE React renders, and pulling the auth barrel in here would drag its
 * component closure into the eager entry chunk.
 */
const ACTIVE_ORG_KEY_BASE = 'auth-active-organization-id';
/** Where the valid answer is handed to `AuthProvider` — see the header. */
const PREFLIGHT_SESSION_KEY = Symbol.for('objectui.authPreflightSession');

/**
 * Remove the stale active-organization id under every spelling — the bare
 * pre-#5664 key and each `:u:<userId>` scope.
 *
 * Every scope goes, not just the current user's: a dead Bearer means this
 * browser cannot say whose ids these are, and the value is a client-side cache
 * of a SERVER-owned fact (`AuthProvider.refreshOrganizations` re-asks on the
 * next boot), so deleting one that turns out to still be wanted costs a
 * re-fetch and nothing else.
 *
 * `auth-session-user-id` is deliberately NOT removed. It is the pointer that
 * lets the next sign-in notice it belongs to a DIFFERENT user and drop the
 * previous user's state wholesale (objectui#5664); clearing it here would make
 * that transition look like a first-ever sign-in and skip the purge.
 */
function purgeActiveOrgKeys(): void {
  // Snapshot first — removing during a live index walk skips entries.
  for (const key of Object.keys(localStorage)) {
    if (key === ACTIVE_ORG_KEY_BASE || key.startsWith(`${ACTIVE_ORG_KEY_BASE}:u:`)) {
      localStorage.removeItem(key);
    }
  }
}

export async function preflightAuth(authBaseUrl: string): Promise<void> {
  if (typeof window === 'undefined') return;
  // No initializer: every path out of the try/catch below either assigns
  // `token` or returns, so a `= null` seed would be dead (no-useless-assignment).
  let token: string | null;
  try {
    token = localStorage.getItem(TOKEN_KEY);
  } catch {
    // Storage blocked (Safari private mode / partitioned iframe) — nothing to
    // validate, and nothing we could purge either.
    return;
  }
  if (!token) return;

  try {
    const res = await fetch(`${authBaseUrl}/get-session`, {
      method: 'GET',
      // The cookie rides along so a renewed `Set-Cookie` is stored; the
      // server reads the Bearer over it, so a stale token still answers null
      // (header, objectui#12892).
      credentials: 'include',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });

    if (res.ok) {
      const body = await res.json().catch(() => null);
      const user = body?.user ?? body?.data?.user ?? null;
      if (user) {
        // Token valid — leave localStorage alone, and hand the answer on, as
        // JSON text so the taker parses it exactly as it parses the wire body.
        (globalThis as unknown as Record<symbol, unknown>)[PREFLIGHT_SESSION_KEY] = {
          authUrl: authBaseUrl,
          token,
          body: JSON.stringify(body),
        };
        return;
      }
    }

    // 401, 4xx, or 200-with-null — token is stale. Purge.
    localStorage.removeItem(TOKEN_KEY);
    purgeActiveOrgKeys();
  } catch {
    // Network error: assume token might still be good; don't punish the
    // user by clearing it. Worst case AuthProvider will detect it next.
  }
}
