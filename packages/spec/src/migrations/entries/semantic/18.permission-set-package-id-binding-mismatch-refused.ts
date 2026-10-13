// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// A permission set's body `packageId` that disagrees with the package the set
// is saved into is refused at the metadata save and publish doors. Stored rows
// are deliberately not rewritten: every reader already takes the owner from
// the row's binding, so a stored disagreement reads as its binding and is
// refused on its next write.
export const entry: SemanticMigration = {
  id: 'permission-set-package-id-binding-mismatch-refused',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a
  // code span already, and a nested backtick would close it.
  surface:
    'security.permission.packageId (PermissionSetSchema, ADR-0086 D3) saved or published through the '
    + 'metadata API with a value that disagrees with the package the set is saved into: another '
    + 'package\'s id, or any value (the empty string included) on a set saved into no package',
  replacement:
    'no `packageId` in the body: the package the set is saved into is its owner, and every reader of a '
    + 'set\'s owner reads that binding. To make the declared package the owner, save the set into it '
    + '(`?package=<id>` on the REST door, `packageId` in process) instead. A value equal to the package '
    + 'the set is saved into is accepted as before.',
  reason:
    'The seat\'s ruling on the card (refuse, not retire; ADR-0086 D3 declares the key as "the owning '
    + 'package for a package-shipped set (absent ⇒ env-authored)", and retiring it would amend an '
    + 'accepted ADR). Ownership has always followed the binding — the stored row\'s package_id, served '
    + 'as _packageId — in the by-name read, the security catalog and the suggestion reader, so a body '
    + 'that declared another owner was accepted and silently overridden: an author, an AI build above '
    + 'all, wrote an owner it never got and was never told. The save door (draft and publish mode) and '
    + 'the draft promotion behind the per-item publish and the package publish now refuse it, '
    + '400 VALIDATION_ERROR with issues[] at packageId, naming both values and the two remedies; a '
    + 'package publish that meets one aborts the whole batch, as it does on a draft whose name '
    + 'disagrees with its row. The binding judged is the one the write resolves: a draft save that '
    + 'names no package lands in the package of the item\'s active row and is judged against it. '
    + 'Package duplication copies a set that declares its source package as declaring the target. '
    + 'The audience-binding suggestion reader stops reading the body key as a fallback owner for a set '
    + 'with no binding: such a set is environment-authored, so it is offered and derived under no '
    + 'package. ⚠️ STORED ROWS ARE NOT REWRITTEN and there is no D2 conversion: a conversion sees the '
    + 'body alone, never the row\'s binding, so it cannot tell a disagreeing value from an agreeing '
    + 'one. A stored disagreement keeps loading and reads as its binding, exactly as before; it is '
    + 'refused on its next save or publish. The one reading that changes is the suggestion reader\'s '
    + 'for a stored set bound to no package whose body names one: its pending suggestion is no longer '
    + 'offered, and an acceptance recorded under that package is withheld from the everyone anchor at '
    + 'the next derivation, reported at warn with its reason. Ships at once, no grace window and no '
    + 'dual spelling (2026-08-27 maintainer ruling 「短期不考虑渐进」). ADR-0049 / ADR-0086 / ADR-0087.',
  acceptanceCriteria:
    'Search every permission set the metadata API stores — sys_metadata rows of type permission, '
    + 'active and draft — for a body packageId that is not the row\'s package_id (a row with no '
    + 'package_id and any body packageId included), and drop the key or re-save the set into the '
    + 'package it names. Reads never refuse, so a clean boot is NOT a completed sweep: the save or '
    + 'publish that next writes such a row answers 400 VALIDATION_ERROR at packageId, and '
    + '`os migrate meta --stored --apply` records it as that row\'s failure when it rewrites the row. '
    + 'For a set bound to no package whose body named one, check the audience-binding suggestions in '
    + 'Setup: a suggestion that set produced under the named package is no longer offered, and an '
    + 'accepted one is withheld from everyone with a warn line naming the set; bind the set to a '
    + 'position directly, or save it into the package it named. Package source (defineStack '
    + 'permissions) is not judged by this entry: an installed package\'s sets are owned by the '
    + 'package that ships them whatever the body says. The repo and example apps carried zero '
    + 'permission sets with a body packageId at the time of the change, so no fixture had to be '
    + 'rewritten.',
};
