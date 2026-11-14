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
    'The registry\'s item of a holder of a package-scoped name that two or more installed packages hold, of the '
    + 'types action, hook, job, webhook, connector, sharing_rule, queue, assignment_rule, analytics_cube, picklist, '
    + 'api, tool, skill and agent, when a stored row of the name is bound to a package that holds none of it, or to '
    + 'a customization pair (ID.custom, or an App\'s shared pair): the holder\'s package-scoped registry item, its '
    + 'scoped list (GET /api/v1/meta/TYPE?package=ID), the registry list, and the holder\'s exact read '
    + '(GET /api/v1/meta/TYPE/NAME?package=ID) on a kernel with no metadata service',
  replacement:
    'For a row bound to a package that holds none of the name: delete it (DELETE '
    + '/api/v1/meta/TYPE/NAME?package=STRAY). These types are sealed once a package ships the name, so no stored '
    + 'customization of a shipped item is served; for an action, the one of them that admits a declared override, '
    + 'first save the change as the declared override of the holder it customizes, in that holder\'s paired .custom '
    + 'package (PUT /api/v1/meta/action/NAME?package=ID.custom with overrides: { package: ID, basedOn: VERSION }). '
    + 'For a customization pair\'s row: nothing, it is now read as the item of the holder it customizes; one that '
    + 'names no holder (no overrides.package on a shared pair, or a package the pair does not customize) is served by '
    + 'none, so declare overrides.package naming the holder it customizes',
  reason:
    'A stored row customizes the holder it binds to (ADR-0150 D4). The read-side hydrator (the boot load, an '
    + 'unscoped list read, the write-through of a save) took the envelope of the row\'s package from a lookup that, '
    + 'when the package holds no item of the name, answers the package registered first, so with two holders a row '
    + 'of a third package took the first holder\'s slot, and a row of the second holder\'s pair was served as the '
    + 'first holder\'s item: a different holder in each registration order. The first is now declined, as a '
    + 'package-less row of such a name is, and the boot census (metadata_sealed_overlay_unserved) names it; a pair '
    + 'row wears the envelope of the holder the registry\'s one owner rule binds it to, judged over every holder so '
    + 'a disable never moves it, and one that rule binds to no holder is declined. Nothing is rewritten. Measured '
    + 'when the change landed: no first-party composition has two packages holding one name with such a row.',
  acceptanceCriteria:
    'For every stored row of one of these types, of a name two installed packages hold, that is bound to a package '
    + 'holding none of the name, no such row remains (an action\'s change lives in the declared override of the '
    + 'holder it customizes, in that holder\'s .custom package); every pair row of such a name declares, or is '
    + 'bound by its pair to, exactly one holder; and GET /api/v1/meta/TYPE/NAME?package=ID answers each holder\'s '
    + 'own item or its override, in either registration order.',
};
