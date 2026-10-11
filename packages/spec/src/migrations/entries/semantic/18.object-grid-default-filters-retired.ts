// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #11509 (v18, ruling A-narrow, sub-question 1) — the D3 entry of the
// `object-grid-default-filters-removed` family, in the shape the
// `object-grid-default-sort-retired` entry beside it took. It absorbs the
// protocol-18 narrowing of the same key (`object-grid-default-filters-rule-array`,
// never released in a major): #19514 narrowed `defaultFilters` to the rule array
// and left its removal to a ruling of its own, which this is.
export const entry: SemanticMigration = {
  id: 'object-grid-default-filters-retired',
  surface:
    'page.component.object-grid.defaultFilters — the legacy second spelling of the grid base filter',
  replacement:
    '`filter: [{ field, operator, value }, ...]` — the one base-filter key every read path honours; '
    + 'the same rules, unchanged.',
  reason:
    'The grid read `defaultFilters` only when `filter` lowered to nothing, so one intent had two '
    + 'spellings on one block. The D2 conversion `object-grid-default-filters-removed` follows that '
    + 'precedence: where `filter` was empty (absent, null, `[]` or `{}`) the fallback WAS the grid\'s '
    + 'filter, so its rules move onto `filter`; where `filter` had rules the fallback was never read, '
    + 'so it is deleted. Both preserve what the grid showed, and the second is where the judgment '
    + 'sits: a grid that authored both keys has always listed the rows `filter` selects, while its '
    + 'author may believe `defaultFilters` applied. The conversion keeps the rows users have been '
    + 'seeing and discards the rules that were written; only the author can say which were meant. '
    + 'A `filter` that is neither empty nor rules (a bare string, a number) is left as stored and '
    + 'listed as a TODO: the grid fell back to `defaultFilters` there too, and moving it would '
    + 'overwrite what was written at `filter`. A fallback in the retired record form moves to `filter` '
    + 'and is then converted there by `page-component-filter-record-to-rule-array` wherever the mapping '
    + 'is lossless; that entry lists the rest. Code that builds object-grid props (a host, a '
    + 'generator) must also stop emitting the key, which no conversion reaches.',
  acceptanceCriteria:
    'No `object-grid` component carries `defaultFilters`; the parse refuses it. Each grid\'s `filter` '
    + 'holds the rules the author intends, and the grid lists exactly the rows they select. For every '
    + 'grid that had authored both keys, the author has compared the discarded `defaultFilters` rules '
    + 'with the kept `filter` and confirmed the kept one.',
  conversionIds: ['object-grid-default-filters-removed'],
};
