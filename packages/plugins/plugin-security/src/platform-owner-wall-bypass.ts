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
 *    配置了环境变量邮箱的，在执行墙的时候不要强制加上 org_id 的过滤」): on
 *    READS, the `org_id` tenant filter is NOT appended for a session whose
 *    account satisfies {@link isVerifiedPlatformOwnerRow}. Everyone else's
 *    wall is byte-identical to before the ruling, and WRITES keep today's
 *    behaviour for the owner too — the ADR-0123 D2 org-less write refusal
 *    stands (director's correction on the same card: lifting the write twin
 *    would mint the NULL-organization rows the platform is eliminating).
 *
 * [#13147] The comparison is no longer spelled here at all. `OS_PLATFORM_OWNER_EMAIL`
 * takes ONE address **or a comma-separated list** of them (#11663 Choice 2B),
 * so this module takes the PARSED config — `resolvePlatformAdminEmails()` from
 * `@objectstack/core`, the same one the authorization derivation reads — and
 * asks it. It does not receive, and can no longer be handed, a raw operator
 * string: the type is `PlatformAdminEmailConfig`, so the dialect that read a
 * two-address list as one impossible address cannot be reintroduced by passing
 * the wrong thing. The candidate normalization is the config's own
 * (`normalizePlatformAdminEmail`: trim, then lowercase) — identical in effect to
 * the `String(email).trim().toLowerCase()` this used to spell inline.
 *
 * `walled-owner-operator-stamp.ts` (plugin-auth) and the elevation gate ask the
 * same parser for the same reason. The sites MUST agree — an account the stamp
 * verifies is one the gate must elevate and the wall must recognise.
 *
 * Fail-closed by construction, both directions the ruling pins:
 *  - no declared owner (env unset/blank, or a list REFUSED for an unparseable
 *    entry — `config.emails` is empty in all three) ⇒ `false` for every row —
 *    nobody bypasses, the wall arms exactly as today;
 *  - email mismatch, missing row, or an email match whose row is NOT
 *    verified (`isEmailVerifiedUserRow`'s allow-list, absent-means-
 *    unverified) ⇒ `false` — still walled. There is no shape in which a
 *    misconfiguration widens access.
 */

import { isEmailVerifiedUserRow } from '@objectstack/types';
import { isConfiguredPlatformAdminEmail, type PlatformAdminEmailConfig } from '@objectstack/core';

/**
 * The stable audit event name stamped on every wall-bypassing computation
 * (structured warn-level log today — see the emit site in
 * `security-plugin.ts` for why the `sys_audit_log` ledger is not the sink).
 * Named after the cloud control-plane precedent (`cross_org_admin_read`).
 */
export const PLATFORM_OWNER_WALL_BYPASS_EVENT = 'platform_owner_wall_bypass';

/**
 * Does this `sys_user` row's email match ONE OF the env-declared platform
 * administrators — the canonical #11184/#11343 comparison (trimmed,
 * case-insensitive), asked of the ONE parser.
 *
 * [#13147] `config` is `resolvePlatformAdminEmails()`'s output, never a raw
 * string. A row with no/blank email never matches, and an empty or refused
 * config matches nothing.
 */
export function matchesDeclaredOwnerEmail(row: unknown, config: PlatformAdminEmailConfig): boolean {
  const email = (row as { email?: unknown } | null | undefined)?.email;
  return isConfiguredPlatformAdminEmail(email, config);
}

/**
 * Is this `sys_user` row the VERIFIED declared platform owner? — the whole
 * predicate the Layer 0 owner wall bypass keys on: declared-owner email
 * match AND the #11343 verified-email allow-list. Server-side row facts
 * only; never a client-supplied claim.
 */
export function isVerifiedPlatformOwnerRow(row: unknown, config: PlatformAdminEmailConfig): boolean {
  return matchesDeclaredOwnerEmail(row, config) && isEmailVerifiedUserRow(row);
}
