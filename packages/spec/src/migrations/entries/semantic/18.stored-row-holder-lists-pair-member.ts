// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// ADR-0150 D4 at a package's list: a package that holds a bundle's name only
// through its own stored row (no code artifact) is the holder its exact read
// serves the App pair's added member at, and its list now counts it the same
// way. A change of which stored row a list serves, not of any key: no schema
// key moves and no stored row changes shape, so no tombstone and no D2
// conversion. No relevance question: the moved answer turns on a package
// holding a name through a stored row alone, which no question over one stack
// can name.
export const entry: SemanticMigration = {
  id: 'stored-row-holder-lists-pair-member',
  surface:
    'A bundled type read by (package, name) (an email template\'s locales): the list scoped to a package '
    + '(GET /api/v1/meta/TYPE?package=ID) and the execution list a send resolved to that package reads, when the '
    + 'package holds the name only through its own stored row and its App\'s .custom pair stores an undeclared '
    + 'row of another member of the name',
  replacement:
    'Nothing to rewrite: the list now carries the pair\'s member that GET /api/v1/meta/TYPE/NAME?package=ID&member=M '
    + 'already served. A pair row meant for another package of the App declares it (overrides: { package: ID })',
  reason:
    'The exact read counted the package as the name\'s holder through its stored row and served the pair\'s added '
    + 'member at its address, while the list counted only a code package that ships the name and left the member '
    + 'out, so the package\'s address and its own list disagreed. Measured when the change landed: no first-party '
    + 'composition holds a bundle name through a stored row alone.',
  acceptanceCriteria:
    'For a package that holds a bundle\'s name only through its own stored row, with its App pair\'s undeclared row of '
    + 'another member: the list scoped to the package and its execution list carry that member exactly when '
    + 'GET /api/v1/meta/TYPE/NAME?package=ID&member=M serves it, in either registration order; with a second holder '
    + 'of the name, or a row declaring another package, both leave it out.',
};
