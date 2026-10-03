// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #21464 — the list members of the `object-grid`, `object-kanban` and
// `object-calendar` page blocks were `z.unknown()` (an array of it for the
// lists) although each renderer reads them with a fixed shape, so an off-shape
// value passed the component-props gate and the block dropped or substituted it
// in silence. The rows now take the list view's own members by reference where
// a list view declares one, and the measured shape otherwise. D3 only:
// page-component `properties` is not parsed on the metadata save or load path,
// so a stored page is never refused; an off-shape value has no rewrite that
// says what the author meant; and the authored census found no authored value
// to respell — the refused values are fixtures probing that the renderer drops
// them.
export const entry: SemanticMigration = {
  id: 'ui-object-grid-kanban-calendar-list-members-typed',
  surface: 'page `object-grid` components — `properties.columns`, `.fields`, `.selection`, `.selectable`, '
    + '`.rowActions`, `.bulkActions` and `.batchActions`; page `object-kanban` components — '
    + '`properties.columns`; page `object-calendar` components — `properties.calendar` (which used to '
    + 'accept any value)',
  replacement: 'the shape each block reads, the list view\'s own where it has one: `object-grid` `columns` '
    + 'all field-name strings or all column entries `{ field, label?, width?, … }` (never mixed); `fields` '
    + 'field-name strings; `selection` `{ type }` with `none` / `single` / `multiple`; `selectable` `true`, '
    + '`false`, `\'single\'` or `\'multiple\'`; `rowActions`, `bulkActions` and `batchActions` action-name '
    + 'strings. `object-kanban` `columns` all lanes `{ id, title, cards?, limit?, className?, collapsed? }` '
    + 'or all bare value strings (never mixed), a lane `id` a string. `object-calendar` `calendar` '
    + '`{ startDateField, endDateField?, titleField?, colorField?, allDayField? }`. Rewrite a grid column '
    + 'written `{ accessorKey, header }` or `{ name }` as `{ field, label }`; move an object entry of '
    + '`fields` to `columns`; move a `{ name }` entry of `bulkActions` to `bulkActionDefs` or write the '
    + 'bare name; style a lane with `className` instead of `color`; rename `dateField` / `endField` to '
    + '`startDateField` / `endDateField`.',
  reason: 'Each renderer reads these members with one shape, and the page-component rows declared them '
    + '`z.unknown()`, so any value passed the component-props gate and the block answered an off-shape one '
    + 'with a silent default: a grid column keyed `accessorKey` or `name`, or an array mixing strings and '
    + 'column objects, drew no column; an object entry of `fields` named no field; a `{ name }` entry of '
    + '`bulkActions` was skipped; a kanban lane list mixing objects and strings drew a blank lane and swept '
    + 'its records into the trailing lane; and a calendar block without `startDateField` placed no event. The rows '
    + 'now take the list view\'s own `columns`, `selection`, `rowActions`, `bulkActions` (for `batchActions` '
    + 'too, the spelling the grid reads first) and `calendar` members by reference, and the measured shape '
    + 'for the grid\'s `fields` and `selectable` and the kanban lane, so one value is judged the same way '
    + 'on every door that carries it. It is read where every page component\'s props are: the '
    + 'component-props gate reports a refused value as an advisory `component-props-invalid` / '
    + '`component-props-unknown-key` finding on `objectstack validate`, `objectstack build` and '
    + '`objectstack lint`, and a stored page still saves and loads, because a page component\'s '
    + '`properties` is not parsed on the metadata save or load path. No conversion is registered: nothing '
    + 'on the load path refuses the shape, and an off-shape value has no rewrite that both keeps what the '
    + 'block shows today and honours what the author wrote — which is the judgment this entry leaves to '
    + 'the upgrader. Deployed metadata NOT MEASURED.',
  acceptanceCriteria: 'Every `object-grid`, `object-kanban` and `object-calendar` node validates: '
    + '`objectstack validate` reports no `component-props-invalid` / `component-props-unknown-key` '
    + 'finding under the nine members\' paths. Each block that set one of them now shows it: the declared '
    + 'grid columns, the selection mode, the row and bulk actions, the kanban lanes with their records, and '
    + 'the calendar events placed by `startDateField`.',
};
