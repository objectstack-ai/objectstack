// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The door half of ruling A on objectui#10380 (#20051). A write-time narrowing
// of the flattened view overlays: the stored rows it newly refuses are read and
// served exactly as before and fail only on their next save, which is why this
// is a semantic entry and not a conversion — which key a row meant is a fact
// only its author holds.
export const entry: SemanticMigration = {
  id: 'view-overlay-options-bag-judged',
  surface:
    'The legacy `options` bag on a flattened `view` overlay saved through the metadata write door '
    + '(`PUT /api/v1/meta/view/:name`, the Studio / MCP save): `options.kanban`, `options.calendar`, '
    + '`options.gantt`, `options.gallery`, `options.timeline`, `options.chart`, `options.map` and '
    + '`options.tree` on a list overlay, any other key in the bag, and the bag on a form overlay.',
  replacement:
    'Each `options.KIND` block carrying only keys the top-level `KIND` block declares, with values that '
    + 'block accepts — or, preferred, the same keys moved to the top-level `KIND` block, which wins per key '
    + 'where both set one. A key the block does not declare is deleted or re-spelled to the declared key the '
    + 'refusal names (`options.kanban.groupField` becomes `groupByField`, `options.calendar.dateField` '
    + 'becomes `startDateField`); `options.timeline.metaFields` has no declared successor and is deleted. '
    + 'Any other key in the bag is deleted, and a form overlay carries no bag at all.',
  reason:
    'The list overlay member re-opens its top level with a strip so the console\'s round-trip keys '
    + 'survive, and that strip dropped the `options` bag from the parse without looking inside it. The save '
    + 'stores the request body, not the parse output, and objectui\'s interface page forwards a stored '
    + 'view\'s `options` into the list renderer, which merges `options.KIND` under the top-level block — so a '
    + 'key the strict block refuses by name (`timeline.metaFields`) was saved and rendered when spelled '
    + '`options.timeline.metaFields`. Measured on `origin/main` @ `8d1f7ab` through the real save. Ruled '
    + 'direction A (the maintainer\'s ruling of 2026-09-24): judge each `options.KIND` with the kind\'s strict schema and '
    + 'refuse an out-of-contract key by name, as the direct spelling is; refusing the bag whole was ruled '
    + 'out because the legacy `options.map` path is live and pinned. Judged key by key, because the '
    + 'renderer reads the bag as a per-key underlay of the top-level block: a bag that carries only the '
    + 'keys the top-level block leaves to it is legal and stays accepted. Not convertible: whether a '
    + 'refused key was a typo of a declared one or a retired capability is the author\'s call.',
  acceptanceCriteria:
    'Every stored `view` overlay carrying a top-level `options` saves again unchanged. A row that does not '
    + 'is refused `422 INVALID_METADATA` on its next save, with an `unrecognized_keys` issue at '
    + '`options.KIND` naming the key and carrying the same message the direct spelling gets at `KIND` — '
    + 'or at `options` for a key that is not a kind, or a form overlay\'s bag. Nothing is rewritten on '
    + 'read and nothing is refused on read: a row that fails is served exactly as stored until it is '
    + 'saved. Verify by re-saving each stored overlay that carries `options` (a GET then a PUT of the '
    + 'same body) and reading a `200`.',
};
