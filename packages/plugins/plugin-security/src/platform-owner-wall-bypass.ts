// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#12974] The VERIFIED-platform-owner row predicate — the one comparison the
 * #11343 verified-owner family makes, extracted so its two in-package
 * consumers can never drift:
 *
 *  - **The platform-admin elevation gate** (`bootstrap-platform-admin.ts`,
 *    the twin this comparison is extracted FROM): its walled arm elevates
 *    only an account for which BOTH halves below answer yes. It keeps
 *    consuming the halves separately ({@link matchesDeclaredOwnerEmail} +
 *    `isEmailVerifiedUserRow`) because its two refusal diagnostics —
 *    `walled_owner_not_registered` vs `walled_owner_not_verified` — must
 *    stay distinct.
 *  - **The Layer 0 owner wall bypass** (`security-plugin.ts`
 *    `isVerifiedPlatformOwnerSession`, maintainer ruling 2026-08-29 on the
 *    tracking card, verbatim and untranslated: 「能不能简单点，对于超级管理员，
 *    配置了环境变量邮箱的，在执行墙的时候不要强制加上 org_id 的过滤」): the
 *    `org_id` tenant filter is NOT appended for a session whose account
 *    satisfies {@link isVerifiedPlatformOwnerRow}. Everyone else's wall is
 *    byte-identical to before the ruling.
 *
 * The comparison itself mirrors the elevation gate's owner match, which
 * `walled-owner-operator-stamp.ts` (plugin-auth) already mirrors for the
 * creation-time stamp: candidate `String(email).trim().toLowerCase()`;
 * declared already trimmed by `resolvePlatformOwnerEmail()`, lowercased
 * here. The three sites MUST agree — an account the stamp verifies is one
 * the gate must elevate and the wall must recognise.
 *
 * Fail-closed by construction, both directions the ruling pins:
 *  - no declared owner (env unset/blank) ⇒ `false` for every row — nobody
 *    bypasses, the wall arms exactly as today;
 *  - email mismatch, missing row, or an email match whose row is NOT
 *    verified (`isEmailVerifiedUserRow`'s allow-list, absent-means-
 *    unverified) ⇒ `false` — still walled. There is no shape in which a
 *    misconfiguration widens access.
 */

import { isEmailVerifiedUserRow } from '@objectstack/types';

/**
 * The stable audit event name stamped on every wall-bypassing computation
 * (structured warn-level log today — see the emit site in
 * `security-plugin.ts` for why the `sys_audit_log` ledger is not the sink).
 * Named after the cloud control-plane precedent (`cross_org_admin_read`).
 */
export const PLATFORM_OWNER_WALL_BYPASS_EVENT = 'platform_owner_wall_bypass';

/**
 * Does this `sys_user` row's email match the env-declared platform owner —
 * the canonical #11184/#11343 comparison (trimmed, case-insensitive), spelled
 * once. `declaredEmail` is `resolvePlatformOwnerEmail()`'s output (already
 * trimmed); a row with no/blank email never matches.
 */
export function matchesDeclaredOwnerEmail(row: unknown, declaredEmail: string): boolean {
  const email = (row as { email?: unknown } | null | undefined)?.email;
  if (typeof email !== 'string') return false;
  const candidate = email.trim().toLowerCase();
  if (candidate === '') return false;
  return candidate === declaredEmail.toLowerCase();
}

/**
 * Is this `sys_user` row the VERIFIED declared platform owner? — the whole
 * predicate the Layer 0 owner wall bypass keys on: declared-owner email
 * match AND the #11343 verified-email allow-list. Server-side row facts
 * only; never a client-supplied claim.
 */
export function isVerifiedPlatformOwnerRow(row: unknown, declaredEmail: string): boolean {
  return matchesDeclaredOwnerEmail(row, declaredEmail) && isEmailVerifiedUserRow(row);
}
