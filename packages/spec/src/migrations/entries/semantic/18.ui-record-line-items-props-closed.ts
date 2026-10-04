// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #21142 — the fourth carrier of the inline grid column, and the last
// registered `record:*` renderer without a `ComponentPropsMap` row. The type sat
// on the string-arm registration ledger instead, so the component-props gate
// skipped its props bag: the showcase project page keyed all five of its
// columns `field` and published green over a grid of empty cells. The row
// declares the fifteen keys objectui's `LineItemsPanel` reads, and its
// `columns` REFERENCES `InlineGridColumnSchema`. D3 only: page-component
// `properties` is not parsed on the metadata save or load path, so a stored
// page is never refused and there is no load-path refusal for a conversion to
// pre-empt; the one `field`-keyed producer the census found is respelled in the
// same change.
export const entry: SemanticMigration = {
  id: 'ui-record-line-items-props-closed',
  surface: 'page `record:line_items` components — `properties` (which used to accept any key) and '
    + '`properties.columns[]` (its inline grid columns)',
  replacement: 'the declared shape the renderer reads: `{ childObject?, relationshipField, columns, '
    + 'parentObject?, parentId?, recordId?, amountField?, totalField?, title?, readonly?, minRows?, '
    + 'maxRows?, filter?, sort?, limit? }`, with `filter` the ViewFilterRule array, `sort` the SortItem '
    + 'array and `limit` a positive integer; `childObject` may come from the component-level '
    + '`dataSource` binding instead. `columns` is required and holds at least one column, each the '
    + 'strict, name-keyed inline grid column a relationship field\'s `inlineColumns` takes — '
    + '`{ name, label?, type?, options?, … }`. Write `name` where a column said `field` (or '
    + '`fieldName`, `key`); declare `label`, `type` and `options` on the column, because this block '
    + 'draws a column exactly as declared and hydrates nothing from the child object\'s field; '
    + 'delete `scale` from a column declaring `type: \'currency\'`; delete `addLabel`, `formFields` '
    + 'and `inlineMode`, which belong to an `object-master-detail-form` detail entry and are not read '
    + 'here, `sortField`, which no block takes (the detail entry derives the line-position field from '
    + 'the child object), and any other key the shape does not declare.',
  reason: 'The block draws one inline grid of the record\'s child rows, through the same objectui '
    + 'grid as the other three carriers of the inline grid column, but it had no `ComponentPropsMap` '
    + 'row: it was the one entry on the string-arm registration ledger, so the component-props gate '
    + 'skipped it as unregistered and every authored key rode through. The showcase project page '
    + 'keyed all five of its columns `field`, the spelling the grid retired, and published green; the '
    + 'grid binds a column by `name`, so every cell rendered empty. The row is measured from the '
    + 'renderer\'s read points at the objectui pin, not from the registration\'s declared-input list, '
    + 'and its `columns` references the column schema, so every rule that schema holds applies here '
    + 'too, with its own prescription. It is read where every page component\'s props are: the '
    + 'component-props gate reports a failing key or column as an advisory '
    + '`component-props-unknown-key` / `component-props-invalid` finding on `objectstack validate`, '
    + '`objectstack build` and `objectstack lint`, and a stored page still saves and loads, because a '
    + 'page component\'s `properties` is not parsed on the metadata save or load path. `defineStack`\'s '
    + 'identity-only column check does not reach this block: the panel hands its columns to the grid '
    + 'as authored, so there is no hydrated type to judge. No conversion is registered: nothing on the '
    + 'load path refuses the shape, and the one `field`-keyed producer was respelled in the same '
    + 'change. Population measured at the change, on origin/main 1ecb871beb: one authored block in '
    + 'the examples (the showcase project detail page, five `field`-keyed columns, respelled `name`), '
    + 'zero in the documentation, against eight authored `record:*` blocks of other types through '
    + 'the same matcher as the control. '
    + 'Deployed metadata NOT MEASURED.',
  acceptanceCriteria: 'Every `record:line_items` node validates: `objectstack validate` reports no '
    + '`component-props-unknown-key` / `component-props-invalid` finding on its `properties` path. '
    + 'Every node carries `relationshipField` and at least one column, every column is an object '
    + 'carrying `name`, no column carries `field`, `fieldName` or `key`, and no key outside the '
    + 'declared shape is present. The showcase project detail page\'s block parses with its five '
    + '`name`-keyed columns, and its grid renders a value — not a blank cell — in each column for a '
    + 'row that has one.',
};
