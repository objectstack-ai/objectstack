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
 * Both are matched as the vendor stores them, with a plain identifier. A
 * `verification.storeIdentifier` other than `'plain'` would store them under a
 * digest no prefix or key here could name, so the rule would match nothing; a
 * credential write under such a setting is REFUSED instead
 * ({@link RESET_TOKEN_IDENTIFIER_REFUSAL}). The auth instance sets none, and
 * `credential-change-ends-reset-tokens.test.ts` pins the composed setting.
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
 * the internal adapter outside any endpoint context. So both adapters in that
 * file — the factory `AuthManager` composes and the exported raw
 * `createObjectQLAdapter` — call {@link endResetTokensOnCredentialWrite} on each
 * account write whose payload carries `password`, with the rows that write
 * targets. A targeted row that names no user is refused, never skipped.
 *
 * Before the write, never after it. better-auth runs its own flows on this
 * adapter without a database transaction (the adapter's `transaction` is
 * native only inside a SCIM request), so the order is what keeps the rule: a
 * token that cannot be ended aborts the write, the old password stands and
 * the door answers an error. A write that fails after its tokens were ended
 * costs the user a new reset request, never a live token beside a new
 * password.
 *
 * ## How the rows are deleted
 *
 * With no cache, each token shape is ended by ONE predicate delete
 * (`multi: true`): the user's links by `value` and the identifier prefix, the
 * texted code by its exact identifier. The engine pushes each down to the
 * store, and a link issued while the request runs is matched as long as it
 * lands before the delete.
 *
 * ## Secondary storage
 *
 * With a host `secondaryStorage` (handed to the factory adapter in the
 * `AuthManager` composition; the raw adapter is handed none), better-auth also
 * caches every verification value under `verification:IDENTIFIER`, and the
 * auth instance sets `verification.storeInDatabase`, so the row stays the
 * record. The cache entry of every ended token is deleted too, so a read the
 * cache answers first finds nothing either.
 *
 * A link's cache entry is keyed by its token, which only a read of its row can
 * name, and `sys_verification.identifier` is `internal`, so the link rows are
 * read first and their identifiers recovered through the privileged readback
 * (`internal-field-readback.ts`). That arm then deletes exactly the rows it
 * read, by id, so every row it ends loses its cache entry with it; a predicate
 * delete there could end a row whose cache entry it never named. A link row
 * whose identifier cannot be recovered is REFUSED, never skipped: its cache
 * entry would otherwise outlive it. The texted code's key is known without a
 * read, so its row is ended by the predicate delete in both arms.
 */

import { SystemObjectName } from '@objectstack/spec/system';
import { reattachInternalFieldsOnRead, type InternalFieldResolvingEngine } from './internal-field-readback.js';

/** The identifier prefix of an emailed reset link's row (better-auth `/request-password-reset`). */
export const RESET_LINK_IDENTIFIER_PREFIX = 'reset-password:';

/** The identifier suffix of a texted reset code's row, after the phone number. */
export const RESET_CODE_IDENTIFIER_SUFFIX = '-request-password-reset';

/** better-auth's cache key prefix for a verification value in `secondaryStorage`. */
const CACHE_KEY_PREFIX = 'verification:';

/** The refusal a credential write meets when the verification store does not keep identifiers plain. */
export const RESET_TOKEN_IDENTIFIER_REFUSAL =
  "[auth] a password was not set: this deployment's verification store keeps identifiers other than plain "
  + '(`verification.storeIdentifier`), so the outstanding password-reset tokens of the user cannot be found and '
  + 'ended. A password change must end them. Remove `verification.storeIdentifier`, or keep it `plain`.';

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
  /** better-auth's `verification.storeIdentifier`, as the adapter was built with it. */
  readonly identifierStorage?: unknown;
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
 * its cache entries when a cache is configured. Throws when a read or a delete
 * fails, or when a cached link's key cannot be named, so the caller's write
 * never lands beside a live token.
 */
export async function endOutstandingResetTokens(
  engine: ResetTokenEngine,
  userId: string,
  options: EndResetTokensOptions = {},
): Promise<void> {
  const VERIFICATION = SystemObjectName.VERIFICATION;
  const linkPredicate = { value: userId, identifier: { $startsWith: RESET_LINK_IDENTIFIER_PREFIX } };

  const user = (await engine.findOne(SystemObjectName.USER, {
    where: { id: userId },
    fields: ['id', 'phone_number'],
  })) as { phone_number?: unknown } | null;
  const phone = typeof user?.phone_number === 'string' && user.phone_number.length > 0 ? user.phone_number : undefined;
  const codeIdentifier = phone ? `${phone}${RESET_CODE_IDENTIFIER_SUFFIX}` : undefined;

  const cacheKeys: string[] = [];
  if (options.cache) {
    // The cache arm: name each link's key from its row, then end exactly those rows (header).
    if (typeof options.cache.delete !== 'function') throw new Error(cacheKeyRefusal('every'));
    const links = (await engine.find(VERIFICATION, { where: linkPredicate, fields: ['id', 'identifier'] })) as VerificationRow[];
    if (links.length > 0) {
      if (!options.internalFieldEngine) throw new Error(cacheKeyRefusal(links.length));
      await reattachInternalFieldsOnRead(options.internalFieldEngine, VERIFICATION, links, ['identifier']);
    }
    const unnamed = links.filter((row) => typeof row.identifier !== 'string' || row.identifier.length === 0);
    if (unnamed.length > 0) throw new Error(cacheKeyRefusal(unnamed.length));
    for (const row of links) {
      await engine.delete(VERIFICATION, { where: { id: row.id } });
      cacheKeys.push(`${CACHE_KEY_PREFIX}${row.identifier as string}`);
    }
  } else {
    await engine.delete(VERIFICATION, { where: linkPredicate, multi: true });
  }

  if (codeIdentifier) {
    await engine.delete(VERIFICATION, { where: { identifier: codeIdentifier }, multi: true });
    if (options.cache) cacheKeys.push(`${CACHE_KEY_PREFIX}${codeIdentifier}`);
  }

  for (const key of cacheKeys) {
    await options.cache!.delete(key);
  }
}

function cacheKeyRefusal(count: number | 'every'): string {
  return `[auth] a password was not set: ${count} outstanding password-reset link(s) of the user could not be `
    + 'ended in the secondary storage with their rows. A password change must end them. Check that the auth store '
    + '(sys_verification) is readable through the privileged readback and that the secondary storage offers `delete`, '
    + 'then retry.';
}

/**
 * The adapters' call: when `payload` sets a credential on `sys_account`, end
 * the outstanding reset tokens of every user the write targets, before it
 * lands. Inert for every other write. Refused when the verification store
 * does not keep identifiers plain, and when a targeted row names no user.
 */
export async function endResetTokensOnCredentialWrite(
  engine: ResetTokenEngine,
  objectName: string,
  payload: unknown,
  targets: readonly unknown[],
  options: EndResetTokensOptions = {},
): Promise<void> {
  if (!writesCredential(objectName, payload)) return;
  if (options.identifierStorage !== undefined && options.identifierStorage !== 'plain') {
    throw new Error(RESET_TOKEN_IDENTIFIER_REFUSAL);
  }
  const users = new Set<string>();
  for (const target of targets) {
    const id = accountUserId(target);
    if (!id) {
      throw new Error(
        '[auth] a password was not set: the account row it targets names no user, so the outstanding '
          + 'password-reset tokens of its holder cannot be found and ended.',
      );
    }
    users.add(id);
  }
  for (const userId of users) {
    await endOutstandingResetTokens(engine, userId, options);
  }
}
