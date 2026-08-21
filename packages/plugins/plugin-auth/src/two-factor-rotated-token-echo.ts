// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #10701 — a successful 2FA verification echoed a session token it had just
 * DELETED, and a client that believed the echo locked itself out.
 *
 * ## The defect
 *
 * better-auth's `verifyTwoFactor` helper resolves the caller's session ONCE,
 * at entry, and closes over it:
 *
 *     valid: async (ctx) => ctx.json({ token: session.session.token, ... })
 *
 * (`dist/plugins/two-factor/verify-two-factor.mjs`, measured 2026-08-21
 * against the installed better-auth `1.7.1`.)
 *
 * On the ENROLMENT lane — a caller who is already signed in confirming a new
 * TOTP factor — `/two-factor/verify-totp` rotates that session before it
 * answers: it mints a new session, installs it with `setSessionCookie`, and
 * then deletes the caller's original session row
 * (`dist/plugins/two-factor/totp/index.mjs`). Only afterwards does it call
 * `valid(ctx)` — which still holds the pre-rotation session and echoes the
 * token of the row that was just deleted.
 *
 * So the 200 carries two credentials that disagree. The `Set-Cookie` names the
 * live session; the JSON `token` names a session that no longer exists.
 *
 * ## Why a dead echo is worse than no echo
 *
 * Every other auth response in this repo echoes `token` as the UNSIGNED token
 * of a LIVE session, and `bearer()` accepts exactly that: presented without a
 * signature it signs the value itself before verifying
 * (`dist/plugins/bearer/index.mjs` — the no-`.` branch). Measured on
 * `/sign-up/email`: the body's `token` resolves to the user as a bearer.
 *
 * A client following that contract after enrolling in 2FA therefore stores a
 * revoked token — and `bearer()`'s before-hook does not merely fail to
 * authenticate it, it OVERWRITES the request's session cookie with it. A
 * request carrying the still-valid rotated cookie AND the dead bearer resolves
 * to nobody. The dead echo does not just fail; it destroys a working session.
 * Fail-closed, no privilege gained — and a legitimate user locked out.
 *
 * ## The fix — echo the session the response actually installed
 *
 * This restores the contract; it does not change it. The field keeps its
 * shape (the unsigned token) and its meaning ("the session you now hold").
 * Only the value is corrected, from a deleted row to the live one — the very
 * session the response staged in `Set-Cookie` a few lines earlier.
 *
 * Deliberately keyed on the MECHANISM rather than on the enrolment branch: the
 * echo is repaired only when the response staged a session cookie whose token
 * differs from the one being echoed. On the sign-in-challenge lane, where
 * `valid()` mints the session it echoes, the two agree and this is a byte-for-
 * byte no-op. Nothing is invented: the corrected value is read back out of the
 * response's own cookie, so this cannot hand a caller a credential the request
 * did not already grant it.
 *
 * ⚠️ NOT a resolver change. `bearer()`'s precedence over the cookie is
 * untouched, and an invalid bearer still fails loud exactly as it does today —
 * relaxing that rejection was considered and explicitly ruled out of scope for
 * this card. The only thing that changes is which token we hand out.
 *
 * ## Scope
 *
 * `/two-factor/verify-otp` carries the byte-identical rotate-then-`valid(ctx)`
 * block (same dist tree, `otp/index.mjs`), so it is the same defect and is
 * covered by the same guard rather than left as a known-identical hole. The
 * pins in `two-factor-rotated-token-echo.test.ts` drive the TOTP path, which is
 * the one this repo's plugin wiring can exercise without OTP transport config.
 * `/two-factor/verify-backup-code` does NOT rotate and is unaffected either
 * way; it is listed for neither.
 */

/** The 2FA verification routes whose vendor implementation rotates the session. */
export const ROTATING_TWO_FACTOR_VERIFY_PATHS: readonly string[] = [
  '/two-factor/verify-totp',
  '/two-factor/verify-otp',
];

/** Every `Set-Cookie` currently staged on the response, however the runtime spells it. */
function stagedSetCookies(headers: Headers | undefined): string[] {
  if (!headers) return [];
  const viaGetter = (headers as any).getSetCookie?.();
  if (Array.isArray(viaGetter)) return viaGetter;
  const joined = headers.get('set-cookie');
  return joined ? [joined] : [];
}

/**
 * Percent-decode a cookie value the way `bearer()` does — and, like it, use the
 * value verbatim when it turns out not to be percent-encoded after all.
 */
function tryDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * The UNSIGNED session token the response is installing, or `undefined` when it
 * is not installing one.
 *
 * The cookie carries `<token>.<signature>`; `session.token` — the value every
 * auth response body echoes — is the part before the signature. An expiring
 * cookie (`max-age=0`) is a sign-OUT, not a rotation, and is ignored, matching
 * the guard `bearer()`'s own after-hook uses before emitting `set-auth-token`.
 */
async function installedSessionToken(ctx: any): Promise<string | undefined> {
  const headers: Headers | undefined = ctx?.context?.responseHeaders;
  const staged = stagedSetCookies(headers);
  if (staged.length === 0) return undefined;
  const cookieName: unknown = ctx?.context?.authCookies?.sessionToken?.name;
  if (typeof cookieName !== 'string' || !cookieName) return undefined;

  const { parseSetCookieHeader } = await import('better-auth/cookies');
  for (const cookie of staged) {
    const parsed = parseSetCookieHeader(cookie).get(cookieName);
    if (!parsed?.value) continue;
    if (parsed['max-age'] === 0) continue;
    const unsigned = tryDecode(parsed.value).split('.')[0];
    if (unsigned) return unsigned;
  }
  return undefined;
}

/** Did the route succeed, and does its payload echo a token? */
async function echoedTokenPayload(ctx: any): Promise<{ token: string } | undefined> {
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
 * Repair the `token` a 2FA verification echoes, so it names the session the
 * same response installed rather than the one it deleted.
 *
 * A no-op for every other path, for a failed verification, for a response that
 * installs no session cookie, and — the common case — whenever the echoed token
 * already matches the installed one.
 *
 * Never throws. A verification that genuinely succeeded must not be turned into
 * a failure because the response body could not be tidied; the caller's cookie
 * is valid either way, and this repair only widens which credentials from the
 * response work. Any unexpected shape therefore leaves the payload untouched.
 */
export async function echoInstalledSessionToken(ctx: any): Promise<void> {
  try {
    if (!ROTATING_TWO_FACTOR_VERIFY_PATHS.includes(ctx?.path)) return;
    const payload = await echoedTokenPayload(ctx);
    if (!payload) return;
    const installed = await installedSessionToken(ctx);
    if (!installed || installed === payload.token) return;
    payload.token = installed;
  } catch {
    /* leave the payload exactly as the vendor route wrote it */
  }
}
