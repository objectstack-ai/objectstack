// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #9227 — the D3 entry of the `field-column-lists-canonicalized` family (ruling
// B on #17152: one D3 entry per retirement family, even when D2 repairs the
// data). The conversion respells and folds every entry it can resolve; it
// deliberately leaves the two shapes it cannot resolve for the parse to refuse,
// and the related-list fold drops decoration keys by design. Both halves are
// the author's to finish.
export const entry: SemanticMigration = {
  id: 'field-inline-and-related-list-columns-closed',
  surface: 'field.inlineColumns[] and field.relatedListColumns[] on lookup and master_detail '
    + 'fields — the two column lists that used to accept any object',
  replacement: '`inlineColumns` entries are strict, name-keyed columns — `{ name, label?, type?, … }`, '
    + 'where `{ name }` alone hydrates the rest from the child object field. `relatedListColumns` '
    + 'entries are child field-name strings.',
  reason: 'The D2 conversion `field-column-lists-canonicalized` rewrites what it can resolve without '
    + 'guessing: an inline column spelled `{ field: \'x\' }` becomes `{ name: \'x\' }` with every other '
    + 'key kept, and a related-list column object folds to its identity string. Two things remain '
    + 'the author\'s. First, the conversion leaves alone, on purpose, an inline entry that carries '
    + 'BOTH `field` and `name` (rewriting a live key on the strength of a stale one would guess) '
    + 'and a related-list object with no resolvable identity (a conversion must not invent data) — '
    + 'those now fail the parse and only the author knows which column was meant. Second, the fold '
    + 'DROPS a related-list object\'s decoration keys — a label, a width — because no object '
    + 'spelling rendered reliably on that list; the author decides whether a label they wrote there '
    + 'belongs on the child field itself instead. Both lists used to accept any object, so a '
    + 'mis-keyed column published clean and drew blank cells: a column that was blank before this '
    + 'release was usually one of these, and the author should confirm it now names a real child '
    + 'field.',
  acceptanceCriteria: 'The object parses: no `inlineColumns` entry carries `field`, and every '
    + '`relatedListColumns` entry is a string. Every inline column `name` and every related-list '
    + 'string names a field that exists on the child object, and the inline grid and the related '
    + 'list render a value — not a blank cell — in each column for a record that has one. Any label '
    + 'that the fold dropped from a related-list column is either no longer wanted or now lives on '
    + 'the child field definition, where the list reads it from.',
};
