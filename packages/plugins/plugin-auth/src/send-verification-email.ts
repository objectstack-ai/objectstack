// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Shared `send-verification-email` (self-service resend) handler.
 *
 * better-auth's stock `POST /send-verification-email` REQUIRES `{ email }` in
 * the body — it was designed for the post-signup verify screen where the user
 * types (or re-supplies) the address to resend to. But the platform's
 * self-service resend is a **one-click** affordance: the `resend_verification_email`
 * action on `sys_user` (record header button, the "email unverified" record
 * alert, and the record-section quick action) fires with an EMPTY body — there
 * is no dialog collecting an email, and the record-alert `action` reference
 * cannot carry params at all. So the request reached better-auth with no email
 * and bounced with `[body.email] Invalid input: expected string, received
 * undefined`, making the button permanently broken.
 *
 * This thin wrapper closes the gap by defaulting the address to the
 * authenticated caller's own session email when the body omits it, then
 * RE-DISPATCHING through the real `/send-verification-email` route (via the
 * better-auth universal handler passed in) so token generation, the
 * `sendVerificationEmail` callback, and rate limiting all still run — no logic
 * is duplicated. An explicitly-supplied `email` (the admin / verify-screen
 * path) passes through untouched, so no existing caller changes behaviour and
 * no new enumeration surface is introduced.
 *
 * Like `runSetInitialPassword` / `runRegisterSsoProviderFromForm`, it is the
 * single source of truth for the two mount points that must stay in lockstep:
 * the full `AuthPlugin` (self-host / OSS host kernel) and the cloud
 * `AuthProxyPlugin` (per-environment runtime).
 */

import type { AuthRequestHandler } from './register-sso-provider.js';

export interface ResendVerificationEmailResult {
  /** HTTP status to return to the caller. */
  status: number;
  /** JSON body forwarded to the client (native better-auth body on the happy path). */
  body: unknown;
}

const trimStr = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * Resolve the caller's own email by re-dispatching a `/get-session` through the
 * same better-auth handler (best-effort). Returns `undefined` when there is no
 * session or the lookup fails, so callers fall back to a 400 "email required".
 * `sendUrl` is the resolved `…/send-verification-email` URL; we swap the
 * trailing path for `…/get-session` on the same origin/basePath.
 */
async function resolveSessionEmail(
  handle: AuthRequestHandler,
  sendUrl: string,
  headers: Headers,
): Promise<string | undefined> {
  try {
    const sessionUrl = sendUrl.replace(/\/send-verification-email$/, '/get-session');
    if (sessionUrl === sendUrl) return undefined;
    const h = new Headers({ accept: 'application/json' });
    const cookie = headers.get('cookie');
    if (cookie) h.set('cookie', cookie);
    const authz = headers.get('authorization');
    if (authz) h.set('authorization', authz);
    const resp = await handle(new Request(sessionUrl, { method: 'GET', headers: h }));
    if (!resp.ok) return undefined;
    const data: any = await resp.json().catch(() => null);
    // customSession shapes the payload as `{ user, session }`; be tolerant of
    // a nested `session.user` too.
    const email = data?.user?.email ?? data?.session?.user?.email;
    return typeof email === 'string' && email.length > 0 ? email : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Run a self-service-tolerant `send-verification-email`.
 *
 * @param handle  the better-auth universal handler (`AuthManager.handleRequest`
 *                on the host kernel, or the resolved per-env handler in the
 *                cloud proxy). Used to resolve the session and re-dispatch the
 *                filled body to the real `/send-verification-email` route.
 * @param request the raw Web `Request` — its headers carry the caller's session
 *                cookie / bearer; its body MAY carry `{ email?, callbackURL? }`.
 */
export async function runResendVerificationEmail(
  handle: AuthRequestHandler,
  request: Request,
): Promise<ResendVerificationEmailResult> {
  let body: any;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  let email = trimStr(body?.email);
  const callbackURL = trimStr(body?.callbackURL);

  let sendUrl: string;
  let origin: string;
  try {
    const url = new URL(request.url);
    origin = url.origin;
    sendUrl = url.href;
  } catch {
    return { status: 400, body: { success: false, error: { code: 'INVALID_REQUEST', message: 'Bad request URL' } } };
  }

  // No address supplied → this is the one-click self-service resend. Default to
  // the authenticated caller's own email.
  if (!email) {
    email = (await resolveSessionEmail(handle, sendUrl, request.headers)) ?? '';
  }
  if (!email) {
    return {
      status: 400,
      body: { success: false, error: { code: 'INVALID_REQUEST', message: 'email is required (sign in to resend to your own address)' } },
    };
  }

  const headers = new Headers({ 'content-type': 'application/json' });
  const cookie = request.headers.get('cookie');
  if (cookie) headers.set('cookie', cookie);
  const authz = request.headers.get('authorization');
  if (authz) headers.set('authorization', authz);
  headers.set('origin', request.headers.get('origin') || origin);

  // Re-dispatch to the real better-auth route (the universal handler bypasses
  // this wrapper, so there is no recursion) with the resolved email.
  const innerReq = new Request(sendUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email, ...(callbackURL ? { callbackURL } : {}) }),
  });

  const resp = await handle(innerReq);
  let parsed: unknown;
  try {
    const t = await resp.text();
    parsed = t ? JSON.parse(t) : { success: resp.ok };
  } catch {
    parsed = { success: resp.ok };
  }
  return { status: resp.status, body: parsed };
}
