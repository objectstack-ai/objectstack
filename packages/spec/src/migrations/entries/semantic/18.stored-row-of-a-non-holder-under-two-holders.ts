// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// ADR-0150 D4 at the registry: a stored row binds to the (package, name) it
// customizes, so laying one into a holder's slot picked for it is a guess
// between holders (red line 2). The read-side hydrator looked up the envelope
// of the row's package with a lookup that falls back to the package registered
// first, so a row of a package holding none of the name, and a row of the
// second holder's customization pair, were served as the first holder's item.
// A narrowing of answers, not of any key: no schema key moves and no stored
// row changes shape, so no tombstone and no D2 conversion. No relevance
// question: the moved answer turns on what two installed packages hold and on
// their registration order, which no question over one stack can name.
export const entry: SemanticMigration = {
  id: 'stored-row-of-a-non-holder-under-two-holders',
  surface:
    'The registry\'s item of a holder of a package-scoped name (every type ADR-0150 addresses by package and name, '
    + 'except flow and the row-served types dashboard, report, email_template, page, app, dataset, doc, book and '
    + 'mapping) that two or more installed packages hold, when a stored row of the name is bound to a package that '
    + 'holds none of it, or to the customization pair (ID.custom) of another holder: the holder\'s package-scoped '
    + 'registry item, its scoped list (GET /api/v1/meta/TYPE?package=ID) and the registry list scoped to it',
  replacement:
    'For a row bound to a package that holds none of the name: save the customization as the declared override of '
    + 'the holder it customizes, in that holder\'s paired .custom package (PUT /api/v1/meta/TYPE/NAME?package=ID.custom '
    + 'with overrides: { package: ID, basedOn: VERSION }), then delete the stray row (DELETE '
    + '/api/v1/meta/TYPE/NAME?package=STRAY); when it customizes nothing, only the delete. For a customization pair\'s '
    + 'row: nothing, it is now read as the item of the holder it customizes; a shared pair\'s row that declares no '
    + 'overrides.package and customizes several holders is served by none, so declare overrides.package to keep it',
  reason:
    'A stored row customizes the holder it binds to (ADR-0150 D4). The read-side hydrator (the boot load, an '
    + 'unscoped list read, the write-through of a save) took the envelope of the row\'s package from a lookup that, '
    + 'when the package holds no item of the name, answers the package registered first, so with two holders a row '
    + 'of a third package took the first holder\'s slot, and a row of the second holder\'s .custom pair was served '
    + 'as the first holder\'s item: a different holder in each registration order. The first is now declined, as a '
    + 'package-less row of such a name is, and reported at warn (metadata_stored_row_names_no_holder, or the boot '
    + 'census metadata_sealed_overlay_unserved for a sealed type); the second wears the envelope of the holder the '
    + 'registry\'s one owner rule binds it to. The exact reads already refused both. Nothing is rewritten. Measured '
    + 'when the change landed: no first-party composition has two packages holding one name with such a row.',
  acceptanceCriteria:
    'For every stored row of a package-scoped name two installed packages hold that is bound to a package holding '
    + 'none of the name, no such row remains: the change lives in the declared override of the holder it customizes, '
    + 'in that holder\'s .custom package, and GET /api/v1/meta/TYPE/NAME?package=ID answers the override while '
    + '?package= naming the other holder answers that holder\'s own item, in either registration order.',
};
