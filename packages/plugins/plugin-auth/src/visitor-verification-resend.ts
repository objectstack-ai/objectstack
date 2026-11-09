// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The verification-email resend, `POST /send-verification-email`, asked by a
 * visitor who is not signed in.
 *
 * ## The rule
 *
 * A verification-email resend from a visitor who is not signed in answers the
 * same whatever the send does, and the same whatever the address:
 *
 *  - **While the email transport is live** (`AuthManager.isEmailDeliveryLive`),
 *    it answers better-auth's success, `{ status: true }`. The send runs after
 *    the response (`sendAfterResponseOnPublicDoor`, wired in
 *    `auth-manager-auth-instance.ts`), and a send that fails is logged on the
 *    server at error (`verification email was not delivered`). The caller is
 *    never handed it.
 *  - **While the transport is not live**, every such resend is refused before
 *    the endpoint runs, with one coded answer
 *    ({@link refuseVisitorResendWithoutLiveTransport}): 400
 *    `EMAIL_SERVICE_REQUIRED`, the code this package already answers for the
 *    same deployment condition on `/change-email` and in the identity import.
 *    A deployment that cannot mail still says so to whoever asks.
 *
 * Unchanged: a signed-in caller's resend, for their own address (the only one
 * better-auth lets a signed-in caller name), still awaits its send and still
 * reports one that failed; and a server-side `auth.api.sendVerificationEmail`
 * call, which carries no request, still awaits its send.
 *
 * ## Who is a visitor
 *
 * Read from the endpoint, never from the request's URL. better-auth runs each
 * endpoint, and its hooks, inside an endpoint context, and gives each request
 * its own `context.session`, `null` until a session is resolved. The resend
 * resolves its caller's session first (`getSessionFromCtx`) and records what it
 * found on that field: the session, or `null` for a caller who has none. That
 * is all before it calls the send, so the send callback reads the field from
 * the endpoint context it runs in ({@link isVisitorResendInEndpointContext}).
 * (better-auth 1.7.12: `dist/api/dispatch.mjs` sets the field per request,
 * `dist/api/routes/session.mjs` `getSessionFromCtx` records it,
 * `dist/api/routes/email-verification.mjs` reads the session before the send.)
 *
 * The before-hook runs before the endpoint, so that field cannot answer there
 * yet, and neither can `getSessionFromCtx` for every caller: better-auth's
 * `bearer()` plugin turns an `Authorization: Bearer` credential into the
 * session cookie in a before-hook of its own, applied only once every
 * before-hook has run, so a caller signed in by bearer token reads as no
 * session there. The before-hook therefore asks `AuthManager.resolveActor`,
 * the actor reader every before-hook gate already uses, which reads the cookie
 * and the bearer token alike ({@link refuseVisitorResendWithoutLiveTransport}).
 *
 * A call that carries no `Request` is a server-side call, not a visitor's, and
 * is left as it was.
 */

import type { RegisteredErrorCode } from '@objectstack/spec/api';

/** The path better-auth declares for the verification-email resend. */
export const SEND_VERIFICATION_EMAIL_PATH = '/send-verification-email';

/**
 * The code a visitor's resend is refused with while the transport is not live:
 * plugin-auth's ledgered code for a deployment with no email delivery (ADR-0112).
 */
export const VISITOR_RESEND_REFUSAL_CODE: RegisteredErrorCode = 'EMAIL_SERVICE_REQUIRED';

/**
 * Its message: the capability and the fix, the same for every address. The
 * verify screens show it as the reason the resend did not go out.
 */
export const VISITOR_RESEND_REFUSAL_MESSAGE =
  'Verification emails cannot be sent: this deployment has no configured email delivery service. ' +
  'An administrator can configure one under Settings → Mail.';

interface EndpointLike {
  path?: unknown;
  request?: unknown;
  context?: { session?: unknown } | null;
}

/** The resend, asked over HTTP (the call carries a `Request`). */
function isResendOverHttp(ctx: EndpointLike | undefined): boolean {
  return ctx?.path === SEND_VERIFICATION_EMAIL_PATH && ctx.request !== undefined && ctx.request !== null;
}

/**
 * Is `endpointCtx` — the endpoint context a send callback runs in, from
 * `tryGetCurrentAuthEndpointContext()` — the resend, asked over HTTP by a
 * caller the endpoint found no session for? Read inside the endpoint only:
 * before it, the field is `null` for every caller.
 */
export function isVisitorResendInEndpointContext(endpointCtx: unknown): boolean {
  const ctx = endpointCtx as EndpointLike | undefined;
  return isResendOverHttp(ctx) && !ctx?.context?.session;
}

/**
 * The before-hook's half of the rule: while the transport is not live, refuse
 * the resend of a visitor who is not signed in, with one answer for every
 * address. A no-op on every other path, on a call without a `Request`, while
 * the transport is live, and for a signed-in caller.
 *
 * The caller is asked only while the transport is not live, so a deployment
 * that mails reads nothing extra here. A read that fails counts as no caller:
 * the refusal is the answer every visitor gets anyway. Should this read and
 * the endpoint's ever disagree, the endpoint's decides how the send runs
 * ({@link isVisitorResendInEndpointContext}), so the resend still answers the
 * same whatever the send does.
 */
export async function refuseVisitorResendWithoutLiveTransport(
  ctx: any,
  deps: {
    isEmailDeliveryLive: () => boolean;
    resolveActor: (ctx: any) => Promise<{ userId: string } | null>;
  },
): Promise<void> {
  if (!isResendOverHttp(ctx)) return;
  if (deps.isEmailDeliveryLive()) return;
  const actor = await deps.resolveActor(ctx).catch(() => null);
  if (actor?.userId) return;
  const { APIError } = await import('better-auth/api');
  throw new APIError('BAD_REQUEST', {
    code: VISITOR_RESEND_REFUSAL_CODE,
    message: VISITOR_RESEND_REFUSAL_MESSAGE,
  });
}
