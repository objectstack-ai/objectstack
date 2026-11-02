// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// ADR-0146 D11 — a runtime narrowing at the metadata write doors with no
// authorable key: a write naming no package onto an item an installed package
// ships is refused where `os migrate packageless-overlays` can move its row
// as a declared override (a row it moves as the pair's own member stays open).
// Registered because an upgrading deployment can carry the package-less Setup
// rows those writes made, and the operator step that moves them into the
// base's `.custom` pair ships in this same release, so it runs AFTER the
// upgrade (the release-timing ruling on the card).
export const entry: SemanticMigration = {
  id: 'packageless-overlay-write-closed',
  surface:
    'a metadata write that names no package (PUT, DELETE, publish or rollback under '
    + '/api/v1/meta/<type>/<name> with no ?package=, and the metadata item page, in Studio\'s All '
    + 'metadata area where Setup\'s metadata URLs now land, when its URL holds no ?package=) onto a '
    + 'view, dashboard, report, translation or email template that one installed read-only package '
    + 'ships, where `os migrate packageless-overlays` would move the row into that package\'s '
    + 'paired `<base>.custom`; and the package-less sys_metadata rows Setup\'s form stored that way',
  replacement:
    'after upgrading, run `os migrate packageless-overlays` (preview) on each deployment with '
    + 'Setup customizations, with the flags and environment the deployment boots with (`--preset` '
    + 'and `--dev` mean what they mean to `os serve`), then `os migrate packageless-overlays '
    + '--apply`: it moves each `movable` row into the base\'s paired `<base>.custom`, declaring '
    + '`overrides: { package: <base>, basedOn: <installed version> }`, except a row of an email '
    + 'template locale the base does not ship (the preview names it `addedMember`), which it moves '
    + 'as the pair\'s own member at that locale, declaring nothing (its outcome is `moved` with that '
    + '`addedMember` in place of a `basedOn`). From then on write that customization into the '
    + 'pair: `PUT /api/v1/meta/<type>/<name>?package=<base>.custom` with the `overrides` declaration '
    + 'in the body (an added member\'s with none), and `DELETE /api/v1/meta/<type>/<name>?package='
    + '<base>.custom` to restore the package original (an added member\'s removes it). An added '
    + 'member\'s package-less write stays open, before and after its move. Every row the preview '
    + 'lists and does not move keeps its package-less write: `multi_shipped` (several packages ship '
    + 'the name): delete it naming no package, then save it into the pair of the package it '
    + 'customizes if it is still wanted (the pair\'s override is then served at that base\'s '
    + 'address, `?package=<base>`); `no_pair` (the base\'s id forms no pair): nothing to do; '
    + '`foreign_declaration` (its `overrides` names another package): remove the key with a save '
    + 'naming no package, then re-run: the move declares the right override; `shadowed` (the pair '
    + 'already holds the item; the pair\'s row is served when it declares the override, otherwise '
    + 'this row still is): nothing to do to keep the pair\'s declared override, or restore the '
    + 'package original (the DELETE above) and re-run to move this one; a `failed` move: fix what '
    + 'the error names and re-run; when the error names the pair (it cannot be ensured, or it '
    + 'refuses the row) or, for a declared override, the base\'s missing version, the row may also '
    + 'be left, as it keeps its package-less write',
  reason:
    'A customization of an installed package lives in its paired `.custom` package, where it is '
    + 'a declared override that is exported with the pair and judged against the base\'s version '
    + '(ADR-0146 D1, D2, D11). The package-less write made a row of no package instead, which no '
    + 'export carries. Rows already stored that way are still served unchanged, so nothing breaks '
    + 'at the upgrade. Between the upgrade and `--apply`, every customization is served, and the '
    + 'package-less save, publish, delete or rollback of a movable one the command moves as a '
    + 'declared override is refused 403 NOT_OVERRIDABLE naming the pair and this command; an '
    + 'email template locale the base does not ship, which the command moves as the pair\'s own '
    + 'member, keeps its package-less write. The close reaches only what the command moves as a '
    + 'declared override (its own classification and its own move steps), so no customization is '
    + 'left without a write door. No conversion applies: the rows are stored data, not authored '
    + 'source, and the move goes through the save door. ADR-0146, ADR-0087.',
  acceptanceCriteria:
    'On the deployment\'s database and configuration, with its boot flags and environment, the '
    + 'preview of `os migrate packageless-overlays` lists no movable row. Each customization is then '
    + 'served exactly as before, and a save of a moved declared override with '
    + '`?package=<base>.custom` and its `overrides` declaration succeeds where the same save naming '
    + 'no package answers 403 NOT_OVERRIDABLE.',
};
