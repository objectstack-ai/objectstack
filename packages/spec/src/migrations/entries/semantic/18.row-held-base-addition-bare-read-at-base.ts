// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// A narrowing of the bare item read, not of any key: ADR-0150 D3 (#33210) has
// the read that names no package, at a bundle member only a dependent's
// addition holds, read the base's address when the base holds the name only as
// stored rows, as it already does when the base ships the name (#28802: a
// bundle addition holds no name). It served the dependent's row there. No key is
// added, removed or re-shaped and no stored row changes shape, so no tombstone
// and no D2 conversion: the dependent's row stays at its own address. No
// relevance question: the move turns on which packages' stored rows hold which
// members of a name, which no question over one stack can name.
export const entry: SemanticMigration = {
  id: 'row-held-base-addition-bare-read-at-base',
  surface:
    'The read of a bundled metadata item that names no package (GET /api/v1/meta/TYPE/NAME?member=MEMBER, '
    + 'GET /api/v1/meta/TYPE/NAME/layers?member=MEMBER, and the execution read of the same member) at a member '
    + 'that only a dependent package\'s stored row holds, an addition to a base package that holds the name only '
    + 'as stored rows of other members, for a name no installed package ships in code',
  replacement:
    'Name the dependent: GET /api/v1/meta/TYPE/NAME?package=DEPENDENT&member=MEMBER serves its row, as before.',
  reason:
    'A bundle addition holds no name (ADR-0150 D3): the read naming no package reads the base\'s address, and '
    + 'when the base ships the name it already answered 404 for a member only the dependent holds. When the base '
    + 'held the name only as stored rows, the same read served the dependent\'s row, because it read the rows '
    + 'bound at the member rather than the base. The two now answer alike. There is no mechanical rewrite: '
    + 'whether a caller meant the dependent\'s member is a judgement about that caller.',
  acceptanceCriteria:
    'For every bundled name a base holds only as stored rows and a dependent extends with a member of its own: '
    + 'every caller that reads that member without ?package= reads it with ?package=DEPENDENT, which answers the '
    + 'dependent\'s row; the read without ?package= answers 404 for that member, as for a base that ships the name.',
};
