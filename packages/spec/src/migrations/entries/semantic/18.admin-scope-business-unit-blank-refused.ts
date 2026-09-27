// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The delegated-admin scope's one required key, required NON-BLANK. Stored
// scopes are deliberately not rewritten: the root of a subtree cannot be
// inferred from a blank, so the stored row is refused on its next write and
// named by the boot reconciliation's existing durability error instead.
export const entry: SemanticMigration = {
  id: 'admin-scope-business-unit-blank-refused',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a
  // code span already, and a nested backtick would close it.
  surface:
    'security.permission.adminScope.businessUnit (AdminScopeSchema, ADR-0090 D12) authored or stored '
    + 'BLANK: the empty string, or a value that is nothing but whitespace (spaces, a tab, a newline). '
    + 'The key is the scope\'s only required one and names the root business unit of the delegated '
    + 'subtree; a blank value satisfied the requirement while naming no unit',
  replacement:
    'the sys_business_unit.name (machine name) of the business unit at the root of the subtree the '
    + 'delegate administers, written out: `businessUnit: \'north_america\'`. If the permission set '
    + 'should not delegate administration at all, remove `adminScope` from it. ⛔ There is no '
    + 'replacement that can be DERIVED from what was written: a blank names no unit, so the root the '
    + 'author meant is not recoverable, and the platform must not pick one.',
  reason:
    'Maintainer ruling A on #19461 (decision batch #217 item 1, 2026-09-23 「217 同意」). '
    + '`AdminScopeSchema` declared `businessUnit` as a bare string with no minimum, so '
    + '`{ businessUnit: \'\' }` and `{ businessUnit: \'   \' }` parsed green — measured against the '
    + 'published spec 17.4.0 and re-measured on `main` before the change. This narrows a published '
    + 'face: every other key of the scope is scoped TO this one, and ADR-0090 D12 declares the scope\'s '
    + 'WHERE as a business-unit subtree, which a blank does not name. The delegated-admin gate '
    + 'resolves the anchor by exact name, so a blank anchor resolves to an empty subtree and approves '
    + 'nothing on the subtree axes — no escalation was measured; the defect is a declaration that '
    + 'does not enforce what it declares, satisfied most readily by an author (an AI author above '
    + 'all) that knew the key was required and did not yet know the unit. The refusal is a '
    + 'NON-TRANSFORMING refinement at the key\'s own path, deliberately not a trim: the metadata save '
    + 'path persists the submitted body verbatim rather than the parsed value, so a trimming schema '
    + 'would validate one string and store another that the gate\'s exact lookup cannot resolve. A '
    + 'real name therefore parses byte-identical. Scope is blankness only: a real name with '
    + 'surrounding whitespace is not judged by this entry. ⚠️ STORED ROWS ARE NOT REWRITTEN and there '
    + 'is no D2 conversion (no lossless rewrite exists — the root cannot be inferred, and dropping '
    + 'the scope would silently change who is a delegate). The read path does not re-validate stored '
    + 'rows, so no stored permission set becomes unreadable. A stored blank-anchored scope is refused '
    + 'on its NEXT WRITE instead: a Setup or data-door edit of that permission set answers 422 '
    + 'INVALID_METADATA naming adminScope.businessUnit, and the boot reconciliation backfill of a '
    + 'legacy record with no metadata definition reports it through its existing durability ERROR '
    + '(ADR-0094 D4), whose own prescription is to make the record body spec-valid; restoring a '
    + 'trashed blank-anchored set brings the record back and reports the missing definition at ERROR '
    + 'the same way. ⛔ No path skips the row. Ships at once, no grace window and no dual spelling '
    + '(2026-08-27 maintainer ruling 「短期不考虑渐进」). ADR-0049 / ADR-0087 / ADR-0090.',
  acceptanceCriteria:
    'Search every authored and stored permission set for an `adminScope` whose `businessUnit` is '
    + 'empty or whitespace-only — metadata files, `sys_metadata` permission rows, and the '
    + '`admin_scope` column of `sys_permission_set` — and write the root unit\'s machine name, or '
    + 'remove `adminScope` where the set should not delegate. The sweep is mechanical for authored '
    + 'metadata: `AdminScopeSchema.safeParse` and `PermissionSetSchema.safeParse` answer exactly one '
    + '`custom` issue at `businessUnit` (or `adminScope.businessUnit` when the set is parsed whole) '
    + 'naming `sys_business_unit.name` as the valid anchor. For STORED rows the search above is the '
    + 'catch-all, because reads never refuse: a definition already stored in `sys_metadata` with a '
    + 'blank anchor loads and resolves exactly as before and says nothing until it is written again. '
    + 'Two write paths then name it: a re-save of the set (refused 422 at adminScope.businessUnit), '
    + 'and — for a legacy `sys_permission_set` record with no metadata definition only — the boot '
    + 'log, where the ADR-0094 D4 backfill\'s first-failure ERROR names the record and carries the '
    + 'offending key and its summary ERROR counts and names the failed records. ⛔ A clean boot is '
    + 'therefore NOT a completed sweep. An absent `businessUnit` is refused exactly as before, with its own invalid_type issue. Nothing is '
    + 'normalised on the way through: an accepted anchor arrives byte-identical to what was written. '
    + 'The repo and example apps carried zero blank anchors at the time of the change, so no fixture '
    + 'had to be rewritten.',
};
