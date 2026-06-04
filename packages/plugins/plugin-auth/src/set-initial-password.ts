// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Shared `set-initial-password` handler.
 *
 * better-auth ships a `setPassword` operation that does EXACTLY what we want
 * (require a session, enforce min/max length, link a `credential` account if
 * none exists, refuse if one already does). But it is registered with
 * `createAuthEndpoint({ ... })` — note: NO leading path string — which means
 * better-auth deliberately exposes it as a **server-only** `auth.api.setPassword`
 * call and gives it no HTTP route. Setting a password without proving the old
 * one is privilege-sensitive, so it must not be reachable over the wire by
 * default.
 *
 * To let an SSO-onboarded user set an *initial* local password from the
 * browser, we wrap that server API in our own authenticated HTTP route. This
 * helper is the single source of truth for that route body so the two mount
 * points — the full `AuthPlugin` (host kernel) and the cloud `AuthProxyPlugin`
 * (per-environment runtime) — stay in lockstep instead of hand-copying ~50
 * lines of hash/createAccount logic (the original drift that let #1544 ship a
 * route on one path but not the other).
 */

/** Minimal shape of the better-auth server API we depend on. */
export interface SetPasswordCapableApi {
  setPassword(opts: { body: { newPassword: string }; headers: Headers }): Promise<unknown>;
}

export interface SetInitialPasswordResult {
  /** HTTP status to return to the caller. */
  status: number;
  /** JSON body; mirrors the `{ success, error: { code, message } }` envelope the client parses. */
  body: { success: boolean; error?: { code: string; message: string } };
}

/**
 * Run set-initial-password against the environment's better-auth API.
 *
 * @param authApi   the better-auth server api (`auth.api`, via `AuthManager.getApi()`)
 * @param request   the raw Web `Request` — its `headers` carry the session
 *                  cookie that better-auth's session middleware reads, and its
 *                  body carries `{ newPassword }`.
 */
export async function runSetInitialPassword(
  authApi: SetPasswordCapableApi,
  request: Request,
): Promise<SetInitialPasswordResult> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    parsed = {};
  }
  const newPassword: unknown = (parsed as { newPassword?: unknown } | null)?.newPassword;
  if (typeof newPassword !== 'string' || newPassword.length === 0) {
    return {
      status: 400,
      body: { success: false, error: { code: 'invalid_request', message: 'newPassword is required' } },
    };
  }

  try {
    // better-auth's session middleware reads the session from `headers`;
    // length checks + the "already set" guard happen inside setPassword.
    await authApi.setPassword({ body: { newPassword }, headers: request.headers });
    return { status: 200, body: { success: true } };
  } catch (error) {
    return mapSetPasswordError(error);
  }
}

/**
 * Map a better-auth `APIError` (better-call: `{ statusCode, status, body: { code, message } }`)
 * onto our response envelope. The client only surfaces `error.message`, but we
 * preserve the status code and code string for parity with the change/reset
 * flows. `PASSWORD_ALREADY_SET` is normalised to 409 so callers can tell
 * "already has a password → use change-password" apart from validation errors.
 */
function mapSetPasswordError(error: unknown): SetInitialPasswordResult {
  const e = error as {
    statusCode?: number;
    status?: number | string;
    body?: { code?: string; message?: string };
    message?: string;
  } | null;

  const code = e?.body?.code ?? 'internal';
  const message = e?.body?.message ?? e?.message ?? 'set-initial-password failed';
  const rawStatus =
    typeof e?.statusCode === 'number' ? e.statusCode : typeof e?.status === 'number' ? e.status : 500;
  const status = code === 'PASSWORD_ALREADY_SET' ? 409 : rawStatus;

  return { status, body: { success: false, error: { code, message } } };
}
