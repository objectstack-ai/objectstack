/**
 * The mobile sign-in hand-off as a sign-in redirect target (#29971).
 *
 * The mobile shell opens this Console's sign-in page in the platform's system
 * auth session with `?redirect=` naming the hand-off route
 * (`GET {auth base}/one-time-token/handoff?redirect_uri=…&code_challenge=…`),
 * which answers `302 SCHEME://…?token=T` for the signed-in session. That route
 * is an API route OUTSIDE the Console mount, so the ordinary post-sign-in
 * navigation (`withConsoleBase`, which treats every redirect as a Console
 * route) lands on a Console page that does not exist.
 *
 * The route's own rules (plugin-auth `one-time-token-handoff.ts`, maintainer
 * ruling A on the server card) decide what the sign-in pages do with it:
 *
 *  1. **That route, and nothing wider.** A redirect whose path is exactly the
 *     hand-off under the auth base this Console talks to is navigated to
 *     unprefixed ({@link handoffNavigationTarget}); every other redirect stays
 *     a Console route. This is not a general way out of the Console mount.
 *  2. **By script, from the sign-in page.** The route refuses
 *     `Sec-Fetch-Site: cross-site`, which a provider's redirect chain reports,
 *     so the hand-off is never handed to a provider as its `callbackURL`: the
 *     provider returns to the sign-in page, which then calls `location.assign`
 *     (`same-origin`).
 *  3. **Before the organization steps.** The hand-off carries the session and
 *     nothing else; the app's WebView picks the organization after it.
 *  4. **Only a fresh session.** The route refuses a session created more than
 *     five minutes ago with a raw JSON `401`; on a hand-off redirect the page
 *     shows its sign-in form for such a session instead of forwarding, and a
 *     sign-in on that form makes a new session on top of the old one
 *     ({@link useHandoffRedirect}).
 */

import { useLayoutEffect, useState } from 'react';
import { getAuthEndpointUrl } from '@objectstack/spec/api';

/** The auth API base this Console talks to: the same formula `App.tsx` hands `AuthProvider`. */
const AUTH_BASE = `${import.meta.env.VITE_SERVER_URL || ''}/api/v1/auth`;

/**
 * How old a session may be for the hand-off to carry it: the hand-off route's
 * `ONE_TIME_TOKEN_HANDOFF_SESSION_MAX_AGE_SECONDS` (plugin-auth), restated
 * here because that module is server-only. The route is the authority; this
 * copy only decides whether the page forwards or shows its form.
 */
export const HANDOFF_SESSION_MAX_AGE_MS = 5 * 60 * 1000;

/**
 * The navigation target for a hand-off redirect, or `null` when `redirect` is
 * anything else (which then stays a Console route).
 *
 * `redirect` must be a root-relative path on this page's origin whose path is
 * EXACTLY the hand-off route under `authBase`: a lookalike path, a different
 * base path, an absolute or protocol-relative URL, or an auth base on another
 * origin never matches. The answer is re-serialized from the parsed URL, so
 * what the page navigates to is what was checked.
 */
export function handoffNavigationTarget(
  redirect: string | null,
  {
    origin = typeof window === 'undefined' ? '' : window.location.origin,
    authBase = AUTH_BASE,
  }: { origin?: string; authBase?: string } = {},
): string | null {
  if (!redirect || !origin || !redirect.startsWith('/') || redirect.startsWith('//')) return null;
  let target: URL;
  let route: URL;
  try {
    target = new URL(redirect, origin);
    route = new URL(getAuthEndpointUrl(authBase, 'oneTimeTokenHandoff'), origin);
  } catch {
    return null;
  }
  if (target.origin !== origin || route.origin !== origin) return null;
  if (target.pathname !== route.pathname) return null;
  return `${target.pathname}${target.search}`;
}

/**
 * The session's creation time in epoch ms, or `null` when it carries none.
 *
 * `get-session` answers carry the server's `createdAt` (a `Date` through
 * better-auth's client parser, an ISO string through a raw `fetch`); a
 * sign-in answer carries no session record at all.
 */
export function sessionCreatedAtMs(session: unknown): number | null {
  if (!session || typeof session !== 'object') return null;
  const raw = (session as { createdAt?: unknown }).createdAt;
  if (!(raw instanceof Date) && typeof raw !== 'string' && typeof raw !== 'number') return null;
  const ms = new Date(raw).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Whether the hand-off will carry `session`.
 *
 * With a `createdAt`, its age decides. Without one, the session is fresh only
 * when it is not the one the page found on arrival: it came from a sign-in on
 * this page, which the server has just made. A session found on arrival with
 * no `createdAt` is treated as too old, so the visitor signs in again rather
 * than being forwarded to a refusal.
 */
export function isHandoffSessionFresh(
  session: unknown,
  { arrival, now }: { arrival: { session: unknown } | null; now: number },
): boolean {
  const createdAt = sessionCreatedAtMs(session);
  if (createdAt !== null) return now - createdAt <= HANDOFF_SESSION_MAX_AGE_MS;
  return arrival !== null && session !== arrival.session;
}

/** What a sign-in page does with its `?redirect=` when it names the hand-off. */
export interface HandoffRedirect {
  /** Where to navigate after sign-in, unprefixed; `null` when the redirect is not the hand-off. */
  target: string | null;
  /**
   * The hand-off would refuse the signed-in session (rule 4): the page shows
   * its sign-in form instead of forwarding. Always `false` when nobody is
   * signed in or `target` is `null`.
   */
  holdForSignIn: boolean;
}

/** The page's judgement of one session, and the session the first session check answered. */
interface SessionVerdict {
  session: unknown;
  fresh: boolean;
  arrival: { session: unknown };
}

/**
 * The hand-off decision for a sign-in page, from its `?redirect=` and the auth
 * state.
 *
 * Each session the page holds is judged once, when it arrives, in a layout
 * effect (the clock is read there, never during render); until it is judged
 * the page holds the form rather than forward. The first judgement also
 * records the session the first session check answered, which is what tells
 * a session found on arrival from one a sign-in on the page made.
 */
export function useHandoffRedirect(
  redirect: string | null,
  { user, session, isLoading }: { user: unknown; session: unknown; isLoading: boolean },
): HandoffRedirect {
  const target = handoffNavigationTarget(redirect);
  const [verdict, setVerdict] = useState<SessionVerdict | null>(null);
  useLayoutEffect(() => {
    if (target === null) return;
    // The first session check has not answered yet: nothing has arrived.
    if (verdict === null && isLoading) return;
    if (verdict !== null && verdict.session === session) return;
    const arrival = verdict?.arrival ?? { session };
    setVerdict({ session, arrival, fresh: isHandoffSessionFresh(session, { arrival, now: Date.now() }) });
  }, [target, isLoading, session, verdict]);

  const judgedFresh = verdict !== null && verdict.session === session && verdict.fresh;
  return { target, holdForSignIn: target !== null && !!user && !judgedFresh };
}
