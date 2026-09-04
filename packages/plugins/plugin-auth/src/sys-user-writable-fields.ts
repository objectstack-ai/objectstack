// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0092 D1/D3 — the single source of truth for which `sys_user` columns
 * generic write surfaces may touch.
 *
 * Two tiers, subset-by-construction (a spread, not two hand-maintained
 * lists), because the two surfaces intentionally differ:
 *
 *  - the standard edit form / data API may only touch pure profile fields
 *    (enforced server-side by the identity write guard, ADR-0092 D2);
 *  - the admin bulk-identity import may additionally upsert `phone_number`
 *    (sign-in identifier — bulk identity onboarding is that surface's
 *    purpose) and `role`. Import runs under a system context, so it passes
 *    the guard by context, not by whitelist — this constant is its own
 *    field discipline.
 *
 * Everything not listed here is either admin-surface-only (role/ban columns,
 * `manager_id`, `ai_access`, …) or never-direct (email, credentials, every
 * system-managed stamp). See ADR-0092 D1 for the full tier table. Adding a
 * field to `sys_user` never silently opens it — absence means denied.
 *
 * ## Tier 1 has three members, not two (maintainer ruling 2026-09-03)
 *
 * `locale` joined `name` and `image` by a ruling on the "may a user set their
 * own language" question, quoted verbatim and untranslated as adopted:
 * 「同意」to option B. Widening this set is a SECURITY-BOUNDARY act and is
 * the maintainer's to take — the ADR-0092 D1 tier table records the pre-ruling
 * two, and this constant is now the widened one; a reader who finds them
 * disagreeing should trust the ruling and the pins, and see the PR body for
 * the ADR-amendment follow-up.
 *
 * Three things travel with the entry and none of them is optional:
 *  - `sys_user.locale` drops its `readonly` (platform-objects) — otherwise the
 *    engine strips the value before the guard can admit it;
 *  - the column carries a `locale_bcp47_shape` `format` validation rule, so a
 *    malformed tag is refused loudly instead of stored;
 *  - the ADR-0092 D6 session-snapshot mirror does NOT gain it — better-auth
 *    has no `locale` on its user model, so merging one into a cached snapshot
 *    would invent a field only cached sessions carry (see
 *    `SESSION_SNAPSHOT_MIRRORED_FIELDS` in `identity-write-guard.ts`).
 *
 * ⚠️ What this set does NOT decide is WHO. ADR-0092 D5 keeps that with the
 * permission layer, and `member_default` still denies `allowEdit` on
 * `sys_user`, so a rank-and-file member reaches this column through no shipped
 * surface yet. That is a separate opening, deliberately not taken here.
 */

/** Tier 1 — standard form / data-API editable (identity write guard whitelist). */
export const SYS_USER_PROFILE_EDIT_FIELDS: ReadonlySet<string> = new Set([
  'name',
  'image',
  // Maintainer ruling 2026-09-03 (option B). Read per recipient at delivery
  // time by service-messaging; shape-checked at the write by the column's own
  // `locale_bcp47_shape` rule.
  'locale',
]);

/** Import-upsert may additionally touch these (admin bulk-identity surface). */
export const SYS_USER_IMPORT_UPDATE_FIELDS: ReadonlySet<string> = new Set([
  ...SYS_USER_PROFILE_EDIT_FIELDS,
  'phone_number',
  'role',
]);
