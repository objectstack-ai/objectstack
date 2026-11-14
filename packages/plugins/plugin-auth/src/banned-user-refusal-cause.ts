// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A password sign-in refused because the identity provider deactivated the
 * account says so, in a field a client can branch on.
 *
 * ## The seam
 *
 * A SCIM `active: false` (or a SCIM `DELETE /Users/{id}`) disables the account
 * through the platform's ban write (`user-ban-write.ts`), with the reason
 * {@link SCIM_DEACTIVATION_BAN_REASON}. better-auth's admin plugin then
 * refuses the user's next session from its `session.create` hook, exactly as
 * it refuses an administrator's ban:
 *
 *     403 {"code":"BANNED_USER","message":"You have been banned from this application. Please contact support if you believe this is an error."}
 *
 * (`dist/plugins/admin/admin.mjs`, measured against the installed `1.7.12`).
 * Nothing in that answer tells a client that the account was deactivated by
 * the organization's directory rather than banned by an administrator, so a
 * client could only tell the two apart by guessing.
 *
 * ## What this does
 *
 * Runs in the `after` hook of `/sign-in/email`, where better-auth hands the
 * thrown `APIError` over on `ctx.context.returned`. On a `403 BANNED_USER`
 * refusal it reads the refused account once, by the same lookup the
 * endpoint's own credential check made
 * (`internalAdapter.findUserByEmail`, which lower-cases the address), and,
 * when the ban carries the SCIM deactivation reason, re-throws the vendor's
 * refusal with one field added:
 *
 *     403 {"code":"BANNED_USER","message":<the vendor's>,"details":{"cause":"scim_deactivated"}}
 *
 * better-auth's hook runner replaces the returned value with an `APIError` an
 * after hook throws, so the status, the code, the message and the moment of
 * the refusal stay the vendor's. Whether the account may sign in is not
 * judged here: the vendor already refused it.
 *
 * - **An administrator's ban is unchanged**: any other reason leaves the
 *   vendor's answer untouched, with no `details`.
 * - **The discriminator is the one the platform already uses** for the same
 *   question: the SCIM reactivation path lifts a ban only when it carries
 *   {@link SCIM_DEACTIVATION_BAN_REASON} (`reconcileScimUserLifecycle`), so
 *   `scim_deactivated` names exactly the bans the identity provider will lift
 *   when it reactivates the account. An administrator's ban that a later
 *   deactivation made permanent keeps the administrator's reason, and
 *   answers as an administrator's ban.
 * - **No end-user copy, and nothing about the directory.** The cause is a
 *   machine token; the wording a person reads is the client's. The answer
 *   names no connection, provider or other account, and it is reached only
 *   after the password verified, so it tells a caller nothing about an account
 *   whose password they do not hold.
 * - **A read that fails leaves the vendor's refusal as it is.** The sign-in is
 *   still refused; only the cause is missing, and the operator is told once
 *   per such answer (`warn`: no write is involved).
 *
 * Only `/sign-in/email` is decorated: it is the door the refused account is
 * named on in the request body. Other doors that create a session answer the
 * vendor's `BANNED_USER` unchanged.
 */

import { SIGN_IN_EMAIL_PATH } from './auth-session-audit.js';
import { SCIM_DEACTIVATION_BAN_REASON } from './user-ban-write.js';

/**
 * better-auth's admin plugin refuses a banned user's new session with this
 * code (`ADMIN_ERROR_CODES.BANNED_USER`); the package exports no public path
 * to that table, so the code is named here.
 */
export const BANNED_USER_CODE = 'BANNED_USER';

/** `details.cause` on a `BANNED_USER` refusal whose ban the identity provider placed through SCIM. */
export const SCIM_DEACTIVATED_CAUSE = 'scim_deactivated';

/** The account row the vendor's lookup answers, as far as this module reads it. */
interface RefusedAccount {
  banReason?: unknown;
}

/**
 * Re-throw `/sign-in/email`'s `403 BANNED_USER` with
 * `details.cause: 'scim_deactivated'` when the ban is the SCIM deactivation's.
 * A no-op on every other path and every other answer. Call it LAST in the
 * hook section that handles the path: the throw ends the hook.
 */
export async function causeBannedUserRefusal(ctx: any): Promise<void> {
  if (ctx?.path !== SIGN_IN_EMAIL_PATH) return;
  const email = ctx?.body?.email;
  if (typeof email !== 'string' || email === '') return;
  const returned = ctx?.context?.returned;
  const { APIError, isAPIError } = await import('better-auth/api');
  if (!isAPIError(returned)) return;
  if (returned.statusCode !== 403) return;
  const body = returned.body as { code?: unknown; message?: unknown; details?: unknown } | undefined;
  if (body?.code !== BANNED_USER_CODE || body.details !== undefined) return;

  let account: RefusedAccount | undefined;
  try {
    const found = await ctx.context.internalAdapter.findUserByEmail(email);
    account = found?.user as RefusedAccount | undefined;
  } catch (e) {
    ctx?.context?.logger?.warn?.(
      '[auth] A sign-in refused as BANNED_USER was answered without its cause: the refused '
        + 'account could not be read, so a client cannot tell an identity-provider deactivation '
        + 'from an administrator\'s ban on this answer. The sign-in is still refused.',
      e,
    );
    return;
  }
  if (account?.banReason !== SCIM_DEACTIVATION_BAN_REASON) return;
  throw new APIError('FORBIDDEN', {
    code: BANNED_USER_CODE,
    message: typeof body.message === 'string' ? body.message : undefined,
    details: { cause: SCIM_DEACTIVATED_CAUSE },
  });
}
