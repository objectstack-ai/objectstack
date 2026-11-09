// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0151 D6] When an AI service account's accountable owner leaves the
 * account's organization, the account is suspended, so no agent is left
 * running with nobody accountable for it. It stays suspended until an
 * administrator names a new owner (`set-owner`) and resumes it: resume
 * refuses an account whose owner is not a member (`service-account-lifecycle.ts`).
 *
 * Suspension is the ban (`banned`, `ban_reason`, no expiry): key admission
 * refuses every key of a banned owner on its next call, and nothing is
 * revoked, so a resume lets the same keys work again.
 *
 * ## The seam
 *
 * The same two engine hooks the membership-ended session trigger binds
 * (`membership-ended-session.ts`, whose header records the census): an
 * `afterDelete` on `sys_member` (the vendor's remove-member, a direct or bulk
 * delete, the cascade from a `sys_user` delete) and an `afterUpdate` that
 * moves a membership's `organization_id`. Both are AFTER hooks, so a removal
 * the platform refused (the last-admin guard) suspends nothing.
 *
 * Only the owner's leaving the ACCOUNT'S organization counts: an owner who
 * leaves another organization is still accountable here. An account already
 * suspended keeps its own reason.
 *
 * ## Best-effort, and loud about it
 *
 * A failed suspension never turns a successful member removal into an error:
 * the removal already happened. Each failure is logged with what it costs (the
 * account keeps running with an owner who has left), so the operator can stop
 * it by hand.
 */

import { authSystemWriteContext } from './auth-actor-attribution.js';
import { isAgentAccountRow } from './service-account-identity.js';

const USER_OBJECT = 'sys_user';
const MEMBER_OBJECT = 'sys_member';
const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

/** The ban reason the owner's leaving records. */
export const SERVICE_ACCOUNT_OWNER_LEFT_REASON = 'Accountable owner left the organization';

type LoggerLike = {
  info?(msg: string, meta?: unknown): void;
  warn(msg: string, meta?: unknown): void;
};

/** The slice of the engine this module uses. */
export interface ServiceAccountOwnerLeavesEngine {
  find(object: string, query: unknown, options?: unknown): Promise<unknown>;
  update(object: string, data: unknown, options?: unknown): Promise<unknown>;
  registerHook(event: string, handler: (ctx: any) => unknown, options?: unknown): void;
  unregisterHooksByPackage?(packageId: string): void;
}

export interface ServiceAccountOwnerLeavesOptions {
  /** Owning package id: used for `unregisterHooksByPackage` on re-bind. */
  packageId: string;
  logger?: LoggerLike;
}

function idOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function rowsOf(found: unknown): Record<string, unknown>[] {
  const value = found && typeof found === 'object' && 'value' in (found as object) ? (found as { value: unknown }).value : found;
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

/**
 * `userId` has left `organizationId`: suspend every AI service account that
 * person owns in that organization. Returns the ids it suspended.
 */
export async function suspendAccountsOfDepartedOwner(
  engine: ServiceAccountOwnerLeavesEngine,
  ended: { userId: string; organizationId: string },
  opts: { logger?: LoggerLike } = {},
): Promise<string[]> {
  const { userId, organizationId } = ended;
  const suspended: string[] = [];
  try {
    // Still a member there (a second row): nothing ended for the accounts.
    const remaining = rowsOf(await engine.find(MEMBER_OBJECT, {
      where: { user_id: userId, organization_id: organizationId },
      fields: ['id'],
      limit: 1,
      context: SYSTEM_CTX,
    }));
    if (remaining.length > 0) return suspended;

    const owned = rowsOf(await engine.find(USER_OBJECT, {
      where: { accountable_user_id: userId },
      fields: ['id', 'principal_kind', 'accountable_user_id', 'banned'],
      context: SYSTEM_CTX,
    })).filter(isAgentAccountRow);
    if (owned.length === 0) return suspended;

    const context = await authSystemWriteContext();
    for (const account of owned) {
      const accountId = idOf(account.id);
      if (!accountId || account.banned === true) continue;
      const inOrganization = rowsOf(await engine.find(MEMBER_OBJECT, {
        where: { user_id: accountId, organization_id: organizationId },
        fields: ['id'],
        limit: 1,
        context: SYSTEM_CTX,
      }));
      if (inOrganization.length === 0) continue;
      try {
        await engine.update(
          USER_OBJECT,
          { id: accountId, banned: true, ban_reason: SERVICE_ACCOUNT_OWNER_LEFT_REASON, ban_expires: null },
          { context },
        );
        suspended.push(accountId);
      } catch (e) {
        opts.logger?.warn(
          '[ServiceAccountOwnerLeaves] could not suspend an AI service account whose owner left its organization: '
            + 'it keeps running with nobody accountable. Suspend it by hand.',
          { accountId, ownerId: userId, organizationId, error: (e as Error)?.message },
        );
      }
    }
  } catch (e) {
    opts.logger?.warn(
      '[ServiceAccountOwnerLeaves] could not read the AI service accounts of an owner who left an organization: '
        + 'any such account keeps running with nobody accountable. Check read access on sys_user / sys_member.',
      { ownerId: userId, organizationId, error: (e as Error)?.message },
    );
  }
  if (suspended.length > 0) {
    opts.logger?.info?.(
      `[ServiceAccountOwnerLeaves] suspended ${suspended.length} AI service account(s) whose owner left the organization`,
      { ownerId: userId, organizationId, accountIds: suspended },
    );
  }
  return suspended;
}

/**
 * Bind the trigger: `afterDelete` and an organization-moving `afterUpdate` on
 * `sys_member`. Idempotent per package, like the sibling triggers.
 */
export function registerServiceAccountOwnerLeavesTrigger(
  engine: ServiceAccountOwnerLeavesEngine,
  opts: ServiceAccountOwnerLeavesOptions,
): void {
  const { packageId, logger } = opts;

  const onDelete = async (ctx: any): Promise<void> => {
    if (ctx?.object !== MEMBER_OBJECT) return;
    const previous = ctx?.previous;
    const userId = idOf(previous?.user_id);
    const organizationId = idOf(previous?.organization_id);
    if (!userId || !organizationId) return;
    await suspendAccountsOfDepartedOwner(engine, { userId, organizationId }, { logger });
  };

  const onUpdate = async (ctx: any): Promise<void> => {
    if (ctx?.object !== MEMBER_OBJECT) return;
    const data = ctx?.input?.data as Record<string, unknown> | undefined;
    if (!data || !('organization_id' in data)) return;
    const previous = ctx?.previous;
    const before = idOf(previous?.organization_id);
    if (!before || before === idOf(data.organization_id)) return;
    const userId = idOf(previous?.user_id) ?? idOf(data.user_id);
    if (!userId) return;
    await suspendAccountsOfDepartedOwner(engine, { userId, organizationId: before }, { logger });
  };

  if (typeof engine.unregisterHooksByPackage === 'function') {
    try {
      engine.unregisterHooksByPackage(packageId);
    } catch {
      /* first bind: nothing registered yet */
    }
  }
  engine.registerHook('afterDelete', onDelete, { object: MEMBER_OBJECT, packageId });
  engine.registerHook('afterUpdate', onUpdate, { object: MEMBER_OBJECT, packageId });
}
