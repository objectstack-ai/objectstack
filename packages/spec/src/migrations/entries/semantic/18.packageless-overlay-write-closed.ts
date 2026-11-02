// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// ADR-0146 D11 — a runtime narrowing at the metadata write doors with no
// authorable key: a write naming no package onto an item an installed package
// ships is refused. Registered because an upgrading deployment can carry the
// package-less Setup rows those writes made, and the operator step that moves
// them into the base's `.custom` pair is to run BEFORE the upgrade (the
// migration prescription the dispatch order puts on this change's note).
export const entry: SemanticMigration = {
  id: 'packageless-overlay-write-closed',
  surface:
    'a metadata write that names no package (PUT, DELETE, publish or rollback under '
    + '/api/v1/meta/<type>/<name> with no ?package=, and Setup\'s form save and reset, which send '
    + 'none) onto a view, dashboard, report, translation or email template that an installed '
    + 'read-only package ships, and the package-less sys_metadata rows such writes stored',
  replacement:
    'before upgrading, run `os migrate packageless-overlays` (preview) and then '
    + '`os migrate packageless-overlays --apply` on each deployment with Setup customizations: it '
    + 'moves each package-less row of a name one installed package ships into that package\'s '
    + 'paired `<base>.custom`, declaring `overrides: { package: <base>, basedOn: <installed '
    + 'version> }`. From then on write the customization into the pair: '
    + '`PUT /api/v1/meta/<type>/<name>?package=<base>.custom` with the `overrides` declaration in '
    + 'the body, and `DELETE /api/v1/meta/<type>/<name>?package=<base>.custom` to restore the '
    + 'package original',
  reason:
    'A customization of an installed package lives in its paired `.custom` package, where it is '
    + 'a declared override that is exported with the pair and judged against the base\'s version '
    + '(ADR-0146 D1, D2, D11). The package-less write made a row of no package instead, which no '
    + 'export carries. Rows already stored that way are still served unchanged, so nothing breaks '
    + 'at the upgrade itself, but each package-less save, publish, delete or rollback of them is '
    + 'refused 403 NOT_OVERRIDABLE naming the pair and this command, so a deployment that skipped '
    + 'the step finds its Setup customizations read-only. No conversion applies: the rows are '
    + 'stored data, not authored source, and the move goes through the save door. A name several '
    + 'packages ship, or one whose package id forms no pair, is listed by the command and left '
    + 'for the operator. ADR-0146, ADR-0087.',
  acceptanceCriteria:
    'On the deployment\'s database and configuration, `os migrate packageless-overlays` reports '
    + 'nothing movable (exit 0). Each customization is then served exactly as before, and a save '
    + 'of it with `?package=<base>.custom` and its `overrides` declaration succeeds where the same '
    + 'save naming no package answers 403 NOT_OVERRIDABLE.',
};
