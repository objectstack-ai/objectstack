// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Two refusals at `session.create.before`, read from one `sys_user` row:
 *
 * 1. **A pending person holds no session.** A row still reading
 *    `idp_pending` (`pending-sso-marker.ts`) was added to sign in through the
 *    hosting organisation's identity provider, and no other sign-in method —
 *    a magic link, an email or phone code, an impersonation, a minted session
 *    — opens one for it. The platform sign-in itself passes: its link lands in
 *    `account.create.after`, whose identity-source stamp
 *    (`stampIdentitySource`) moves the row to `idp_provisioned` before the
 *    session that sign-in creates.
 *
 * 2. **A ban holds without the better-auth admin plugin.** The vendor's admin
 *    plugin refuses a banned user's session from its own `session.create`
 *    hook, and that hook is all that enforces a ban. A kernel without the
 *    plugin (a Free or Team hosted environment, where it mounts only with
 *    SCIM) had nothing reading the column, so `admin/ban-user` could not be
 *    offered there. This refusal is the vendor's, field for field — `403`,
 *    `BANNED_USER`, the vendor's default sentence; an expired ban is lifted
 *    and the session admitted — and it runs only when the plugin is NOT
 *    mounted, so a kernel with the plugin answers exactly as before (the
 *    vendor still decides there). `enforceBan` is asked lazily, only for a
 *    banned row.
 *
 * The row is read once per session: the AI-service-account refusal composed
 * before this one (`readSessionUserRow`) reads these columns with its own and
 * hands the row on. Called on its own, this refusal reads the row itself. A
 * read that throws refuses the session (`503`), as the AI-service-account
 * refusal does; a missing engine or row admits it.
 */

import { isPendingSsoSource, PENDING_SSO_MESSAGES } from './pending-sso-marker.js';
import { USER_ROW_READ_FAULT_REFUSAL } from './service-account-identity.js';

/** The refusal a pending person's session meets. */
export const PENDING_SSO_SESSION_REFUSAL = Object.freeze({
  code: 'PERMISSION_DENIED',
  message: PENDING_SSO_MESSAGES.session,
});

/**
 * The vendor admin plugin's ban refusal: its code and its default sentence
 * (`better-auth/plugins/admin`, `bannedUserMessage` unset in this plugin's
 * configuration), so a client reads one answer whichever side enforces.
 */
export const BANNED_USER_SESSION_REFUSAL = Object.freeze({
  code: 'BANNED_USER',
  message: 'You have been banned from this application. Please contact support if you believe this is an error.',
});

const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] };

const isTrue = (value: unknown): boolean => value === true || value === 1;

/** The `sys_user` columns this refusal reads. */
export const SESSION_ADMISSION_ROW_FIELDS = ['source', 'banned', 'ban_expires'] as const;

export interface SessionAdmissionOptions {
  /** Whether this refusal enforces a ban: true only when the vendor admin plugin is not mounted. */
  enforceBan(): boolean | Promise<boolean>;
  /**
   * The row, already read with {@link SESSION_ADMISSION_ROW_FIELDS} by the
   * refusal composed before this one (`readSessionUserRow`), so a session
   * costs one read of `sys_user`. Present (even `undefined`) means no read here.
   */
  row?: Record<string, unknown> | undefined;
}

/** Read the row this refusal judges; a read that throws refuses the session `503`. */
async function readAdmissionRow(engine: any, userId: string): Promise<Record<string, unknown> | undefined> {
  if (typeof engine.find !== 'function') return undefined;
  try {
    let found: any = await engine.find('sys_user', {
      where: { id: userId },
      fields: ['id', ...SESSION_ADMISSION_ROW_FIELDS],
      limit: 1,
      context: SYSTEM_CTX,
    });
    if (found && found.value) found = found.value;
    return Array.isArray(found) && found[0] && typeof found[0] === 'object' ? found[0] : undefined;
  } catch (cause) {
    const { APIError } = await import('better-auth/api');
    const err = new APIError('SERVICE_UNAVAILABLE', {
      code: 'SERVICE_UNAVAILABLE',
      message: USER_ROW_READ_FAULT_REFUSAL.message,
    });
    (err as { cause?: unknown }).cause = cause;
    throw err;
  }
}

/** Refuse a session for a pending person, or for a banned user on a kernel without the admin plugin. */
export async function refuseInactiveUserSession(
  engine: any,
  session: unknown,
  options: SessionAdmissionOptions,
): Promise<void> {
  const userId = (session as { userId?: unknown } | null | undefined)?.userId;
  if (typeof userId !== 'string' || !userId || !engine) return;
  const row = 'row' in options ? options.row : await readAdmissionRow(engine, userId);
  if (!row) return;

  if (isPendingSsoSource(row.source)) {
    const { APIError } = await import('better-auth/api');
    throw new APIError('FORBIDDEN', { code: 'PERMISSION_DENIED', message: PENDING_SSO_SESSION_REFUSAL.message });
  }

  if (isTrue(row.banned) && (await options.enforceBan())) {
    const expires = row.ban_expires ? new Date(row.ban_expires as string | number | Date) : undefined;
    if (expires && !Number.isNaN(expires.getTime()) && expires.getTime() < Date.now()) {
      // The vendor lifts an expired ban as it admits the session; so does this.
      await engine.update(
        'sys_user',
        { id: userId, banned: false, ban_reason: null, ban_expires: null },
        { context: SYSTEM_CTX },
      );
      return;
    }
    const { APIError } = await import('better-auth/api');
    throw new APIError('FORBIDDEN', { code: 'BANNED_USER', message: BANNED_USER_SESSION_REFUSAL.message });
  }
}
