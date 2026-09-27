// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #11805 (ADR-0049 enforce-or-remove) — the D3 entry of the
// `object-grid-default-sort-removed` family (ruling B on #17152: one D3 entry
// per retirement family, even when D2 is lossless). The conversion follows
// the renderer's own precedence exactly, so it preserves what the grid did —
// including the case where what the grid did was not what the author wrote.
export const entry: SemanticMigration = {
  id: 'object-grid-default-sort-retired',
  surface: 'page.component.object-grid.defaultSort — the legacy single-pair second spelling of '
    + 'the grid sort',
  replacement: '`sort: [{ field, order }]` — the array every read path honours; a single pair is a '
    + 'one-entry array.',
  reason: 'The D2 conversion `object-grid-default-sort-removed` follows the renderer\'s own '
    + 'precedence: where `sort` was absent the `defaultSort` pair WAS the grid\'s sort, so it moves '
    + 'to `sort` as a one-entry array; where `sort` was present the pair was never read, so it is '
    + 'deleted. Both are behaviour-preserving, and the second is where the judgment sits. A grid '
    + 'that authored both keys with DIFFERENT orders has always loaded in the `sort` order while '
    + 'its author may believe `defaultSort` governed the initial load — the key\'s name says it '
    + 'should have. The conversion keeps the order users have been seeing and discards the one the '
    + 'author wrote; only the author can say which one they meant. Code that builds object-grid '
    + 'props (a host, a generator) must also stop emitting the key, which no conversion reaches.',
  acceptanceCriteria: 'No `object-grid` component carries `defaultSort`; the parse refuses it. '
    + 'Each grid\'s `sort` array lists the fields and directions the author intends, and the grid '
    + 'loads with its rows in that order and shows that column as sorted. For every grid that had '
    + 'authored both keys, the author has compared the discarded `defaultSort` pair with the kept '
    + '`sort` and confirmed the kept one.',
};
