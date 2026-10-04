// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #21464 — the `object-grid` page block's `columns` was `z.array(z.unknown())`
// although the grid reads it with one shape, so a column keyed `accessorKey` /
// `header` / `name`, a column with no `field`, a mixed list or a key the grid
// never reads off a column passed the component-props gate, and the grid drew no
// column or ignored the key, in silence. Stage 2 held it because the grid's group
// headers drew a column's `options`, which the list view's column entry does not
// declare; objectui retired that read (the group-header labels come from the
// object field's `options` only), so the member takes the list view's own
// `columns` by reference — the reference it was held from. D3 only:
// page-component `properties` is not parsed on the metadata save or load path, so
// a stored page is never refused; a refused column has no rewrite that both keeps
// what the grid draws today and honours what the author wrote; and the authored
// census found no authored value to respell — every refused value is a fixture
// whose refused key the grid does not draw.
export const entry: SemanticMigration = {
  id: 'ui-object-grid-columns-typed',
  surface: 'page `object-grid` components — `properties.columns` (whose entries used to accept any value)',
  replacement: 'the list view\'s own `columns`: all field-name strings, or all column entries `{ field, label?, '
    + 'width?, align?, hidden?, sortable?, resizable?, wrap?, type?, pinned?, summary?, prefix?, link?, action? }`. '
    + 'Respell a column keyed `accessorKey` / `header` or `name` as `field` / `label`; write a list as all strings '
    + 'or all entries, never a mix; delete a column key the entry does not declare (`editable`, `options`, '
    + '`reference`, `currency`, `precision`, …) — inline editing is the grid\'s own `editable`, and option '
    + 'labels, relational metadata and number formats are the object field\'s.',
  reason: 'The grid reads `columns` with one shape — all field-name strings or all column entries, decided by '
    + 'the first entry, drawing only an entry with a string `field` and reading the column entry\'s own members '
    + 'off it — and the page-component row declared it `z.array(z.unknown())`, so any entry passed the '
    + 'component-props gate and the grid answered an off-shape one in silence: a column keyed `accessorKey` / '
    + '`header` or `name`, or one with no `field`, drew no column, a mixed list lost every entry the first one '
    + 'did not match, and a key the grid never reads off a column (`editable`, `options`, `reference`) was '
    + 'ignored. The member was held while the grid\'s group headers drew a column\'s `options` ahead of the '
    + 'field\'s; the renderer has since retired that read and takes the labels from the object field only, so '
    + 'the row takes the list view\'s own `columns` by reference — the column entry a list view already '
    + 'refuses an undeclared key on. It is read where every page component\'s props are: the component-props '
    + 'gate reports a refused value as an advisory `component-props-invalid` / `component-props-unknown-key` '
    + 'finding on `objectstack validate`, `objectstack build` and `objectstack lint`, and a stored page still '
    + 'saves and loads, because a page component\'s `properties` is not parsed on the metadata save or load path. '
    + 'No conversion is registered: nothing on the load path refuses the shape, and a refused column has no '
    + 'rewrite that both keeps what the grid draws today and honours what the author wrote — which is the '
    + 'judgment this entry leaves to the upgrader. Deployed metadata NOT MEASURED.',
  acceptanceCriteria: 'Every `object-grid` node validates: `objectstack validate` reports no '
    + '`component-props-invalid` / `component-props-unknown-key` finding under `properties.columns`. Each grid '
    + 'draws every authored column: one per entry, headed by its `label` or the field\'s own, in the order '
    + 'written.',
};
