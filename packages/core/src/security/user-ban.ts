// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * user-ban — the ONE predicate for "does this user's ban hold right now".
 *
 * A ban is two columns on the user row (`sys_user.banned`, `sys_user.ban_expires`;
 * better-auth's `banned` / `banExpires`). The vendor's `session.create` hook
 * refuses sign-in for a user whose ban holds, and a ban with an expiry stops
 * binding once the expiry has passed. Every other place that asks whether a
 * user's credentials may act asks this function, so a ban means one thing at
 * every door:
 *
 *  - the API-key admission seam (`resolveApiKeyAdmission`), which answers a
 *    banned owner's key as a key that does not exist;
 *  - plugin-auth's principal-session mint and the agent-forward identity view,
 *    which refuse a banned user.
 *
 * Parity with the vendor's sign-in check, deliberately:
 *  - the flag is the ban; a row without it is not banned whatever the expiry;
 *  - an expiry lifts the ban only once it is strictly in the past;
 *  - an expiry that cannot be read as an instant does not lift the ban (the
 *    vendor compares `NaN < now`, which is false, so the ban holds).
 *
 * ⛔ Read-only. The vendor clears a lapsed ban on the row at sign-in; nothing
 * here writes, so a lapsed ban simply stops binding.
 */

/** The ban columns, in either spelling a store answers with. */
export interface UserBanFields {
  banned?: unknown;
  banExpires?: unknown;
  ban_expires?: unknown;
}

/**
 * The `sys_user` columns a ban reader selects — the storage spelling, which
 * is what the data engine answers with.
 */
export const USER_BAN_FIELDS = ['id', 'banned', 'ban_expires'] as const;

function banFlagSet(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function banExpiryMs(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string' || typeof value === 'number') return new Date(value).getTime();
  return Number.NaN;
}

/**
 * True when `user`'s ban holds at `nowMs`: the ban flag is set, and no expiry
 * has passed. `undefined` / `null` (no row) is not banned.
 */
export function isUserBanInForce(user: UserBanFields | null | undefined, nowMs: number = Date.now()): boolean {
  if (!user || !banFlagSet(user.banned)) return false;
  const expires = user.banExpires ?? user.ban_expires;
  if (expires === undefined || expires === null || expires === '') return true;
  return !(banExpiryMs(expires) < nowMs);
}
