// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Share access-level vocabulary — the one place `read` / `edit` (and the
 * retired `full`) are defined for this plugin.
 *
 * ## Why `full` is gone (#3865)
 *
 * `full` was declared as "Full Access (Transfer, Share, Delete)" but **no code
 * path ever granted transfer, re-share, or delete because of it**: the read
 * gate (`buildReadFilter`), the bulk-write gate (`buildWriteFilter`) and the
 * per-record gate (`canEdit`) all matched `access_level in ('edit','full')`, so
 * it was byte-equivalent to `edit`. An admin picking "Full Access" in Setup was
 * told they had granted delete rights and had not — declared-but-unenforced
 * metadata, the exact authoring trap ADR-0078 / ADR-0049 ban, and the reason
 * `recipient_type: 'queue'` was removed before it.
 *
 * It is not coming back as an enum member. Record sharing widens **which rows**
 * a principal reaches, never **which verbs** they may use — the same split
 * Salesforce enforces (its sharing rules stop at Read-Only / Read-Write; Full
 * Access is owner / hierarchy / Modify All only, never grantable by a rule) and
 * Dataverse enforces by AND-ing every shared access right against the security
 * role's own privilege. Delete and transfer belong to ownership, the ADR-0057
 * DEPTH scopes, and admin scope. A future per-record delete grant would be a
 * capability mask AND-ed with object CRUD, not a fourth level.
 *
 * ## The three-layer posture (ADR-0090 D4 idiom)
 *
 * 1. **Authoring rejects** — `SharingLevel` / the `Field.select` enums no longer
 *    offer `full`; {@link normalizeAccessLevel} turns an explicit `full` from an
 *    older client into `edit` and rejects anything unrecognised outright.
 * 2. **Runtime tolerates** — the enforcement gates keep matching
 *    {@link WRITE_ACCESS_LEVELS}, so a row persisted before the backfill ran is
 *    still honoured (it means `edit`; refusing it would silently REVOKE access).
 * 3. **Data normalises** — a boot backfill rewrites stored `full` rows to
 *    `edit`. Behaviour-preserving by construction, because the two were already
 *    equivalent.
 */

import type { ShareAccessLevel } from '@objectstack/spec/contracts';

/** The authorable levels, in widening order. */
export const ACCESS_LEVELS: readonly ShareAccessLevel[] = ['read', 'edit'];

/**
 * Retired spellings that map losslessly onto an authorable level.
 *
 * `full` → `edit` is lossless *because* `full` was inert: the two already
 * behaved identically, so rewriting one to the other cannot change any access
 * decision. (Contrast the OWD `sharingModel: 'full'` alias retired in ADR-0090
 * D4, which had no equivalent target and had to be delegated to the author.)
 */
const RETIRED_ACCESS_LEVELS: Readonly<Record<string, ShareAccessLevel>> = {
  full: 'edit',
};

/**
 * Levels that open the write gate, INCLUDING the retired `full`.
 *
 * Deliberately wider than {@link ACCESS_LEVELS}: enforcement reads persisted
 * rows, which may predate normalisation. Dropping `full` here would silently
 * revoke access from every not-yet-migrated grant — a fail-open→fail-closed
 * flip nobody asked for. Authoring narrowness and enforcement tolerance are
 * different jobs.
 */
export const WRITE_ACCESS_LEVELS: readonly string[] = ['edit', 'full'];

/** `true` when `value` is a stored level this plugin still honours. */
export function isKnownAccessLevel(value: unknown): boolean {
  return typeof value === 'string'
    && (ACCESS_LEVELS.includes(value as ShareAccessLevel) || value in RETIRED_ACCESS_LEVELS);
}

/**
 * Normalise an inbound access level to the authorable vocabulary.
 *
 * - `read` / `edit` pass through.
 * - `full` normalises to `edit` — quietly, because it is what `full` already
 *   meant; failing an old client's request would be a regression with no
 *   security benefit.
 * - anything else (including `null`/`undefined` when no `fallback` is given)
 *   throws `VALIDATION_FAILED`, which the REST layer maps to a 400. Silently
 *   coercing an unrecognised level would be the same silent-inertness bug in a
 *   new spot: a caller asking for `admin` must be told it does not exist, not
 *   handed a `read` grant they did not request.
 *
 * @param value    the inbound level (typically from an HTTP body or a rule row)
 * @param fallback level to use when `value` is null/undefined; omit to require one
 */
export function normalizeAccessLevel(
  value: unknown,
  fallback?: ShareAccessLevel,
): ShareAccessLevel {
  if (value == null || value === '') {
    if (fallback !== undefined) return fallback;
    throw new Error('VALIDATION_FAILED: accessLevel is required');
  }
  if (typeof value === 'string') {
    if (ACCESS_LEVELS.includes(value as ShareAccessLevel)) return value as ShareAccessLevel;
    const retired = RETIRED_ACCESS_LEVELS[value];
    if (retired) return retired;
  }
  throw new Error(
    `VALIDATION_FAILED: accessLevel must be one of ${ACCESS_LEVELS.join(' | ')} `
    + `(received ${JSON.stringify(value)})`,
  );
}

/**
 * Normalise a level read back OUT of storage. Never throws.
 *
 * The write-path twin ({@link normalizeAccessLevel}) rejects an unrecognised
 * level so the caller learns immediately. A read path cannot do that: the row
 * already exists, and throwing while projecting it would take down the rule
 * evaluator or the admin list view over one bad byte. So this one fails
 * **closed** — an unrecognised stored level degrades to `read`, the narrowest
 * level, rather than being trusted or crashing (the same fail-closed posture
 * `effectiveSharingModel` takes for an unknown `sharingModel`).
 */
export function normalizeStoredAccessLevel(value: unknown): ShareAccessLevel {
  try {
    return normalizeAccessLevel(value, 'read');
  } catch {
    return 'read';
  }
}
