// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * oauth-subject-ban — a banned user's OAuth access tokens are refused while
 * the ban holds.
 *
 * A ban holds every credential of the user: it ends their sessions, refuses
 * their sign-in and refuses their API keys (`resolveApiKeyAdmission`). An OAuth
 * access token is a credential of the user who consented to it, and so is the
 * agent forward credential the action door mints from one. This door is where
 * either becomes that user (`resolveExecutionContext`), so the ban is read
 * here, with the one ban predicate every other refusal asks
 * (`isUserBanInForce`, `@objectstack/core`): the ban flag, lifted once its
 * expiry has passed, exactly as sign-in reads it.
 *
 * The verifier (`IAuthService.verifyMcpAccessToken`) stays the local,
 * I/O-free signature check it is documented to be. The ban is a fact about the
 * user, not about the token, and it lives in the store this door already reads
 * for the principal's grants.
 *
 * The answer to a banned subject is the answer a token that does not verify
 * gets at this door: no principal, and no fall-back to a cookie session.
 * Nothing tells the holder whether the token, or its user, is the reason.
 * ⛔ Not a revocation: nothing is written, so lifting the ban (or letting it
 * expire) admits the same token again.
 *
 * One primary-key read of the ban columns, as the system, per credential
 * resolved — the read shape the key-admission seam uses. A read that THROWS
 * is the branded store outage (`AuthzStoreUnavailableError`, 503), never "not
 * banned" and never "no principal"; a `sys_user` table that was never
 * provisioned holds no ban, and a user with no row keeps today's answer.
 */

import { AuthzStoreUnavailableError, isUserBanInForce, USER_BAN_FIELDS } from '@objectstack/core';
import { isMissingTableError } from '@objectstack/types';

/** The one read this module issues — the engine's `find`, as the key-admission seam calls it. */
interface UserRowReader {
  find(object: string, query: Record<string, unknown>): Promise<unknown>;
}

/**
 * True when `userId`'s ban holds at `nowMs`. A door with no data engine has
 * no ban to read and answers false, as it answers today.
 */
export async function isOAuthSubjectBanned(
  ql: Partial<UserRowReader> | null | undefined,
  userId: string,
  nowMs: number = Date.now(),
): Promise<boolean> {
  if (!ql || typeof ql.find !== 'function') return false;
  let row: Record<string, unknown> | undefined;
  try {
    let users: any = await ql.find('sys_user', {
      where: { id: userId },
      fields: [...USER_BAN_FIELDS],
      limit: 1,
      context: { isSystem: true },
    });
    if (users && users.value) users = users.value;
    row = Array.isArray(users) ? users[0] : undefined;
  } catch (err) {
    if (!isMissingTableError(err, 'sys_user')) throw new AuthzStoreUnavailableError('sys_user', err);
  }
  return isUserBanInForce(row, nowMs);
}
