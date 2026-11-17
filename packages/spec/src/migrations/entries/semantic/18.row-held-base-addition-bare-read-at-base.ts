// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// A narrowing of the bare item read, not of any key: #33210 (c) has the read
// that names no package, at a named non-canonical bundle member only a
// dependent's addition holds, read the base's address when the base holds the
// name only as stored rows, as it already does when the base ships the name.
// The rule is #28802 / epic #31527 child R2 (the `packageScopedHoldersOf`
// docblock in objectql's registry: a bundle addition holds no name), judged
// for each dependent against its own declared dependency closure, so a second
// dependent adding a member of its own leaves the base the base. It served the
// dependent's row there. No key is added, removed or re-shaped and no stored
// row changes shape, so no tombstone and no D2 conversion: the dependent's row
// stays at its own address. No relevance question: the move turns on which
// packages' stored rows hold which members of a name, which no question over
// one stack can name.
export const entry: SemanticMigration = {
  id: 'row-held-base-addition-bare-read-at-base',
  surface:
    'The read of a bundled metadata item that names no package (GET /api/v1/meta/TYPE/NAME?member=MEMBER, '
    + 'GET /api/v1/meta/TYPE/NAME/layers?member=MEMBER, and the execution read of the same member) at a named '
    + 'member other than the canonical one that only dependent packages\' stored rows hold, each an addition to '
    + 'a base package that holds the name only as stored rows of other members, for a name no installed package '
    + 'ships in code. The read naming no member (the canonical member, and GET /api/v1/meta/TYPE/NAME/published) '
    + 'does not move',
  replacement:
    'Name the dependent: GET /api/v1/meta/TYPE/NAME?package=DEPENDENT&member=MEMBER serves its row, as before.',
  reason:
    'A bundle addition holds no name (the rule the registry applies when it counts a name\'s holders): the read '
    + 'naming no package reads the base\'s address, and when the base ships the name it already answered 404 for '
    + 'a member only a dependent holds. When the base held the name only as stored rows, the same read served the '
    + 'dependent\'s row, because it read the rows bound at the member rather than the base. The two now answer '
    + 'alike, however many dependents each add a member of their own. There is no mechanical rewrite: whether a '
    + 'caller meant the dependent\'s member is a judgement about that caller.',
  acceptanceCriteria:
    'For every bundled name a base holds only as stored rows and one or more dependents each extend with a '
    + 'non-canonical member of their own: every caller that reads such a member without ?package= reads it with '
    + '?package=DEPENDENT, which answers the dependent\'s row; the read without ?package= answers 404 for that '
    + 'member, as for a base that ships the name.',
};
