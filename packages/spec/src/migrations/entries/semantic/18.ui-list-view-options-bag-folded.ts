// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #25923 (seat ruling route A, superseding direction A on objectui#10380) — the
// D3 entry of the `list-view-options-bag-folded` family. The flattened list
// overlay's legacy `options` bag closes: the door refuses it by name, and the
// D2 conversion folds a stored or authored bag onto the top-level per-kind
// blocks. This entry carries what the fold cannot decide.
export const entry: SemanticMigration = {
  id: 'ui-list-view-options-bag-folded',
  surface:
    'view.options — the legacy per-kind bag (options.kanban, options.calendar, options.gantt, '
    + 'options.timeline, options.map, options.gallery, options.chart, options.tree) on a flattened list '
    + 'view overlay, the PUT /api/v1/meta/view body; the view item record and the authoring shapes '
    + 'already refused it',
  replacement:
    'the top-level per-kind block of the same name (`options.kanban` becomes `kanban`, and so on), '
    + 'keeping the top-level value where both set a key; a grid\'s settings are top-level keys of the view',
  reason:
    'One key per concept (Prime Directive #12). The bag was a second spelling of every per-kind block, '
    + 'declared an underlay the top-level block wins over per key, and the renderers each re-implemented '
    + 'that merge. An earlier ruling kept it only for objectui\'s pinned options.map read, which this '
    + 'change retires with every other reader. The D2 conversion '
    + '`list-view-options-bag-folded` folds each stored or source bag onto the top-level blocks, which '
    + 'is what those renderers drew (for `chart`, whose block replaced the bag whole, a bag beside a '
    + 'block is dropped). What it cannot decide: the bag was judged with every key optional, so a bag '
    + 'block can fold into a block still missing a key the block requires (a `gantt` with no '
    + '`titleField`, a `kanban` with no `columns`); and a bag it cannot fold (an `options.grid`, a '
    + 'non-object block, any bag on a form view) is left in place with a TODO',
  acceptanceCriteria:
    'No list view body carries a top-level `options`; the view write door refuses one by name with the '
    + 'move-to-the-top-level prescription, and TypeScript rejects it on the overlay member. Every view the '
    + 'conversion changed parses: each folded block carries its required keys, added by the author where '
    + 'the bag never had them. A row the conversion left with a TODO has had its bag removed by its owner. '
    + 'A list view renders each kind from its top-level block alone.',
  conversionIds: ['list-view-options-bag-folded'],
};
