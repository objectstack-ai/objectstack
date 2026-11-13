// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// ADR-0150 D4 at the registry: a package-less row of an overlay type is the
// customization of the one served holder of its name, and of none when two
// are served. The read-side hydrator built the registry entry for the holders
// served when it ran, and an enable that served a second holder left the entry
// wearing the first holder's envelope. A narrowing of answers, not of any key:
// no schema key moves and no stored row changes shape, so no tombstone and no
// D2 conversion. No relevance question: the moved answer turns on what two
// installed packages hold and on a disable in between, which no question over
// one stack can name.
export const entry: SemanticMigration = {
  id: 'package-less-overlay-row-holder-slot-on-reenable',
  surface:
    'The registry\'s item of a holder of an overlay-type name (email_template, dashboard, report) that a second '
    + 'installed package also holds, when a package-less row of the name is stored and the read-side hydrator ran '
    + '(an unscoped list read, the boot load) while the other holder was disabled: the holder\'s package-scoped '
    + 'registry item, its scoped list (GET /api/v1/meta/TYPE?package=ID) and the registry list scoped to it, after '
    + 'the other holder is enabled again',
  replacement:
    'Delete the package-less row (DELETE /api/v1/meta/TYPE/NAME, naming no package), then save the customization '
    + 'as the declared override of the holder it customizes: in the holder\'s paired .custom package '
    + '(PUT /api/v1/meta/TYPE/NAME?package=ID.custom with overrides: { package: ID, basedOn: VERSION }). Delete '
    + 'first: a package-less delete of the name removes the one bound row there is, so after the save it would '
    + 'remove the override',
  reason:
    'A package-less row of an overlay type customizes one holder only while that holder is the one served holder '
    + 'of the name (ADR-0150 D4). With one of two holders disabled, the read-side hydrator laid the row into the '
    + 'served holder\'s registry slot under that holder\'s envelope, and enabling the other holder left it there, '
    + 'so until the next unscoped hydration the holder\'s registry item, its scoped list and its registry list '
    + 'answered the environment\'s row as the holder\'s own (the registry list carried both). The protocol\'s exact '
    + 'read already refused it 409 naming both holders. The enable now builds the entry again for the holders '
    + 'served, so each holder answers its own item, as when the hydrator ran with both served. Nothing is '
    + 'rewritten. Measured when the change landed: no first-party composition has two packages holding one '
    + 'overlay name with a package-less row.',
  acceptanceCriteria:
    'For every package-less email_template, dashboard or report row of a name two installed packages hold, no '
    + 'package-less row of the name remains; the change lives in the declared override of the holder it customizes, '
    + 'in that holder\'s .custom package, and GET /api/v1/meta/TYPE/NAME?package=ID answers the override while '
    + '?package= naming the other holder answers that holder\'s own item, whether or not a holder was disabled and '
    + 'enabled in between.',
};
