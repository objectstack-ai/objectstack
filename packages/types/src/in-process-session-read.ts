// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * THE rule for an in-process better-auth session read — `auth.api.getSession`
 * called by a door on the server, as opposed to the browser-facing
 * `GET /api/v1/auth/get-session` route.
 *
 * ## Why a read needs a rule (#22258)
 *
 * better-auth's `getSession` is not a pure read. Once a session is older than
 * `session.updateAge`, the call RENEWS it — it moves `sys_session.expires_at`
 * to `now + expiresIn` — and stages the renewed session cookie on THAT call's
 * own response (better-auth 1.7.3, `dist/api/routes/session.mjs:198-214`). A
 * door reading in-process answers with its own response, so the renewal lands
 * in the database and the cookie is thrown away. The browser keeps its old
 * cookie and its old `Max-Age`, and later `/get-session` calls find a fresh row
 * and re-issue nothing. The cookie dies first: a SPLIT session, a dead cookie
 * beside a live bearer, and every cookie-only path then reads a signed-in user
 * as signed out.
 *
 * Measured through the public doors on a fresh dev stack, a session aged to
 * `now + expiresIn − updateAge − 60 s`: `GET /data/:object`,
 * `GET /auth/me/permissions`, `GET /meta/object` and the dispatcher's doors
 * each moved `expires_at` by +86460 s and answered no session cookie, by cookie
 * and by bearer alike; `GET /auth/get-session` renewed AND re-issued the cookie
 * with `Max-Age = expiresIn`.
 *
 * ## The rule — decided by what the request carries
 *
 * - **A session cookie** (a browser): read with `query.disableRefresh`. The
 *   session renews only where its cookie is re-issued — the `/get-session`
 *   route — so cookie expiry and session expiry cannot split.
 * - **No session cookie** (a bearer-only client — the SDK outside a browser,
 *   the CLI): read exactly as before, renewal included. No cookie exists to fall
 *   behind; the bearer IS the session token and renewal does not change it; and
 *   these clients reach `/get-session` only at sign-in (`os login`,
 *   `os cloud whoami`), so without renewal on their data reads their session
 *   would end `expiresIn` after sign-in however active they were.
 *
 * Forwarding the renewed `Set-Cookie` from every door was measured and not
 * taken: several readers run with no response in hand (the inbound rate
 * limiter, the dispatcher's scope resolution, the REST execution-context
 * resolver, which is cached per request), and a forward would need this same
 * cookie test anyway so that no cookie is ever set on a response to a request
 * that sent none. better-auth applies the same rule to its own server-side
 * reads that cannot write a cookie (React Server Components,
 * `dist/integrations/next-js.mjs:62-69`).
 *
 * ⛔ The rule only ever ADDS `disableRefresh`. It never sets a cookie, never
 * forwards one, and never changes which session a request resolves to.
 */

/**
 * The input a reader hands `getSession`: the request's own headers, unchanged,
 * plus `query.disableRefresh` when the request carries a session cookie.
 */
export interface InProcessSessionReadInput<H> {
  headers: H;
  query?: { disableRefresh: true };
}

/**
 * The better-auth session cookie, whatever its prefix.
 *
 * better-auth names it `${cookiePrefix}.session_token`, behind `__Secure-` when
 * cookies are secure (1.7.3 `dist/cookies/index.mjs:23-29`, default prefix
 * `better-auth`). The prefix is author-configurable
 * (`AuthConfig.advanced.cookiePrefix`), so the test reads the name's SHAPE, not
 * one spelling. A cookie with an empty value is no session cookie.
 */
const SESSION_TOKEN_COOKIE = /(?:^|;)\s*(?:__Secure-|__Host-)?[^\s=;]+\.session_token=[^;\s]/;

/** The `Cookie` header of a Web `Headers` or of a plain header record. */
function cookieHeaderOf(headers: unknown): string {
  if (!headers || typeof headers !== 'object') return '';
  const get = (headers as { get?: unknown }).get;
  if (typeof get === 'function') {
    const value: unknown = get.call(headers, 'cookie');
    return typeof value === 'string' ? value : '';
  }
  for (const [name, value] of Object.entries(headers as Record<string, unknown>)) {
    if (name.toLowerCase() !== 'cookie' || value == null) continue;
    return Array.isArray(value) ? value.map(String).join('; ') : String(value);
  }
  return '';
}

/**
 * Does this request carry a better-auth session cookie?
 *
 * Accepts the shapes the doors are handed: a Web `Headers`, or a plain record
 * (adapters deliver either; a value may be a string array).
 */
export function carriesSessionCookie(headers: unknown): boolean {
  return SESSION_TOKEN_COOKIE.test(cookieHeaderOf(headers));
}

/**
 * The `getSession` input for an in-process session read — call as
 * `api.getSession(inProcessSessionReadInput(headers))`.
 *
 * The headers pass through untouched, so the reader resolves exactly the
 * session it resolved before; only renewal is decided here.
 */
export function inProcessSessionReadInput<H>(headers: H): InProcessSessionReadInput<H> {
  return carriesSessionCookie(headers) ? { headers, query: { disableRefresh: true } } : { headers };
}
