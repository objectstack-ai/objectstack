// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// A narrowing of the bare item read, not of any key: ADR-0150 D3 (#32607) has
// the read that names no package refuse a name two or more enabled packages
// hold only as stored rows (no package ships it in code), where it served the
// row saved first (red line 2: ambiguity is reported, never guessed). No key
// is added, removed or re-shaped and no stored row changes shape, so no
// tombstone and no D2 conversion: which package's row a reader meant is the
// reader's judgement. No relevance question: the move turns on which packages'
// stored rows hold a name, which no question over one stack can name.
export const entry: SemanticMigration = {
  id: 'two-row-holders-bare-read-refused',
  surface:
    'The read of a metadata item that names no package (GET /api/v1/meta/TYPE/NAME, '
    + 'GET /api/v1/meta/TYPE/NAME/published, and the execution read of the same name) for a name that two or more '
    + 'enabled packages hold only as stored rows, which no installed package ships in code, of a type the registry '
    + 'reads by package',
  replacement:
    'Name the package: GET /api/v1/meta/TYPE/NAME?package=PACKAGE serves that package\'s row. The refusal '
    + '(409 RESOURCE_CONFLICT, reason ambiguous-in-environment) names each holder in details.candidates.',
  reason:
    'The read naming no package took the row saved first, so the same name answered a different package\'s item '
    + 'depending on save order, while GET /api/v1/meta/TYPE/NAME/layers already refused it naming both holders. '
    + 'The read now judges the name\'s holders (the registry\'s holders and the packages its active stored rows '
    + 'are bound to) and refuses two or more as the by-name read refuses two package holders. One holder is served '
    + 'as before. There is no mechanical rewrite: which package\'s row a caller meant is a judgement about that '
    + 'caller.',
  acceptanceCriteria:
    'For every name two or more enabled packages hold only as stored rows: every caller that reads it without '
    + '?package= reads it with ?package=PACKAGE naming the package it means, and that read answers that package\'s '
    + 'row; GET /api/v1/meta/TYPE/NAME without ?package= answers 409 RESOURCE_CONFLICT naming each holder in '
    + 'details.candidates, never a row.',
};
