// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// A permission set's body `packageId` that disagrees with the package the set
// is shipped from or saved into is refused at every door that files it under a
// package: the stack schema (defineStack, os validate, os build, an artifact
// load), the package registration (ObjectQL.registerApp), and the metadata save,
// restore and publish doors. Stored rows are deliberately not rewritten: every
// reader already takes the owner from the row's binding, so a stored
// disagreement reads as its binding and is refused on its next write.
export const entry: SemanticMigration = {
  id: 'permission-set-package-id-binding-mismatch-refused',
  surface:
    'security.permission.packageId (PermissionSetSchema, ADR-0086 D3) with a value that disagrees with '
    + 'the package the set is shipped from or saved into: another package\'s id, or any value (the empty '
    + 'string included) on a set that no package ships or that is saved into no package. Judged in '
    + 'package source (the stack schema: defineStack, os validate, os build, an artifact load), at '
    + 'package registration (ObjectQL.registerApp), and at the metadata API\'s save, restore and publish',
  replacement:
    'no `packageId` in the body: the package that ships the set, or that it is saved into, is its '
    + 'owner, and every reader of a set\'s owner reads that binding. To make the declared package the '
    + 'owner, ship the set from that package\'s stack, or save the set into it (`?package=<id>` on the '
    + 'REST door, `packageId` in process) instead. A value equal to that package is accepted as before.',
  reason:
    'The seat\'s ruling on the card (refuse, not retire; ADR-0086 D3 declares the key as "the owning '
    + 'package for a package-shipped set (absent ⇒ env-authored)", and retiring it would amend an '
    + 'accepted ADR). Ownership has always followed the binding — the stored row\'s package_id, served '
    + 'as _packageId — in the by-name read, the security catalog and the suggestion reader, so a body '
    + 'that declared another owner was accepted and silently overridden: an author, an AI build above '
    + 'all, wrote an owner it never got and was never told. The save door (draft and publish mode), '
    + 'the restore doors (a version rollback and the restore limb of a commit revert) and the draft '
    + 'promotion behind the per-item publish and the package publish now refuse it, '
    + '400 VALIDATION_ERROR with issues[] at packageId, naming both values and the two remedies; a '
    + 'package publish that meets one aborts the whole batch, as it does on a draft whose name '
    + 'disagrees with its row, and a commit revert reports it in failed[]. Package source and package '
    + 'registration refuse it too, where a set used to be registered under the package that ships it '
    + 'whatever its body said: the stack schema raises an issue at permissions[i].packageId (each '
    + 'packages[] body\'s sets judged against that body\'s id), so defineStack throws STACK_SCHEMA_INVALID '
    + 'and os validate and os build fail, and ObjectQL.registerApp throws 400 VALIDATION_ERROR before the '
    + 'set is filed. The binding judged is the one the write resolves: a draft save that '
    + 'names no package lands in the package of the item\'s active row and is judged against it. '
    + 'Package duplication copies a set that declares its source package as declaring the target. '
    + 'The audience-binding suggestion reader stops reading the body key as a fallback owner for a set '
    + 'with no binding: such a set is environment-authored, so it is offered and derived under no '
    + 'package. ⚠️ STORED ROWS ARE NOT REWRITTEN and there is no D2 conversion: a conversion sees the '
    + 'body alone, never the row\'s binding, so it cannot tell a disagreeing value from an agreeing '
    + 'one. A stored disagreement keeps loading and reads as its binding, exactly as before; it is '
    + 'refused on its next save, publish, or restore of a version that carries it. The one reading that changes is the suggestion reader\'s '
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
    + 'A stored history version (sys_metadata_history) can carry one too and is never rewritten: a '
    + 'rollback to it, or a commit revert that restores it, answers 400 VALIDATION_ERROR at packageId '
    + '(failed[] for the revert); save the set again with the key dropped or set to its package instead. '
    + 'For a set bound to no package whose body named one, check the audience-binding suggestions in '
    + 'Setup: a suggestion that set produced under the named package is no longer offered, and an '
    + 'accepted one is withheld from everyone with a warn line naming the set; bind the set to a '
    + 'position directly, or save it into the package it named. Package source is judged too: search '
    + 'every stack\'s permissions, and each packages[] body\'s, for a body packageId that is not the '
    + 'id of the package that ships it (the stack\'s manifest.id, or the body\'s id; any value on a '
    + 'stack with no manifest), and drop it; os validate names each one at its packageId. A package '
    + 'artifact built before the change that carries one is refused when it is loaded or registered: '
    + 'rebuild it without the key. The repo and example apps carried zero permission sets with a body '
    + 'packageId at the time of the change, so no fixture had to be rewritten.',
};
