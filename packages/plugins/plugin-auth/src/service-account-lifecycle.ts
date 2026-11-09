// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0151 D6] The AI service account's lifecycle doors, after registration
 * and the first key (`service-account-doors.ts`):
 *
 *   POST /api/v1/auth/service-account/suspend      { userId, reason? }
 *   POST /api/v1/auth/service-account/resume       { userId }
 *   POST /api/v1/auth/service-account/set-owner    { userId, ownerId }
 *   POST /api/v1/auth/service-account/retire       { userId }
 *   POST /api/v1/auth/service-account/revoke-key   { keyId }
 *   POST /api/v1/auth/service-account/restore-key  { keyId }
 *
 * Every door reads its caller from the signed-in session the mount resolved,
 * as registration does: an API key never reaches them, the account's own
 * included, so an account can neither lift its own stop nor touch its own
 * keys. An id that is not an AI service account (a person's included) is
 * answered as an unknown one.
 *
 * ## Who may act
 *
 * | Door | The owner | An administrator of its organization | A platform administrator |
 * |:--|:--|:--|:--|
 * | suspend | yes | yes | yes |
 * | resume, set-owner, retire | no | yes | yes |
 * | revoke-key, restore-key | yes | yes | yes |
 *
 * The owner counts only while a member of the account's organization. An
 * account's organization is its one membership that holds now; a retired
 * account has none, so only a platform administrator reaches it.
 *
 * ## Suspension is the ban
 *
 * Suspend writes the account's ban state (`banned`, `ban_reason`, no expiry),
 * the state the platform administrator's ban writes, and key admission refuses
 * every key of a banned owner on its next call. Nothing is revoked, so resume
 * (lifting the ban) lets the same keys work again. The owner cannot resume, so
 * an owner cannot undo an administrator's stop; and an account whose owner has
 * left its organization (`service-account-owner-leaves.ts` suspends it) is not
 * resumed until an administrator names a new owner.
 *
 * ## Keys
 *
 * Revoke and restore act on one key of an account and leave the others alone.
 * They follow the restore guard's reasons (`api-key-restore-guard.ts`): a key
 * revoked because a membership ended is never restored, a key an administrator
 * stopped is restored by a platform administrator only, a platform
 * administrator's revoke of a key that carries no reason records
 * `administrator_suspended`, an existing reason is never overwritten, and a
 * restore clears the reason. These doors write as the system (the account's
 * keys are not the caller's own rows), so they apply those rules themselves.
 *
 * ## Retire
 *
 * One act: the account's memberships end and every key it holds is revoked
 * with `organization_membership_ended`. The row stays, so its id keeps joining
 * every row it wrote; the mint door refuses an account with no membership,
 * and no one restores a key revoked for that reason. It is terminal.
 *
 * Every write is the system's, attributed to the person (the mount opens the
 * attribution seam), so the CRUD audit records who acted.
 */

import type { EndpointResult } from './admin-user-endpoints.js';
import { ADMINISTRATOR_SUSPENDED_REVOKE_REASON } from './api-key-restore-guard.js';
import { authSystemWriteContext } from './auth-actor-attribution.js';
import { FORCED_RESET_REVOKE_REASON } from './forced-reset-revocation.js';
import { MEMBERSHIP_ENDED_REVOKE_REASON } from './membership-ended-session.js';
import { isAgentAccountRow } from './service-account-identity.js';
import {
  API_KEY_OBJECT,
  MEMBER_OBJECT,
  USER_OBJECT,
  activeMemberships,
  fail,
  isOrganizationAdministrator,
  parseJson,
  readRows,
  str,
  validationRefusal,
  type ServiceAccountCaller,
  type ServiceAccountDataEngine,
} from './service-account-doors.js';

/** The engine surface the lifecycle doors use. */
export interface ServiceAccountLifecycleEngine extends ServiceAccountDataEngine {
  update(object: string, data: Record<string, unknown>, options?: unknown): Promise<unknown>;
  delete(object: string, options?: unknown): Promise<unknown>;
}

export interface ServiceAccountLifecycleDeps {
  getDataEngine(): ServiceAccountLifecycleEngine | undefined;
  /** Run `work` as one unit of work (the engine's `transaction()`). */
  runAtomically<T>(work: () => Promise<T>): Promise<T>;
  now?(): number;
}

/** The ban reason a suspension records when the caller names none. */
export const SERVICE_ACCOUNT_SUSPENDED_REASON = 'AI service account suspended';

/** The longest ban reason a suspension records. */
const REASON_MAX_LENGTH = 500;

/** The reasons only a platform administrator restores (restore-guard rule 2). */
const PLATFORM_ADMIN_RESTORE_REASONS: readonly string[] = [FORCED_RESET_REVOKE_REASON, ADMINISTRATOR_SUSPENDED_REVOKE_REASON];

type Account = Record<string, unknown> & { id: string };

interface Located {
  engine: ServiceAccountLifecycleEngine;
  account: Account;
  /** The account's organization: its one membership that holds now, or `undefined` when retired. */
  organizationId: string | undefined;
  /** The caller is the owner, and a member of the account's organization. */
  isOwner: boolean;
  /** The caller administers the account's organization, or is a platform administrator. */
  isAdministrator: boolean;
  nowMs: number;
}

const notAnAccount = (id: string): EndpointResult =>
  fail(404, 'RESOURCE_NOT_FOUND', `No AI service account '${id}' exists.`);

/** Read the account and judge who the caller is to it. A person's id is answered as unknown. */
async function locate(
  deps: ServiceAccountLifecycleDeps,
  caller: ServiceAccountCaller,
  accountId: string,
): Promise<Located | EndpointResult> {
  const engine = deps.getDataEngine();
  if (!engine) return fail(503, 'SERVICE_UNAVAILABLE', 'The data service is not available.');
  const nowMs = deps.now?.() ?? Date.now();
  const [account] = await readRows(engine, USER_OBJECT, { id: accountId });
  if (!account || !isAgentAccountRow(account)) return notAnAccount(accountId);
  const [membership] = await activeMemberships(engine, accountId, nowMs);
  const organizationId = str(membership?.organization_id);
  const isOwner = organizationId !== undefined
    && str(account.accountable_user_id) === caller.id
    && (await activeMemberships(engine, caller.id, nowMs, organizationId)).length > 0;
  const isAdministrator = caller.isPlatformAdmin
    || (organizationId !== undefined && (await isOrganizationAdministrator(engine, caller.id, organizationId, nowMs)));
  return { engine, account: account as Account, organizationId, isOwner, isAdministrator, nowMs };
}

const isResult = (v: Located | EndpointResult): v is EndpointResult => 'status' in v && 'body' in v;

const ownerOrAdministrator = (act: string): EndpointResult =>
  fail(
    403,
    'PERMISSION_DENIED',
    `Only the AI service account's accountable owner, an administrator of its organization, or a platform `
      + `administrator can ${act}.`,
  );

const administratorOnly = (act: string): EndpointResult =>
  fail(
    403,
    'PERMISSION_DENIED',
    `Only an administrator of the AI service account's organization, or a platform administrator, can ${act}.`,
  );

const retired = (id: string): EndpointResult =>
  fail(
    409,
    'RESOURCE_CONFLICT',
    `The AI service account '${id}' was retired: it belongs to no organization.`,
  );

/** Read the request's `userId` (or `user_id`). */
async function accountIdOf(request: Request): Promise<{ id: string; body: Record<string, unknown> } | EndpointResult> {
  const read = await parseJson(request);
  if (!read.ok) return fail(400, 'INVALID_REQUEST', read.message);
  const id = str(read.body.userId) ?? str(read.body.user_id);
  if (!id) return fail(400, 'INVALID_REQUEST', 'userId is required: the AI service account to act on.');
  return { id, body: read.body };
}

async function writeUser(engine: ServiceAccountLifecycleEngine, id: string, data: Record<string, unknown>): Promise<void> {
  await engine.update(USER_OBJECT, { id, ...data }, { context: await authSystemWriteContext() });
}

const ok = (data: Record<string, unknown>): EndpointResult => ({ status: 200, body: { success: true, data } });

// ── POST /service-account/suspend ──────────────────────────────────────────

export async function runSuspendServiceAccount(
  deps: ServiceAccountLifecycleDeps,
  caller: ServiceAccountCaller,
  request: Request,
): Promise<EndpointResult> {
  const read = await accountIdOf(request);
  if ('status' in read) return read;
  const reason = str(read.body.reason) ?? SERVICE_ACCOUNT_SUSPENDED_REASON;
  if (reason.length > REASON_MAX_LENGTH) {
    const message = `The suspension reason is at most ${REASON_MAX_LENGTH} characters.`;
    return {
      status: 400,
      body: { success: false, error: { code: 'VALIDATION_FAILED', message, fields: [{ field: 'reason', code: 'max_length', message }] } },
    };
  }
  const found = await locate(deps, caller, read.id);
  if (isResult(found)) return found;
  if (!found.isOwner && !found.isAdministrator) return ownerOrAdministrator('suspend it');

  await writeUser(found.engine, read.id, { banned: true, ban_reason: reason, ban_expires: null });
  return ok({ userId: read.id, suspended: true, reason });
}

// ── POST /service-account/resume ───────────────────────────────────────────

export async function runResumeServiceAccount(
  deps: ServiceAccountLifecycleDeps,
  caller: ServiceAccountCaller,
  request: Request,
): Promise<EndpointResult> {
  const read = await accountIdOf(request);
  if ('status' in read) return read;
  const found = await locate(deps, caller, read.id);
  if (isResult(found)) return found;
  if (!found.isAdministrator) return administratorOnly('resume it');
  if (!found.organizationId) return retired(read.id);

  // No agent is left running with nobody accountable: an owner who has left
  // the organization is replaced first.
  const ownerId = str(found.account.accountable_user_id);
  if (!ownerId || (await activeMemberships(found.engine, ownerId, found.nowMs, found.organizationId)).length === 0) {
    return fail(
      409,
      'RESOURCE_CONFLICT',
      `The AI service account '${read.id}' has no accountable owner in its organization. Name a new owner `
        + '(set-owner) before resuming it.',
    );
  }

  await writeUser(found.engine, read.id, { banned: false, ban_reason: null, ban_expires: null });
  return ok({ userId: read.id, suspended: false });
}

// ── POST /service-account/set-owner ────────────────────────────────────────

export async function runSetServiceAccountOwner(
  deps: ServiceAccountLifecycleDeps,
  caller: ServiceAccountCaller,
  request: Request,
): Promise<EndpointResult> {
  const read = await accountIdOf(request);
  if ('status' in read) return read;
  const ownerId = str(read.body.ownerId) ?? str(read.body.owner_id);
  if (!ownerId) {
    const message = 'Name the person accountable for the AI service account (ownerId).';
    return {
      status: 400,
      body: { success: false, error: { code: 'VALIDATION_FAILED', message, fields: [{ field: 'ownerId', code: 'required', message }] } },
    };
  }
  const found = await locate(deps, caller, read.id);
  if (isResult(found)) return found;
  if (!found.isAdministrator) return administratorOnly('change its owner');
  if (!found.organizationId) return retired(read.id);

  if ((await activeMemberships(found.engine, ownerId, found.nowMs, found.organizationId)).length === 0) {
    const message = `The accountable owner '${ownerId}' is not a member of the AI service account's organization. `
      + 'Name a person who is.';
    return {
      status: 400,
      body: { success: false, error: { code: 'VALIDATION_FAILED', message, fields: [{ field: 'ownerId', code: 'invalid_value', message }] } },
    };
  }

  try {
    // The row rules judge the owner: it exists, is a person, and is not the account.
    await writeUser(found.engine, read.id, { accountable_user_id: ownerId });
  } catch (error) {
    const refused = validationRefusal(error);
    if (refused) return refused;
    throw error;
  }
  return ok({ userId: read.id, ownerId });
}

// ── POST /service-account/retire ───────────────────────────────────────────

export async function runRetireServiceAccount(
  deps: ServiceAccountLifecycleDeps,
  caller: ServiceAccountCaller,
  request: Request,
): Promise<EndpointResult> {
  const read = await accountIdOf(request);
  if ('status' in read) return read;
  const found = await locate(deps, caller, read.id);
  if (isResult(found)) return found;
  if (!found.isAdministrator) return administratorOnly('retire it');
  if (!found.organizationId) return retired(read.id);

  const keys = await readRows(found.engine, API_KEY_OBJECT, { user_id: read.id }, ['id', 'revoked']);
  const context = await authSystemWriteContext();
  await deps.runAtomically(async () => {
    await found.engine.delete(MEMBER_OBJECT, { where: { user_id: read.id }, multi: true, context });
    // Every key, revoked or not: a key an owner revoked must not be restorable
    // either, so each one carries the terminal reason.
    for (const key of keys) {
      const id = str(key.id);
      if (!id) continue;
      await found.engine.update(
        API_KEY_OBJECT,
        { id, revoked: true, revoked_reason: MEMBERSHIP_ENDED_REVOKE_REASON },
        { context },
      );
    }
  });
  return ok({ userId: read.id, retired: true, keysRevoked: keys.length });
}

// ── POST /service-account/revoke-key and restore-key ───────────────────────

interface LocatedKey extends Located {
  key: Record<string, unknown> & { id: string };
}

/** Read the key, then its account; a key that is not an account's is answered as unknown. */
async function locateKey(
  deps: ServiceAccountLifecycleDeps,
  caller: ServiceAccountCaller,
  request: Request,
): Promise<LocatedKey | EndpointResult> {
  const read = await parseJson(request);
  if (!read.ok) return fail(400, 'INVALID_REQUEST', read.message);
  const keyId = str(read.body.keyId) ?? str(read.body.key_id) ?? str(read.body.id);
  if (!keyId) return fail(400, 'INVALID_REQUEST', 'keyId is required: the AI service account\'s key to act on.');
  const engine = deps.getDataEngine();
  if (!engine) return fail(503, 'SERVICE_UNAVAILABLE', 'The data service is not available.');
  const unknownKey = fail(404, 'RESOURCE_NOT_FOUND', `No AI service account key '${keyId}' exists.`);
  // Never the hash: only the columns these rules read.
  const [key] = await readRows(engine, API_KEY_OBJECT, { id: keyId }, ['id', 'user_id', 'revoked', 'revoked_reason']);
  const accountId = str(key?.user_id);
  if (!key || !accountId) return unknownKey;
  const found = await locate(deps, caller, accountId);
  if (isResult(found)) return found.status === 404 ? unknownKey : found;
  return { ...found, key: key as LocatedKey['key'] };
}

export async function runRevokeServiceAccountKey(
  deps: ServiceAccountLifecycleDeps,
  caller: ServiceAccountCaller,
  request: Request,
): Promise<EndpointResult> {
  const found = await locateKey(deps, caller, request);
  if (isResult(found)) return found;
  if (!found.isOwner && !found.isAdministrator) return ownerOrAdministrator('revoke its key');

  const data: Record<string, unknown> = { id: found.key.id, revoked: true };
  // Restore-guard rule 4: a platform administrator's revoke of a key that
  // carries no reason records one only a platform administrator lifts; a
  // reason already on the key is never overwritten.
  const storedReason = str(found.key.revoked_reason);
  if (!storedReason && caller.isPlatformAdmin) data.revoked_reason = ADMINISTRATOR_SUSPENDED_REVOKE_REASON;
  await found.engine.update(API_KEY_OBJECT, data, { context: await authSystemWriteContext() });
  return ok({ id: found.key.id, revoked: true });
}

export async function runRestoreServiceAccountKey(
  deps: ServiceAccountLifecycleDeps,
  caller: ServiceAccountCaller,
  request: Request,
): Promise<EndpointResult> {
  const found = await locateKey(deps, caller, request);
  if (isResult(found)) return found;
  if (!found.isOwner && !found.isAdministrator) return ownerOrAdministrator('restore its key');

  const storedReason = str(found.key.revoked_reason);
  // Restore-guard rule 1: no one restores a key whose membership ended.
  if (storedReason === MEMBERSHIP_ENDED_REVOKE_REASON) {
    return fail(
      403,
      'PERMISSION_DENIED',
      'This key was revoked because the AI service account\'s organization membership ended, so it cannot be '
        + 'restored. Create a new key instead.',
    );
  }
  // Restore-guard rule 2: an administrator's stop is lifted by a platform administrator only.
  if (storedReason && PLATFORM_ADMIN_RESTORE_REASONS.includes(storedReason) && !caller.isPlatformAdmin) {
    return fail(
      403,
      'PERMISSION_DENIED',
      `This key was revoked by an administrator (${storedReason}), so only a platform administrator can restore it. `
        + 'Ask one, or create a new key.',
    );
  }
  if (found.key.revoked !== true && !storedReason) return ok({ id: found.key.id, revoked: false });

  await found.engine.update(
    API_KEY_OBJECT,
    { id: found.key.id, revoked: false, revoked_reason: null },
    { context: await authSystemWriteContext() },
  );
  return ok({ id: found.key.id, revoked: false });
}
