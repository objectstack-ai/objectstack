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
 * ONE resolution, several consumers, by design (#12751) — and since the
 * #11663 platform-admin re-anchor (leg L4) the walled platform-admin
 * ELEVATION GATE this paragraph used to name first is RETIRED: under a
 * walled posture `bootstrapPlatformAdmin` writes no grant row and elevates
 * nobody, it reports. Standing is derived PER REQUEST instead — from a
 * config-anchored verified email, or the legacy unscoped grant row — so the
 * consumer set now includes the authorization derivation itself:
 *
 *  - `matchesConfiguredPlatformAdmin` (`@objectstack/core`
 *    `security/platform-admin.ts`), read at the one derivation site
 *    (`resolve-authz-context.ts` §6b-config), where an UNVERIFIED account
 *    holding a declared address confers nothing — and, through it,
 *    `plugin-auth`'s last-admin guard, whose administrator enumeration must
 *    answer the same question the resolver does;
 *  - `resolvePlatformAdminStanding` (`plugin-security`
 *    `platform-admin-service.ts`), the read-only standing/audit answer the
 *    walled boot reports from, and `isVerifiedPlatformOwnerRow` beside it
 *    (`platform-owner-wall-bypass.ts`), the Layer 0 wall bypass;
 *  - the walled owner-verification boot diagnostic (`plugin-auth`
 *    `walled-owner-verification-path.ts`, where the check decides whether the
 *    declared owner's account is already past needing a verification path).
 *
 * They must all answer "is this row verified?" identically — a drift is no
 * longer just a boot warning forecasting a refusal that will not be made, it
 * is a diagnostic, an audit surface or a guard disagreeing with who actually
 * resolves PLATFORM_ADMIN on the next request. `@objectstack/types` is the
 * shared home every one of those packages already resolves
 * `OS_PLATFORM_OWNER_EMAIL` from (`env.ts`).
 */
export function isEmailVerifiedUserRow(row: unknown): boolean {
  const v = (row as { email_verified?: unknown } | null | undefined)?.email_verified;
  return v === true || v === 1 || v === '1' || v === 'true';
}
