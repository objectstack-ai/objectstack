// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A change to a user's credential ends every other outstanding password-reset
 * token of that user.
 *
 * ## The rule
 *
 * Whenever a user's password is set — a completed reset (the emailed link or
 * the texted code), the user's own `/change-password`, an administrator's
 * `/admin/set-user-password`, a first password (`/set-initial-password`) — every
 * password-reset token still outstanding for that user is ended in the same
 * request, before the new password is written. The token a reset door spends
 * to make the change is spent by that door; every other one is deleted here.
 * A token issued after the change is untouched and resets as usual.
 *
 * An ended token answers exactly what a token that was never issued answers:
 * its `sys_verification` row is gone, so every door that reads it — the reset
 * itself, the emailed link's landing (`GET /reset-password/:token`) and the
 * reset doors' own checks ahead of the vendor handler — finds nothing.
 *
 * Two token shapes are a user's (better-auth 1.7.12):
 *
 *  - the emailed link, `/request-password-reset`: a row keyed
 *    `reset-password:TOKEN` whose value is the user's id;
 *  - the texted code, `/phone-number/request-password-reset`: the row keyed
 *    `PHONE-request-password-reset` for the phone number the user holds — the
 *    reset door finds its user by that number.
 *
 * Both are matched as the vendor stores them, with a plain identifier: the
 * auth instance sets no `verification.storeIdentifier`.
 *
 * ## Where it is wired, and why there
 *
 * Every door that sets a password writes the credential account
 * (`sys_account`) through better-auth's storage adapter
 * (`objectql-adapter.ts`): `internalAdapter.updatePassword` (both reset doors
 * and the administrator's door), `updateAccount` (`/change-password`,
 * `/set-initial-password`) and `createAccount` / `linkAccount` (a password set
 * for a user who holds no local one yet). The adapter is the one seam all of
 * them cross with the user in hand: a database hook's `update.before` is given
 * the patch without the rows it targets, and the administrator's door calls
 * the internal adapter outside any endpoint context. So the adapter calls
 * {@link endResetTokensOnCredentialWrite} on each account write whose payload
 * carries `password`, with the users that write targets.
 *
 * Before the write, never after it. better-auth runs its own flows on this
 * adapter without a database transaction (the adapter's `transaction` is
 * native only inside a SCIM request), so the order is what keeps the rule: a
 * token that cannot be ended aborts the write, the old password stands and
 * the door answers an error. A write that fails after its tokens were ended
 * costs the user a new reset request, never a live token beside a new
 * password.
 *
 * ## Secondary storage
 *
 * With a host `secondaryStorage`, better-auth also caches every verification
 * value under `verification:IDENTIFIER`, and the auth instance sets
 * `verification.storeInDatabase`, so the row stays the record. The cache entry
 * of every ended token is deleted too, so a read the cache answers first finds
 * nothing either. `sys_verification.identifier` is `internal`, so the link
 * tokens' identifiers are recovered through the privileged readback
 * (`internal-field-readback.ts`), and only when a cache is configured.
 */

import { SystemObjectName } from '@objectstack/spec/system';
import { reattachInternalFieldsOnRead, type InternalFieldResolvingEngine } from './internal-field-readback.js';

/** The identifier prefix of an emailed reset link's row (better-auth `/request-password-reset`). */
export const RESET_LINK_IDENTIFIER_PREFIX = 'reset-password:';

/** The identifier suffix of a texted reset code's row, after the phone number. */
export const RESET_CODE_IDENTIFIER_SUFFIX = '-request-password-reset';

/** better-auth's cache key prefix for a verification value in `secondaryStorage`. */
const CACHE_KEY_PREFIX = 'verification:';

/** The engine verbs this seam uses, under the adapter's system context. */
export interface ResetTokenEngine {
  find(object: string, query: Record<string, unknown>): Promise<unknown[]>;
  findOne(object: string, query: Record<string, unknown>): Promise<unknown>;
  delete(object: string, query: Record<string, unknown>): Promise<unknown>;
}

/** The one verb of better-auth's `secondaryStorage` this seam uses. */
export interface ResetTokenCache {
  delete(key: string): unknown;
}

export interface EndResetTokensOptions {
  /** The host's `secondaryStorage`, when one is configured. */
  readonly cache?: ResetTokenCache;
  /** The RAW engine, holder of the privileged `resolveInternalField`. */
  readonly internalFieldEngine?: InternalFieldResolvingEngine;
}

/**
 * Whether an adapter write sets a credential: a `sys_account` row whose
 * payload carries `password` (any value, a cleared one included).
 */
export function writesCredential(objectName: string, payload: unknown): boolean {
  if (objectName !== SystemObjectName.ACCOUNT) return false;
  if (!payload || typeof payload !== 'object') return false;
  return (payload as Record<string, unknown>).password !== undefined;
}

/** The user id an account row (or create payload) names, in either spelling. */
export function accountUserId(row: unknown): string | undefined {
  if (!row || typeof row !== 'object') return undefined;
  const r = row as Record<string, unknown>;
  const id = r.user_id ?? r.userId;
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}

type VerificationRow = { id?: unknown; identifier?: unknown };

/**
 * End every outstanding password-reset token of `userId`: delete its rows, and
 * its cache entries when a cache is configured. Answers how many were ended.
 * Throws when a read or a delete fails, so the caller's write never lands
 * beside a live token.
 */
export async function endOutstandingResetTokens(
  engine: ResetTokenEngine,
  userId: string,
  options: EndResetTokensOptions = {},
): Promise<number> {
  const VERIFICATION = SystemObjectName.VERIFICATION;
  const links = (await engine.find(VERIFICATION, {
    where: { value: userId, identifier: { $startsWith: RESET_LINK_IDENTIFIER_PREFIX } },
    fields: ['id', 'identifier'],
  })) as VerificationRow[];

  const user = (await engine.findOne(SystemObjectName.USER, {
    where: { id: userId },
    fields: ['id', 'phone_number'],
  })) as { phone_number?: unknown } | null;
  const phone = typeof user?.phone_number === 'string' && user.phone_number.length > 0 ? user.phone_number : undefined;
  const codeIdentifier = phone ? `${phone}${RESET_CODE_IDENTIFIER_SUFFIX}` : undefined;
  const codes = codeIdentifier
    ? ((await engine.find(VERIFICATION, { where: { identifier: codeIdentifier }, fields: ['id'] })) as VerificationRow[])
    : [];

  const rows = [...links, ...codes].filter((r) => typeof r?.id === 'string' || typeof r?.id === 'number');
  if (rows.length === 0) return 0;

  const cacheKeys = new Set<string>();
  if (options.cache) {
    if (links.length > 0 && options.internalFieldEngine) {
      await reattachInternalFieldsOnRead(options.internalFieldEngine, VERIFICATION, links, ['identifier']);
    }
    for (const row of links) {
      if (typeof row.identifier === 'string' && row.identifier.length > 0) cacheKeys.add(`${CACHE_KEY_PREFIX}${row.identifier}`);
    }
    if (codeIdentifier) cacheKeys.add(`${CACHE_KEY_PREFIX}${codeIdentifier}`);
  }

  for (const row of rows) {
    await engine.delete(VERIFICATION, { where: { id: row.id } });
  }
  for (const key of cacheKeys) {
    await options.cache!.delete(key);
  }
  return rows.length;
}

/**
 * The adapter's call: when `payload` sets a credential on `sys_account`, end
 * the outstanding reset tokens of every user the write targets, before it
 * lands. Inert for every other write.
 */
export async function endResetTokensOnCredentialWrite(
  engine: ResetTokenEngine,
  objectName: string,
  payload: unknown,
  targets: readonly unknown[],
  options: EndResetTokensOptions = {},
): Promise<void> {
  if (!writesCredential(objectName, payload)) return;
  const users = new Set<string>();
  for (const target of targets) {
    const id = accountUserId(target);
    if (id) users.add(id);
  }
  for (const userId of users) {
    await endOutstandingResetTokens(engine, userId, options);
  }
}
