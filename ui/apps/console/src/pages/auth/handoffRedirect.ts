/**
 * The mobile sign-in hand-off as a sign-in redirect target (#29971).
 *
 * The mobile shell opens the hand-off route
 * (`GET {auth base}/one-time-token/handoff?redirect_uri=…&code_challenge=…`) in
 * the platform's system auth session, which answers `302 SCHEME://…?token=T` for
 * a signed-in session and sends a browser that has to sign in here, with
 * `?redirect=` naming that same request. That route is an API route OUTSIDE the
 * Console mount, so the ordinary post-sign-in navigation (`withConsoleBase`,
 * which treats every redirect as a Console route) lands on a Console page that
 * does not exist.
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
 *  4. **Only a fresh session.** The route hands off only a session created
 *     within five minutes. On a hand-off redirect the page shows its sign-in form
 *     for an older one instead of forwarding, and a sign-in on that form makes a
 *     new session on top of the old one ({@link useHandoffRedirect}).
 *  5. **The route's clock over the device's.** The page reads a session's age on
 *     the device's clock and the route on the server's, so a device whose clock
 *     is behind would forward a session the route refuses. When the route sent
 *     the browser here, its redirect says when it refused
 *     ({@link HANDOFF_REFUSED_AT_PARAM}), and the page holds the form for any
 *     session not created after that, whatever the device's clock says
 *     ({@link isHandoffSessionFresh}). The links between `/login` and `/register`
 *     carry it beside a hand-off `redirect` ({@link handoffMarkQuery}), so following
 *     "Sign up" does not put the device's clock back in charge. So do the hops
 *     through `/verify-email-prompt` and back to `/login`.
 *  6. **Not from the verification mail.** The mail is opened in whatever browser
 *     reads mail, usually not the system auth session the app is waiting on, and
 *     often on another device. Its link ends on a Console page that says the
 *     address is confirmed and to go back to the app, which signs in where the
 *     hand-off started ({@link verificationCallbackURL}); it never names the
 *     route, so no token is handed out in a browser no app is waiting on.
 */

import { useLayoutEffect, useState } from 'react';
import { getAuthEndpointUrl } from '@objectstack/spec/api';
import { withConsoleBaseRootRelative } from '../../utils/consoleBase';

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
 * On the route's redirect to this page, beside `redirect`: when it refused the
 * browser's session, in epoch milliseconds on the server's clock. The hand-off
 * route's `HANDOFF_REFUSED_AT_PARAM` (plugin-auth), restated because that module
 * is server-only; `examples/app-showcase/e2e/mobile-signin-handoff.spec.ts` is
 * what notices the two disagreeing.
 */
export const HANDOFF_REFUSED_AT_PARAM = 'handoff_refused_at';

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
 * When the route refused this browser's session, from the page's query string;
 * `null` when the page was not sent here by the route, or the value is not a
 * whole number of milliseconds.
 */
export function handoffRefusedAt(search: string): number | null {
  const raw = new URLSearchParams(search).get(HANDOFF_REFUSED_AT_PARAM);
  if (raw === null || !/^\d+$/.test(raw)) return null;
  const refusedAt = Number(raw);
  return Number.isSafeInteger(refusedAt) ? refusedAt : null;
}

/**
 * The route's mark as a query suffix, for a link between the sign-in pages: empty
 * unless `redirect` names the hand-off and this page carries a mark, so every other
 * link stays exactly what it was.
 */
export function handoffMarkQuery(
  redirect: string | null,
  search: string = typeof window === 'undefined' ? '' : window.location.search,
): string {
  if (handoffNavigationTarget(redirect) === null) return '';
  const refusedAt = handoffRefusedAt(search);
  return refusedAt === null ? '' : `&${HANDOFF_REFUSED_AT_PARAM}=${refusedAt}`;
}

/**
 * On `/verify-email`, the server's landing after a verification mail whose
 * sign-in was a hand-off (rule 6): the page says the address is confirmed and
 * to go back to the app, and reads the server's `error` beside it.
 */
export const HANDOFF_VERIFIED_PARAM = 'handoff';

/**
 * The `callbackURL` a verification mail's link returns to, root-relative,
 * or `undefined` for none (the server default).
 *
 * A hand-off `redirect` returns to `/verify-email` with
 * {@link HANDOFF_VERIFIED_PARAM} (rule 6). Any other safe in-app `redirect` is
 * resolved into the Console mount (objectui#10893), exactly as before; an unsafe
 * one gives none.
 */
export function verificationCallbackURL(redirect: string | null): string | undefined {
  if (!redirect || !redirect.startsWith('/') || redirect.startsWith('//')) return undefined;
  if (handoffNavigationTarget(redirect) !== null) {
    return withConsoleBaseRootRelative(`/verify-email?${HANDOFF_VERIFIED_PARAM}=verified`);
  }
  return withConsoleBaseRootRelative(redirect);
}

/**
 * Whether the hand-off will carry `session`.
 *
 * With a `createdAt` and the route's `refusedAt`, the session is fresh only if it
 * was created after the refusal: two readings of the server's clock, so the
 * device's is not read, and a provider's sign-in that returns to this same URL
 * counts as new. On several nodes behind one host those are two clocks, so skew can
 * hold the form until a sign-in makes a later `createdAt`, which clears it. With a
 * `createdAt` alone, its age decides. Without one, the
 * session is fresh only when it is not the one the page found on arrival: it came
 * from a sign-in on this page, which the server has just made. A session found on
 * arrival with no `createdAt` is treated as too old, so the visitor signs in again
 * rather than being forwarded to a refusal.
 */
export function isHandoffSessionFresh(
  session: unknown,
  {
    arrival,
    now,
    refusedAt = null,
  }: { arrival: { session: unknown } | null; now: number; refusedAt?: number | null },
): boolean {
  const createdAt = sessionCreatedAtMs(session);
  if (createdAt !== null) {
    if (refusedAt !== null) return createdAt > refusedAt;
    return now - createdAt <= HANDOFF_SESSION_MAX_AGE_MS;
  }
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
    setVerdict({
      session,
      arrival,
      fresh: isHandoffSessionFresh(session, {
        arrival,
        now: Date.now(),
        refusedAt: handoffRefusedAt(window.location.search),
      }),
    });
  }, [target, isLoading, session, verdict]);

  const judgedFresh = verdict !== null && verdict.session === session && verdict.fresh;
  return { target, holdForSignIn: target !== null && !!user && !judgedFresh };
}
