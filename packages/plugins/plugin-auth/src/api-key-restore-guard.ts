// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Who may restore an API key revoked with a `revoked_reason`, and the one place
 * `sys_api_key.revoked_reason` is kept in step with `revoked`.
 *
 * The column carries two reasons, and each decides a different restorer: a key
 * an administrator's forced password reset revoked (`admin_password_reset`) is
 * restored by a platform administrator only; a key revoked because its owner's
 * membership in the organization ended (`organization_membership_ended`) is
 * restored by no one from a user context.
 *
 * ## Why the owner may not restore a key a forced reset revoked
 *
 * The forced reset (`POST /api/v1/auth/admin/set-user-password`) revokes every
 * key the user owns by default, because the act records no reason and may
 * answer a suspected compromise: a key that outlives that reset is the hole the
 * reset was meant to close (`forced-reset-revocation.ts`). The account in
 * question is the owner's, so the owner is not the one to reopen such a key. A
 * platform administrator restores it with the Restore API Key action; the
 * owner's road is a new key. A key the owner (or an administrator) revoked from
 * the API Keys list carries no reason, and its owner restores it as before.
 *
 * ## Why no one restores a key whose owner's membership ended
 *
 * A host that removes someone from the organization (a control plane fanning the
 * removal out to an environment) revokes the departed member's keys and stamps
 * `organization_membership_ended`, the same word `sys_session.revoke_reason`
 * carries for the sessions that removal ends (`membership-ended-session.ts`).
 * Re-arming such a key hands a non-member's credential back its access, and that
 * is so whoever clicks Restore: the owner is no longer a member, and a platform
 * administrator restoring it reopens the very hole the revocation closed. On a
 * `single` deployment no per-request membership check refuses the key, so the
 * `revoked` flag is the only barrier left. The road back is a new key, minted by
 * a member. The reason is never stamped here or by any platform writer; the host
 * writes it in the system context, beside `revoked: true`.
 *
 * ## Why this is a hook and not `sys_api_key` metadata
 *
 * The decision needs the CALLER and the row's PRE-IMAGE together. An object's
 * `validations` bind `record` and `previous` and no caller, so a rule naming
 * the caller cannot be evaluated and a caller-blind one refuses the
 * administrator too. A `beforeUpdate` hook has both (`ctx.session`,
 * `ctx.previous`), on the by-id path and per row on a multi-row update.
 *
 * ## The rules
 *
 *  1. A user-context un-revoke (any `revoked` value that is not true) of a row
 *     whose stored `revoked_reason` is `organization_membership_ended` is
 *     refused `403 PERMISSION_DENIED` whoever the caller is, a platform
 *     administrator included. The refusal names the reason and the new-key
 *     road. It is judged first: no standing lifts it.
 *  2. A user-context un-revoke of a row whose stored `revoked_reason` is
 *     `admin_password_reset` is refused `403 PERMISSION_DENIED` unless the
 *     caller has platform-admin standing (`hasPlatformAdminStanding`, the
 *     ADR-0068 D2 rung; fail-closed). The refusal names the reason and both
 *     roads.
 *  3. Every un-revoke this hook admits clears `revoked_reason`, the platform
 *     administrator's included, so a restored key carries no stale reason.
 *  4. A write that revokes, or leaves `revoked` alone, never touches the
 *     reason. Revoking an already-revoked key therefore keeps it, so the owner
 *     cannot launder the reason away with `{ revoked: true }` and then restore.
 *  5. A system-context write is never refused: the mint, the `last_used_at`
 *     stamp, the forced reset itself and a host's own revocation pass
 *     untouched.
 *
 * In this repository the reason is stamped in exactly one place, the forced
 * reset's own write; `organization_membership_ended` is the host's to write.
 *
 * ## Order and shape
 *
 * Registered at priority {@link API_KEY_RESTORE_GUARD_PRIORITY}, after the
 * ADR-0092 D2 identity write guard (10). D2 strips every non-whitelisted
 * column from a user-context write, and `revoked_reason` is deliberately not
 * whitelisted, so a clear written before D2 runs would be stripped. Written
 * after it, the clear is this hook's own write, which the engine keeps.
 *
 * On a multi-row update every matched row is judged by its own `previous`. The
 * payload is shared across those rows, so the clear is keyed on the payload
 * alone (an un-revoke), never on a row, and is written in place: every row
 * writes the same key.
 */

import { hasPlatformAdminStanding } from '@objectstack/core';
import { SystemObjectName } from '@objectstack/spec/system';
import { FORCED_RESET_REVOKE_REASON } from './forced-reset-revocation.js';
import { MEMBERSHIP_ENDED_REVOKE_REASON } from './membership-ended-session.js';

/** After the ADR-0092 D2 identity write guard (10), before default-priority hooks (100). */
export const API_KEY_RESTORE_GUARD_PRIORITY = 15;

export interface ApiKeyRestoreGuardOptions {
  packageId: string;
  logger?: { info(msg: string): void };
}

/**
 * A write is user-context when it carries a real user and is not
 * system-elevated: the same test the ADR-0092 D2 guard applies
 * (`identity-write-guard.ts`), so the two judge the same writes.
 */
function isUserContextWrite(session: unknown): boolean {
  const s = session as { userId?: unknown; isSystem?: unknown } | null | undefined;
  return Boolean(s?.userId) && s?.isSystem !== true;
}

/** True when the payload sets `revoked` to anything that leaves the key usable. */
function isUnrevoke(data: Record<string, unknown>): boolean {
  if (!Object.prototype.hasOwnProperty.call(data, 'revoked')) return false;
  const value = data.revoked;
  return !(value === true || value === 1 || value === 'true' || value === '1');
}

/** The located refusal, on the envelope the REST layer already maps (`mapDataError`). */
function restoreRefused(): Error {
  const err = new Error(
    'PERMISSION_DENIED: This API key was revoked by an administrator\'s forced password reset, so only a '
      + 'platform administrator can restore it. Ask a platform administrator to restore it (the Restore API '
      + 'Key action on the API Keys list), or create a new key (POST /api/v1/keys, or the API Keys page) and '
      + 'replace this one wherever it is configured.',
  ) as Error & { code?: string; status?: number; object?: string };
  err.code = 'PERMISSION_DENIED';
  err.status = 403;
  err.object = SystemObjectName.API_KEY;
  return err;
}

/** Rule 1's refusal, on the same envelope: no user-context caller lifts it. */
function membershipEndedRestoreRefused(): Error {
  const err = new Error(
    'PERMISSION_DENIED: This API key was revoked because its owner\'s membership in the organization ended, '
      + 'so it cannot be restored, not by its owner and not by an administrator: restoring it would give a '
      + 'non-member\'s key its access back. A member of the organization creates a new key instead '
      + '(POST /api/v1/keys, or the API Keys page) and replaces this one wherever it is configured.',
  ) as Error & { code?: string; status?: number; object?: string };
  err.code = 'PERMISSION_DENIED';
  err.status = 403;
  err.object = SystemObjectName.API_KEY;
  return err;
}

/**
 * Register the restore guard on an ObjectQL engine. Re-binding after hot reload
 * follows the engine's standard contract: `engine.unregisterHooksByPackage(packageId)` first.
 */
export function registerApiKeyRestoreGuard(engine: any, opts: ApiKeyRestoreGuardOptions): void {
  const guard = async (ctx: any): Promise<void> => {
    if (ctx?.object !== SystemObjectName.API_KEY) return;
    const data = ctx.input?.data as Record<string, unknown> | null | undefined;
    if (!data || typeof data !== 'object' || !isUnrevoke(data)) return;

    if (isUserContextWrite(ctx.session)) {
      const previous = ctx.previous as Record<string, unknown> | null | undefined;
      // Rule 1, judged before any standing is read: no user-context caller
      // restores a key whose owner's membership ended.
      if (previous?.revoked_reason === MEMBERSHIP_ENDED_REVOKE_REASON) {
        throw membershipEndedRestoreRefused();
      }
      // No pre-image in hand means the reason cannot be read, and an unread
      // reason is treated as the one that needs an administrator: never a
      // fabricated "no reason".
      const adminOnly = !previous || previous.revoked_reason === FORCED_RESET_REVOKE_REASON;
      if (adminOnly && !(await hasPlatformAdminStanding(engine, String(ctx.session.userId)))) {
        throw restoreRefused();
      }
    }

    data.revoked_reason = null;
  };

  engine.registerHook('beforeUpdate', guard, {
    object: SystemObjectName.API_KEY,
    priority: API_KEY_RESTORE_GUARD_PRIORITY,
    packageId: opts.packageId,
  });
  opts.logger?.info(
    '[ApiKeyRestoreGuard] sys_api_key restore guard registered: a key a forced password reset revoked is '
      + 'restored by a platform administrator only, and a key revoked because its owner\'s membership ended '
      + 'by no one',
  );
}
