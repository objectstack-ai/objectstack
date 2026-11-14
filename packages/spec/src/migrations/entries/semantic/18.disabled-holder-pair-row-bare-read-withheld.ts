// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// A narrowing of the bare item read, not of any key: ADR-0150 D3 (#32814) has
// the read that names no package withhold a row stored under a customization
// pair of the packages holding a name when every one of them is disabled,
// where it served the row (epic red line 1: a disabled package is not served).
// A pair row is bound over the holders it is a pair of, never a holder of its
// own, so it is withheld with them, as the pair's exact address already was.
// No key is added, removed or re-shaped and no stored row changes shape, so no
// tombstone and no D2 conversion: whether to re-enable the holder is the
// operator's judgement. No relevance question: the move turns on which
// installed packages are disabled, which no question over one stack can name.
export const entry: SemanticMigration = {
  id: 'disabled-holder-pair-row-bare-read-withheld',
  surface:
    'The read of a metadata item that names no package (GET /api/v1/meta/TYPE/NAME, '
    + 'GET /api/v1/meta/TYPE/NAME/published, and the execution read of the same name), at a member only a '
    + 'customization pair (an App\'s PACKAGE.custom) stores, for a name every installed package holding it has '
    + 'disabled, of a type the registry reads by package',
  replacement:
    'Re-enable a package that holds the name: the read naming no package then serves the pair\'s row again. '
    + 'While every holder stays disabled, the read answers what it answers with no row stored: the holder\'s '
    + 'withheld item (404 RESOURCE_NOT_FOUND on both transports).',
  reason:
    'A disabled package\'s items are withheld from the served reads, and so is its customization pair\'s row at '
    + 'the pair\'s own address (?package=PACKAGE.custom). The read naming no package still served that row when '
    + 'it reached it, because it judged the name\'s holders only when it reached nothing. It now judges them when '
    + 'it reaches a row of a holder\'s pair too. A row stored under a holder of the name, a package-less row, and '
    + 'a pair row beside an enabled holder of the same pair are served as before. There is no mechanical '
    + 'rewrite: whether the disabled package should be enabled again is a judgement about the deployment.',
  acceptanceCriteria:
    'For every name whose holders are all disabled and whose member is stored only under a holder\'s '
    + 'customization pair: GET /api/v1/meta/TYPE/NAME?member=MEMBER answers 404 RESOURCE_NOT_FOUND, never the '
    + 'pair\'s row; once a holder is enabled again, the same read answers the pair\'s row.',
};
