// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #21142 — the fourth carrier of the inline grid column, and the last
// registered `record:*` renderer without a `ComponentPropsMap` row. The type
// sat on the string-arm registration ledger instead, so the component-props
// gate skipped its props bag: the showcase project page keyed all five of its
// columns `field` and published green over a grid of empty cells. The row
// declares the fifteen keys objectui's `LineItemsPanel` reads, and its
// `columns` REFERENCES `InlineGridColumnSchema`. D3 only: page-component
// `properties` is not parsed on the metadata load path, so a stored page is
// never refused at load (its next save meets the component-props gate at the
// metadata save door) and there is no load-path refusal for a conversion to
// pre-empt; the one `field`-keyed producer the census found is respelled in the
// same change. #24190 — once the panel hydrated an identity-only column from the
// child field, `defineStack`'s identity-only check reached this carrier too, the
// reach `inline-grid-column-identity-only-currency-scale-refused` records for
// the relationship field and the form view.
export const entry: SemanticMigration = {
  id: 'ui-record-line-items-props-closed',
  surface: 'page `record:line_items` components — `properties` (which used to accept any key) and '
    + '`properties.columns[]` (its inline grid columns), including `scale` on a column that '
    + 'declares no `type` and whose `name` is a `currency` field of the block\'s child object',
  replacement: 'the declared shape the renderer reads: `{ childObject?, relationshipField, columns, '
    + 'parentObject?, parentId?, recordId?, amountField?, totalField?, title?, readonly?, minRows?, '
    + 'maxRows?, filter?, sort?, limit? }`, with `filter` the ViewFilterRule array, `sort` the SortItem '
    + 'array and `limit` a positive integer; `childObject` may come from the component-level '
    + '`dataSource` binding instead. `columns` is required and holds at least one column, each the '
    + 'strict, name-keyed inline grid column a relationship field\'s `inlineColumns` takes — '
    + '`{ name, label?, type?, options?, … }`, where `{ name }` alone hydrates the rest from the '
    + 'child object\'s field. Write `name` where a column said `field` (or `fieldName`, `key`); '
    + 'delete `scale` from a column that renders as a currency column, whether it declares '
    + '`type: \'currency\'` or takes it from a `currency` child field — nothing replaces it, the '
    + 'currency\'s ISO 4217 minor unit decides; delete `addLabel`, `formFields` '
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
    + 'component-props gate reports a failing key or column as a '
    + '`component-props-unknown-key` / `component-props-invalid` error on `objectstack validate`, '
    + '`objectstack build` and `objectstack lint`, and a stored page still loads, because a '
    + 'page component\'s `properties` is not parsed on the metadata load path, and the next save of the page meets the component-props gate at the metadata save door. The '
    + 'identity-only half is `defineStack`\'s cross-reference check: the panel hydrates a column '
    + 'that declares no `type` from the child object\'s field, with the same rule the other carriers '
    + 'use, so the check reaches the block wherever a page carries it and refuses an identity-only '
    + 'column over a `currency` child field that carries `scale`, with the column schema\'s own '
    + 'message; reach: the child object — the object `dataSource` binding\'s `object` when the node '
    + 'carries one, else `childObject` — must be declared in the same stack, and a column the column '
    + 'schema refuses on its own is left to the component-props gate. No conversion is registered: '
    + 'nothing on the load path refuses the shape, and the one `field`-keyed producer was respelled '
    + 'in the same change. Population measured at the change, on origin/main 1ecb871beb: one '
    + 'authored block in the examples (the showcase project detail page, five `field`-keyed columns, '
    + 'respelled `name`), zero in the documentation, against eight authored `record:*` blocks of '
    + 'other types through the same matcher as the control. Population for the identity-only reach, '
    + 'measured on origin/main ec749fbb44: two authored blocks in the examples (the showcase project '
    + 'detail page, five typed columns; the showcase invoice document page, four `{ name, label }` '
    + 'columns, two of them over `currency` fields) and one in the published skills, none carrying '
    + '`scale`. Deployed metadata NOT MEASURED.',
  acceptanceCriteria: 'Every `record:line_items` node validates: `objectstack validate` reports no '
    + '`component-props-unknown-key` / `component-props-invalid` finding on its `properties` path '
    + 'and no cross-reference finding on a `columns[].scale` path. '
    + 'Every node carries `relationshipField` and at least one column, every column is an object '
    + 'carrying `name`, no column carries `field`, `fieldName` or `key`, no column that renders as a '
    + 'currency column carries `scale`, and no key outside the '
    + 'declared shape is present. The showcase project detail page\'s block parses with its five '
    + '`name`-keyed columns, and its grid renders a value — not a blank cell — in each column for a '
    + 'row that has one.',
};
