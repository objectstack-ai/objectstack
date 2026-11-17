// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// A narrowing of the bare published read, not of any key: #34441 (cell 1) has
// `/published` naming no package stop serving a dependent's stored row of the
// canonical bundle member when the base ships the name only in another member.
// The rule is #28802 / epic #31527 child R2 (a bundle addition holds no name):
// the read naming no package reads the base's address, which holds no
// canonical member, so it answers what it answers with no such row (404). It
// served the dependent's row there, and only until a restart: the layered read
// reported that row as an orphan of the base's name (#28409) although the base
// ships no member it could shadow. No key is added, removed or re-shaped and no
// stored row changes shape, so no tombstone and no D2 conversion: the
// dependent's row stays at its own address. No relevance question: the move
// turns on which members a base ships and which a dependent stores, which no
// question over one stack can name.
export const entry: SemanticMigration = {
  id: 'shipped-base-dependent-canonical-row-not-published',
  surface:
    'GET /api/v1/meta/TYPE/NAME/published, naming no package, for a bundled metadata name a base package ships '
    + 'only in members other than the canonical one, where a dependent package (one that declares the base) stores '
    + 'a row of the canonical member. Before a restart it served the dependent\'s row; after one it answered 404. '
    + 'The plain read, ?member=CANONICAL and the execution read do not move',
  replacement:
    'Name the dependent: GET /api/v1/meta/TYPE/NAME?package=DEPENDENT&member=CANONICAL serves its row, as before.',
  reason:
    'A bundle addition holds no name (the rule the registry applies when it counts a name\'s holders): the read '
    + 'naming no package reads the base\'s address, which ships no canonical member, so it answers as it does with '
    + 'no dependent row stored. /published served the dependent\'s row only until a restart, so the same request '
    + 'answered two ways. There is no mechanical rewrite: whether a caller meant the dependent\'s member is a '
    + 'judgement about that caller.',
  acceptanceCriteria:
    'For every bundled name a base ships only in non-canonical members and a dependent extends with a stored row '
    + 'of the canonical member: every caller that reads /published without ?package= reads the dependent\'s row from the item read '
    + 'GET /api/v1/meta/TYPE/NAME?package=DEPENDENT&member=CANONICAL instead; /published without ?package= answers 404, before and after a '
    + 'restart, as with no dependent row stored.',
};
