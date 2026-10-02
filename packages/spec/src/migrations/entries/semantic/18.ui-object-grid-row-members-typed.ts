// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #21445 — seven members of an `object-grid` page block's props were
// `z.unknown()` (`bulkActionDefs` an array of it) although the grid reads each
// with a fixed shape, so an off-shape value passed every door and the grid
// substituted a default or dropped it in silence. The row now takes the shape
// each read point takes. D3 only: page-component `properties` is not parsed on
// the metadata save or load path, so a stored page is never refused and there is
// no load-path refusal for a conversion to pre-empt; an off-shape value has no
// rewrite that says what the author meant; and the authored census found
// nothing in either repository's corpora to respell.
export const entry: SemanticMigration = {
  id: 'ui-object-grid-row-members-typed',
  surface: 'page `object-grid` components — `properties.rowHeight`, `.rowColor`, `.navigation`, '
    + '`.conditionalFormatting`, `.bulkActionDefs`, `.aggregations` and `.operations` (which used to '
    + 'accept any value)',
  replacement: 'the shape the grid reads, the list view\'s own where it has one: `rowHeight` one of '
    + '`compact` / `short` / `medium` / `tall` / `extra_tall`; `rowColor` `{ field, colors }`; '
    + '`navigation` `{ mode?, size?, openNewTab?, preventNavigation? }`; `conditionalFormatting` '
    + '`[{ condition, style }]` with a CEL `condition` and a CSS `style` map; `bulkActionDefs` the '
    + 'list view\'s bulk-action defs; `aggregations` `[{ field, type }]` with `type` one of `count`, '
    + '`sum`, `avg`, `min`, `max`, `count_distinct`; `operations` `{ create?, update?, delete?, '
    + 'export? }` booleans. Rewrite an objectui-native formatting rule `{ field, operator, value, '
    + 'backgroundColor }` as `{ condition: "record.FIELD == VALUE", style: { backgroundColor } }`; '
    + 'delete `operations.read` and `operations.import`, which nothing reads.',
  reason: 'The grid reads each of these members with one shape, and the page-component row '
    + 'declared them `z.unknown()`, so any value passed the component-props gate and the grid '
    + 'answered an off-shape one with a silent default: an off-preset `rowHeight` such as `42` '
    + 'rendered as `compact`, a `rowColor` of the wrong shape coloured no row, a `navigation` written '
    + 'as a bare mode string opened the record page whatever it named, an aggregation with an '
    + 'unknown function drew a zero nothing computed or no number at all, and an `operations` '
    + 'toggle nothing reads toggled nothing. The row now takes the list view\'s own schemas for the '
    + 'five members a list view declares, and the measured shape for `aggregations` and '
    + '`operations`, so one value is judged the same way on both doors. It is read where every page '
    + 'component\'s props are: the component-props gate reports a refused value as an advisory '
    + '`component-props-invalid` / `component-props-unknown-key` finding on `objectstack validate`, '
    + '`objectstack build` and `objectstack lint`, and a stored page still saves and loads, because a '
    + 'page component\'s `properties` is not parsed on the metadata save or load path. No conversion '
    + 'is registered: nothing on the load path refuses the shape, and an off-shape value has no '
    + 'rewrite that both keeps what the grid shows today and honours what the author wrote — which '
    + 'is the judgment this entry leaves to the upgrader. Deployed metadata NOT MEASURED.',
  acceptanceCriteria: 'Every `object-grid` node validates: `objectstack validate` reports no '
    + '`component-props-invalid` / `component-props-unknown-key` finding under the seven members\' '
    + 'paths. Each grid that set one of them now shows it: the declared row height, the row colours '
    + 'its `colors` map names, the navigation mode on a row click, the conditional styles, the bulk '
    + 'actions, the group-header numbers and the affordances `operations` names.',
};
