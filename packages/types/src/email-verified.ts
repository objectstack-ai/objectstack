// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#11343 / #12751] Verified-email predicate over a stored `sys_user` row — a
 * fail-closed ALLOW-LIST over the representations a driver may hand back for
 * the `sys_user.email_verified` boolean column (JS `true`, SQLite `1`, and
 * their stringified forms). Everything else — `false`/`0`, `null`, an ABSENT
 * field on an imported/legacy row, or any representation not listed — reads
 * as UNVERIFIED. Absent-means-unverified is deliberate: treating a missing
 * column as verified would re-open the exact hole this predicate closes for
 * every row that predates the column.
 *
 * ONE resolution, two consumers, by design (#12751): the walled
 * platform-admin elevation gate (`plugin-security`
 * `bootstrapPlatformAdmin`, where the check REFUSES an unverified owner
 * match) and the walled owner-verification boot diagnostic (`plugin-auth`
 * `walled-owner-verification-path.ts`, where the check decides whether the
 * declared owner's account is already past needing a verification path).
 * Those two must answer "is this row verified?" identically — a drift means
 * a boot warning that forecasts a refusal the gate will not make, or stays
 * silent about one it will. `@objectstack/types` is the shared home both
 * packages already resolve `OS_PLATFORM_OWNER_EMAIL` from (`env.ts`).
 */
export function isEmailVerifiedUserRow(row: unknown): boolean {
  const v = (row as { email_verified?: unknown } | null | undefined)?.email_verified;
  return v === true || v === 1 || v === '1' || v === 'true';
}
