// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// ADR-0150 D3/D4 at the registry's slot model: a stored row bound to a
// package (its own, or its `.custom` pair's by the pair-row rule) is that
// package's item, whichever row was saved or hydrated last. A change of which
// stored row a read serves, not of any key: no schema key moves and no stored
// row changes shape, so no tombstone and no D2 conversion. No relevance
// question: the moved answers turn on two packages each holding a stored row
// of one name, which no question over one stack can name.
export const entry: SemanticMigration = {
  id: 'stored-row-own-package-slot',
  surface:
    'A name of a type the registry reads by package (an action, tool, agent, skill, webhook, api, email template, '
    + 'picklist, mapping or dataset) that two packages each hold a stored row of: the exact read at each package '
    + '(GET /api/v1/meta/TYPE/NAME?package=ID) and the registry\'s item at each package, on the writing replica and its '
    + 'peers, before and after a restart; the exact read at each package\'s customization pair '
    + '(?package=ID.custom) when the name is held only as stored rows; the read naming no package of a name a package '
    + 'and its own .custom pair each store an undeclared row of; and, for an action held only as stored rows by two '
    + 'packages, the read naming no package after a restart',
  replacement:
    'Nothing to rewrite: every stored row keeps its binding. Read each package\'s item by its package (?package=ID); '
    + 'the read naming no package of a name two packages hold refuses 409 RESOURCE_CONFLICT naming both, as for every '
    + 'other type since two-row-holders-bare-read-refused',
  reason:
    'The registry kept one slot per name for a stored row, so the row saved or hydrated last took it: one package\'s '
    + 'exact read answered its shipped item while its own stored row went unserved, which package by row order; '
    + 'a peer replica answered the last write at both packages; a pair address answered 404 before a restart and, '
    + 'after it, one package\'s row or a 409 naming the other; the read naming no package served a package\'s pair '
    + 'row instead of its own row when the pair row was saved first; and an action\'s read naming no package served '
    + 'the row hydrated last where every other type refused. Each stored row now has its package\'s own slot.',
  acceptanceCriteria:
    'For a name two packages each hold a stored row of, in every save and registration order, before and after a '
    + 'restart: GET /api/v1/meta/TYPE/NAME?package=ID answers that package\'s own row at each package, and at '
    + '?package=ID.custom when the name is held only as stored rows; the read naming no package refuses 409 '
    + 'RESOURCE_CONFLICT naming both packages; a name one package holds answers as before.',
};
