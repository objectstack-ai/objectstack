// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #17053 (objectui#8221 decision batch #77, option B: one sort orthography
// platform-wide) — the D3 entry of the `list-view-sort-string-clause-to-array`
// family (ruling B on #17152: one D3 entry per retirement family, even when D2
// is lossless). The rewrite is lossless for every clause in the grammar it
// knows; the clauses it cannot lower, and the collection it cannot reach, are
// the author's.
export const entry: SemanticMigration = {
  id: 'list-view-sort-string-clause-retired',
  surface: 'view.list.sort / view.listViews.*.sort — the bare string sort clause',
  replacement: 'The structured array, `sort: [{ field, order }]`, with `order` written out — a bare '
    + 'field name meant ascending — and one entry per key of a comma-separated clause, in the same '
    + 'order.',
  reason: 'The D2 conversion `list-view-sort-string-clause-to-array` rewrites a string clause in the '
    + 'grammar the wire normalizer splits on — `\'created_at desc\'`, a bare field name, a '
    + 'comma-separated list — into the array, losslessly, across every view payload in '
    + '`stack.views[]`. Two cases are deliberately left for the author. A string that does NOT '
    + 'parse as that grammar — above all the leading-minus dialect, `\'-created_at\'` — is left '
    + 'alone and refused at the door, because guessing a direction would invent an ordering the '
    + 'author never wrote. And a clause under `objects[].listViews` is reached by no conversion, '
    + 'so it is refused at its own door until rewritten by hand. The clause was minted by the '
    + 'schema and refused by the renderer that lowers it into a query, so a view carrying one may '
    + 'already have been failing to load; which order the author meant is theirs to state.',
  acceptanceCriteria: 'No list view in `stack.views[]` or in any object `listViews` map carries a '
    + 'string `sort`; the parse refuses one with the rewrite prescription. Every rewritten array '
    + 'names fields that exist on the view\'s object with the direction the author intends, and '
    + 'the view loads — rather than failing at the renderer — with its rows in that order.',
};
