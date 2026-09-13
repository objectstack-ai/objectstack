// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #17234 — `/sign-in/email` and `/sign-up/email` answer `{ token, user }`
 * (sign-in also carries `redirect`), and no member of that body, and no
 * response header, is a `Session` — `SessionResponseSchema.safeParse` on
 * either method's return value therefore always reported a `data.session`
 * issue, alongside the `success` gap the previous round closed.
 *
 * ## The ruling (director seat, decision batch #125 item 4)
 *
 * > Returning the session on sign-in is the mainstream shape; the server
 * > holds the session it just created (the token is its credential), so one
 * > request can answer the declared envelope.
 *
 * The measurement that makes this possible: better-auth stores sessions in
 * the database by default (`storeSessionInDatabase`; this deployment wires no
 * `secondaryStorage` — see `auth-manager.ts`'s `deleteUser` note), and
 * `internalAdapter.createSession` is `await`-ed to completion — including the
 * database write — before the sign-in/sign-up ENDPOINT returns
 * `{ token, user }` at all (`better-auth@1.7.3`
 * `dist/db/internal-adapter.mjs:247-319`). So by the time this repo's global
 * `after` hook runs (`ctx.context.returned` already holds the endpoint's
 * answer), the row the token names is not merely creatABLE — it is already
 * committed. Reading it back is exactly what `/get-session` already does
 * (`internalAdapter.findSession`, `dist/db/internal-adapter.mjs:321-358`), so
 * this produces the SAME shape `data.session` already carries on that route
 * (`auth-get-session-envelope.test.ts`), not a second declaration of it.
 *
 * ## Why this is a READ, not an invention
 *
 * The session attached here is never synthesized: `freshSessionForToken`
 * looks up the row by the UNSIGNED token the response body already
 * published, through the same `internalAdapter.findSession` seam
 * `/get-session` uses. If the row is not there — a future better-auth
 * version that defers the write, a `secondaryStorage`-only deployment,
 * anything this comment did not anticipate — the response is left exactly as
 * the vendor wrote it. No id or expiry is ever fabricated, matching the
 * `⛔ Do not invent a session` line in the ruling that authorised this file.
 *
 * ## Scope
 *
 * `/sign-up/email` only reaches this when the vendor actually minted a
 * session for it — i.e. `autoSignIn` is on and the route's own body carries a
 * `token` (a sign-up that requires email verification first, or one done with
 * `autoSignIn: false`, serves no token and this is a no-op, matching
 * `credentialTokenPayload`'s guard). `/sign-in/email` always mints one on
 * success. Both are checked by PATH TABLE, mirroring
 * `two-factor-rotated-token-echo.ts`'s `ROTATING_TWO_FACTOR_VERIFY_PATHS`
 * rather than one bespoke `if` per route.
 */

/** The two credential-issuing routes this repo can complete a session on. */
export const CREDENTIAL_RESPONSE_PATHS: readonly string[] = ['/sign-in/email', '/sign-up/email'];

/** Did the route succeed, and does its payload echo a bare credential token? */
async function credentialTokenPayload(ctx: any): Promise<{ token: string } | undefined> {
  const returned = ctx?.context?.returned;
  if (!returned || typeof returned !== 'object') return undefined;
  try {
    const { isAPIError } = await import('better-auth/api');
    if (isAPIError(returned)) return undefined;
  } catch {
    if (returned instanceof Error) return undefined;
  }
  return typeof (returned as any).token === 'string' && (returned as any).token
    ? (returned as any)
    : undefined;
}

/**
 * The session row better-auth just created for `token`, in the exact shape
 * `/get-session` already serves under `data.session` — or `undefined` when it
 * cannot be read (no session for the token, no `internalAdapter` on this
 * context, or a read failure of any kind).
 */
async function freshSessionForToken(
  ctx: any,
  token: string,
): Promise<Record<string, unknown> | undefined> {
  const findSession = ctx?.context?.internalAdapter?.findSession;
  if (typeof findSession !== 'function') return undefined;
  const found = await findSession(token).catch(() => null);
  if (!found || typeof found !== 'object') return undefined;
  const session = (found as { session?: unknown }).session;
  if (!session || typeof session !== 'object') return undefined;
  return session as Record<string, unknown>;
}

/**
 * Complete the `SessionResponse` envelope on `/sign-in/email` and
 * `/sign-up/email` by attaching the `session` member their declared type
 * names — read back from the row the same request already committed, never
 * fabricated.
 *
 * Never throws, and never overwrites a `session` the vendor (or a plugin
 * ahead of this hook) already put on the payload: a read that fails for any
 * reason leaves the response exactly as it would have been without this file,
 * which is the honest fallback the ruling names for the case a synchronous
 * read genuinely is not possible.
 */
export async function attachSessionToCredentialResponse(ctx: any): Promise<void> {
  try {
    if (!CREDENTIAL_RESPONSE_PATHS.includes(ctx?.path)) return;
    const payload = await credentialTokenPayload(ctx);
    if (!payload) return;
    if ((payload as Record<string, unknown>).session !== undefined) return;
    const session = await freshSessionForToken(ctx, payload.token);
    if (!session) return;
    (payload as Record<string, unknown>).session = session;
  } catch {
    /* leave the payload exactly as the vendor route wrote it */
  }
}
