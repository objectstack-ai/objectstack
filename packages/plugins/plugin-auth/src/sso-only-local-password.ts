// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * SSO-only mode keeps IdP-provisioned users off local passwords.
 *
 * ## The rule
 *
 * With SSO-only mode on (`AuthConfigSchema.ssoOnlyMode` / `OS_AUTH_SSO_ONLY`),
 * no door gives an IdP-provisioned user (`sys_user.source = 'idp_provisioned'`)
 * a local password: they sign in through the identity provider, and a local
 * password would be a second way in that the identity provider does not
 * govern (ADR-0135 D5.2: a managed identity holds no local credential). The
 * doors are every one that writes a password hash without the user proving a
 * current one:
 *
 * - `POST /set-initial-password`, the user giving themselves a first password;
 * - `POST /admin/set-user-password` (`sys_user#set_user_password`), an
 *   administrator setting one for the user;
 * - `POST /reset-password` (the emailed link) and
 *   `POST /phone-number/reset-password` (the texted code), each of which
 *   creates the local password when the user holds none.
 *
 * One exception, the break-glass one ADR-0135 D5.2 keeps and the
 * cloud-managed narrowing already makes (`cloud-managed.ts`): a platform
 * administrator may set their OWN local password, so the environment stays
 * reachable while the identity provider is not. An administrator setting a
 * password for ANOTHER IdP-provisioned user — another administrator included —
 * is refused.
 *
 * What is not narrowed:
 * - an environment-native user (`env_native`, or a row with no source) is
 *   answered as before at every door;
 * - SSO-only mode off: every door answers as before;
 * - a user who already holds a local password keeps it, and keeps using it to
 *   sign in and to change it on `/change-password` (which proves the current
 *   one). The rule is not retroactive.
 * - the break-glass lock-out guards (`last-admin-guard.ts`,
 *   `last-local-credential.ts`) are separate and unchanged.
 *
 * ## The two predicates are the cloud-managed doors' own
 *
 * Who is IdP-provisioned is the `sys_user.source` read {@link readUserSource}
 * (the one the cloud-managed administrator door asks, moved here so both rules
 * read one), and who is a platform administrator is the session's
 * `isPlatformAdminUser` or the manager's `isPlatformAdminUserId` — the
 * predicates the cloud-managed narrowing and the platform-admin gate ask. A
 * source that cannot be read fails closed (`503`), as the cloud-managed door
 * does: an outage is never read as a local account.
 *
 * ## The refusal
 *
 * `409 RESOURCE_CONFLICT`, the code and status the cloud-managed refusals
 * answer, on the same ADR-0112 reasoning: the refusal comes from the
 * environment's state, not from the request. Each message names SSO-only mode,
 * says that no password was set, and says where the user signs in instead.
 * When a door runs on a cloud-managed environment, the cloud-managed refusal
 * (asked first) is the one that answers.
 */

import type { StandardErrorCode } from '@objectstack/spec/api';
import { CLOUD_MANAGED_REFUSAL_CODE, CLOUD_MANAGED_REFUSAL_STATUS } from './cloud-managed.js';
import { DIRECTORY_MANAGED_SOURCE } from './scim-identity-source.js';

/** The ADR-0112 code every SSO-only refusal carries (the cloud-managed refusals' code). */
export const SSO_ONLY_REFUSAL_CODE: StandardErrorCode = CLOUD_MANAGED_REFUSAL_CODE;

/** The status every SSO-only refusal answers. */
export const SSO_ONLY_REFUSAL_STATUS = CLOUD_MANAGED_REFUSAL_STATUS;

/** One message per door, keyed by the door. */
export const SSO_ONLY_REFUSAL_MESSAGES = {
  setInitialPassword:
    'This environment is in SSO-only mode and your account is provisioned by your identity provider, so you sign in '
    + 'through single sign-on and a local password cannot be set for you here. Sign in with SSO. No password was set.',
  setUserPassword:
    'This environment is in SSO-only mode and this user is provisioned by the identity provider, so they sign in '
    + 'through single sign-on and a local password cannot be set for them here. A platform administrator may set only '
    + 'their own break-glass password. No password was changed.',
  resetPassword:
    'This environment is in SSO-only mode and your account is provisioned by your identity provider, so you sign in '
    + 'through single sign-on and your local password cannot be reset here. Sign in with SSO. No password was set.',
} as const;

/** The doors SSO-only mode narrows. */
export type SsoOnlyPasswordDoor = keyof typeof SSO_ONLY_REFUSAL_MESSAGES;

/** The ADR-0112 envelope a raw route hands back for `door`. */
export function ssoOnlyPasswordRefusal(door: SsoOnlyPasswordDoor): {
  status: typeof SSO_ONLY_REFUSAL_STATUS;
  body: { success: false; error: { code: StandardErrorCode; message: string } };
} {
  return {
    status: SSO_ONLY_REFUSAL_STATUS,
    body: { success: false, error: { code: SSO_ONLY_REFUSAL_CODE, message: SSO_ONLY_REFUSAL_MESSAGES[door] } },
  };
}

/** The envelope a door answers when the user's identity source cannot be read. */
export function identitySourceUnreadable(what: string): {
  status: 503;
  body: { success: false; error: { code: StandardErrorCode; message: string } };
} {
  return {
    status: 503,
    body: {
      success: false,
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: `The user's identity source could not be read, so whether ${what} cannot be judged. No password was changed.`,
      },
    },
  };
}

/** The read surface {@link readUserSource} needs. */
export interface UserSourceReader {
  find?(object: string, query?: unknown, opts?: unknown): Promise<unknown>;
}

const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] };

/**
 * [#25083] The user's `sys_user.source` (`idp_provisioned` | `env_native`),
 * read as the system. `ok: false` when it cannot be read at all (no engine,
 * no read surface, or the read throws), so a door that asks fails closed
 * instead of reading an outage as a local account.
 */
export async function readUserSource(
  engine: UserSourceReader | undefined,
  userId: string,
): Promise<{ ok: true; value: string | null } | { ok: false }> {
  if (!engine?.find) return { ok: false };
  try {
    const rows = await engine.find('sys_user', {
      where: { id: userId },
      fields: ['id', 'source'],
      limit: 1,
      context: SYSTEM_CTX,
    });
    const row = Array.isArray(rows) ? (rows[0] as { source?: unknown } | undefined) : undefined;
    return { ok: true, value: typeof row?.source === 'string' ? row.source : null };
  } catch {
    return { ok: false };
  }
}

/** Is `source` the IdP-provisioned population SSO-only mode keeps off local passwords? */
export function isIdpProvisionedSource(source: string | null): boolean {
  return source === DIRECTORY_MANAGED_SOURCE;
}

/**
 * The SSO-only verdict for giving `userId` a local password.
 *
 * - `allow`: SSO-only mode is off, the user is not IdP-provisioned, or the
 *   break-glass exception holds (`selfPlatformAdmin`: the person setting the
 *   password is a platform administrator setting their own);
 * - `refuse`: SSO-only mode is on and an IdP-provisioned user would be given
 *   a local password;
 * - `unreadable`: SSO-only mode is on and the user's source cannot be read.
 *
 * `selfPlatformAdmin` is asked only once the user is known to be
 * IdP-provisioned, so a door pays for that read only when it decides.
 */
export async function judgeSsoOnlyLocalPassword(input: {
  ssoOnly: boolean;
  engine: UserSourceReader | undefined;
  userId: string;
  selfPlatformAdmin: () => boolean | Promise<boolean>;
}): Promise<'allow' | 'refuse' | 'unreadable'> {
  if (!input.ssoOnly) return 'allow';
  const source = await readUserSource(input.engine, input.userId);
  if (!source.ok) return 'unreadable';
  if (!isIdpProvisionedSource(source.value)) return 'allow';
  return (await input.selfPlatformAdmin()) ? 'allow' : 'refuse';
}

/** The emailed reset door. */
export const RESET_PASSWORD_PATH = '/reset-password';

/** The texted-code reset door (better-auth's phone-number plugin). */
export const PHONE_RESET_PASSWORD_PATH = '/phone-number/reset-password';

/** The slice of better-auth's endpoint context the reset-door reader needs. */
export interface ResetDoorContext {
  path?: string;
  body?: Record<string, unknown> | null;
  query?: Record<string, unknown> | null;
  context?: {
    internalAdapter?: {
      findVerificationValue(identifier: string): Promise<{ value?: unknown; expiresAt?: unknown } | null | undefined>;
    };
    adapter?: {
      findOne(query: { model: string; where: Array<{ field: string; value: unknown }> }): Promise<unknown>;
    };
  };
}

function isLive(row: { expiresAt?: unknown } | null | undefined): boolean {
  if (!row) return false;
  const expiresAt = row.expiresAt instanceof Date ? row.expiresAt : new Date(String(row.expiresAt ?? ''));
  return !Number.isNaN(expiresAt.getTime()) && expiresAt >= new Date();
}

/**
 * The user a reset door would give a password to, or `undefined`.
 *
 * Resolved only from a credential the door itself would accept, read WITHOUT
 * spending it: a live reset token (`reset-password:TOKEN`, the identifier
 * better-auth's handler reads), or a texted code that matches the live stored
 * one and is still inside its attempt budget (better-auth's own non-consuming
 * predicate for that door, `matchesUsableStoredPhoneNumberOTP`, 1.7.12). Any
 * other request resolves `undefined` and the door answers it exactly as before,
 * so the SSO-only refusal tells nobody anything their credential did not
 * already prove. A read that throws resolves `undefined` too: the vendor's
 * handler then makes its own read and answers.
 */
export async function resolveResetDoorUserId(
  ctx: ResetDoorContext,
  phoneOtpAllowedAttempts: number,
): Promise<string | undefined> {
  const internal = ctx.context?.internalAdapter;
  if (!internal) return undefined;
  try {
    if (ctx.path === RESET_PASSWORD_PATH) {
      const fromBody = ctx.body?.token;
      const fromQuery = ctx.query?.token;
      const token = typeof fromBody === 'string' && fromBody ? fromBody : typeof fromQuery === 'string' ? fromQuery : '';
      if (!token) return undefined;
      const row = await internal.findVerificationValue(`reset-password:${token}`);
      if (!isLive(row) || typeof row?.value !== 'string' || !row.value) return undefined;
      return row.value;
    }
    if (ctx.path === PHONE_RESET_PASSWORD_PATH) {
      const phoneNumber = ctx.body?.phoneNumber;
      const otp = ctx.body?.otp;
      if (typeof phoneNumber !== 'string' || !phoneNumber || typeof otp !== 'string' || !otp) return undefined;
      const row = await internal.findVerificationValue(`${phoneNumber}-request-password-reset`);
      if (!isLive(row) || typeof row?.value !== 'string') return undefined;
      const [stored, rawAttempts] = row.value.split(':');
      const attempts = Number(rawAttempts ?? 0);
      if ((Number.isSafeInteger(attempts) && attempts > 0 ? attempts : 0) >= phoneOtpAllowedAttempts) return undefined;
      if (stored !== otp) return undefined;
      const user = (await ctx.context?.adapter?.findOne({
        model: 'user',
        where: [{ field: 'phoneNumber', value: phoneNumber }],
      })) as { id?: unknown } | null | undefined;
      return typeof user?.id === 'string' && user.id ? user.id : undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
}
