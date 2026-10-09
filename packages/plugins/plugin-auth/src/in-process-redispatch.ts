// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The URL for a request this plugin RE-DISPATCHES through the better-auth
 * universal handler on the caller's behalf: the in-process `/get-session`
 * lookups and the bridges that reshape a body and forward it to a better-auth
 * route (`register-sso-provider.ts`, `send-verification-email.ts`).
 *
 * ## Why a re-dispatch needs a rule (#22398)
 *
 * Every better-auth session read renews a session older than `updateAge` — it
 * moves `sys_session.expires_at` to `now + expiresIn` — and stages the renewed
 * cookie on THAT read's response. A re-dispatched `/get-session` answers that
 * response to this plugin, which keeps only its JSON; a re-dispatched route
 * behind `sessionMiddleware` does the same read, and the bridge keeps only its
 * status and body. So the renewal lands in the database and its cookie is
 * thrown away: the browser keeps its old cookie and its old `Max-Age`, and the
 * session splits exactly as `inProcessSessionReadInput` (`@objectstack/types`)
 * describes for an in-process `getSession` call.
 *
 * ## The rule — the same one, spelled for a URL
 *
 * A request carrying a session cookie is re-dispatched with
 * `disableRefresh=true` in its query, so no in-process read renews it: the
 * session renews only where its cookie is re-issued, the browser-facing
 * `/get-session`. A bearer-only request is re-dispatched unchanged and keeps
 * renewing — there is no cookie to fall behind.
 *
 * better-auth reads the flag from the query on both kinds of re-dispatch
 * (1.7.3, measured by `in-process-session-renewal.pin.test.ts`): the
 * `/get-session` route declares it (`getSessionQuerySchema`, coerced), and
 * `getSessionFromCtx` — which `sessionMiddleware` and this plugin's own
 * before-hooks call — spreads the route's `ctx.query` into the read it makes,
 * so a route that declares no query schema of its own passes the flag through.
 *
 * ⛔ The rule only ever ADDS `disableRefresh`. It never sets or forwards a
 * cookie, and the request's headers — which session it resolves — are not
 * touched.
 */

import { carriesSessionCookie } from '@objectstack/types';

/**
 * `url` with `disableRefresh=true` in its query when `headers` (the caller's
 * own, as forwarded on the re-dispatch) carry a session cookie; `url` itself
 * otherwise.
 */
export function inProcessRedispatchUrl(url: string, headers: unknown): string {
  if (!carriesSessionCookie(headers)) return url;
  const target = new URL(url);
  target.searchParams.set('disableRefresh', 'true');
  return target.href;
}
