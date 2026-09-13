// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'object-block-sort-item-array',
  surface:
    'The `sort` prop of `object-grid` and `object-calendar` in `ComponentPropsMap` '
    + '(the FORM: the accept-anything `z.unknown()` at both block doors, vs the '
    + '`SortItem` array `[{ field, order }, ...]`)',
  replacement:
    '`z.array(SortItemSchema)` at both doors — the array `ElementDataSourceSchema.sort`, '
    + '`ListPageSchema.sort` and `element:record_picker`\'s flat `sort` shorthand already '
    + 'carry. The legacy OData-ish clause `sort: \'created_at desc\'` becomes '
    + '`sort: [{ field: \'created_at\', order: \'desc\' }]`; a bare field name '
    + '`sort: \'created_at\'` meant ascending and becomes '
    + '`sort: [{ field: \'created_at\', order: \'asc\' }]` — `order` is required in '
    + '`SortItemSchema`, so it is written out rather than omitted. A comma-separated '
    + 'clause becomes one array entry per key, in the same order. `record:related_list` '
    + 'is NOT moved by this entry: its string is the `\'field\'` / `\'-field\'` dialect '
    + 'read by `RelatedList.normalizeSortSpec`, which never reaches '
    + '`convertSortToQueryParams`, and retiring it was not ruled. '
    + '`object-grid.defaultSort` is a different key, retired separately by the '
    + '`ui__ObjectGridProps__defaultSort` entry.',
  reason:
    'One `sort` spelling platform-wide, the array (objectui#8221, decision batch #77, '
    + '2026-09-07, maintainer verbatim 「其他同意」, option B; the consumer half is '
    + 'objectui PR #8758, which drops the string arm from `convertSortToQueryParams`). '
    + 'Item 4 of that ruling is this entry\'s subject: 「`ComponentPropsMap` for '
    + '`object-calendar` and `object-grid` constrains the `sort` value to the array shape '
    + '(today it accepts anything), so the spec, the registrations and the helper agree; '
    + 'that is a pull-back to the declared contract, ordinary tier」. The `z.unknown()` at '
    + 'both doors was a read-point record (#7751), the same vintage as the `filter` doors '
    + 'the `element-data-source-and-object-block-filter-rule-array` entry moved, and not an '
    + 'exception to the ruling: measured on `@objectstack/spec` 17.2.0 an array, a string '
    + 'and a bare NUMBER all returned `success: true` while `bogusProp` was refused by name '
    + 'on the same call, so key checking was live and only the VALUE was unheld. Meanwhile '
    + 'objectui\'s own html tier has published `type: \'array\'` for the grid all along '
    + '(`plugin-grid/src/index.tsx:222`) and answered `type-mismatch` on the string — a '
    + 'spelling `@object-ui/core` implemented, the docs taught and the validator refused, '
    + 'which is what made this a ruling rather than a mechanical widening. '
    + 'Sequenced measurement-first: at the objectui pin this repo builds against '
    + '(`53ded82b`) the string is still lowered — `ObjectGrid.tsx:1844-1851` carries an '
    + 'explicit `typeof === \'string\'` arm onto `$orderby`, and `ObjectCalendar.tsx:431` '
    + 'hands `schema.sort` to `convertSortToQueryParams`, whose string arm is still present '
    + 'at `sort-query.ts:66-70`. So this declaration lands AHEAD of the pinned consumer, '
    + 'which the ruling permits explicitly (either order; the registrations already declare '
    + 'the array). The in-repo sweep found ZERO authored `sort` on either block — the two '
    + 'showcase pages that author `object-grid` (`command-center.page.ts`, '
    + '`my-work.page.ts`) declare none — with the same grep shape finding 40+ string `sort` '
    + 'values at OTHER doors (view definitions, ObjectQL `query.sort`) as the control that '
    + 'the sweep fires; so this entry carries the prescription for authors outside the repo. '
    + '⚠️ Metadata AT REST is deliberately NOT rewritten and this disposition adds no D2 '
    + 'conversion: `os migrate meta --stored` replays D2 conversions only, and the read path '
    + 'does not re-validate stored rows (`applyConversionsToStoredItem` replays the chain '
    + 'without validating, by its own contract), so a stored page carrying a string `sort` '
    + 'keeps loading and is still rendered by objectui at the pinned `.objectui-sha`. What '
    + 'changes is that RE-SAVING it is refused at the `sort` door, on its next save and not '
    + 'before. ADR-0049, ADR-0087.',
  acceptanceCriteria:
    '`ComponentPropsMap[\'object-grid\' | \'object-calendar\'].safeParse({ objectName, '
    + 'sort: [{ field: \'created_at\', order: \'desc\' }] })` succeeds and the parsed `sort` '
    + 'is that same array, equal value-for-value to '
    + '`ElementDataSourceSchema.parse({ object, sort: <that array> }).sort`. The legacy '
    + 'string clause is refused at the `sort` path on both doors (`invalid_type`, expected '
    + 'array), and so is a bare number; a misspelled or ABSENT direction is refused at '
    + '`sort.0.order` (`invalid_value` — `order` is a required enum, so both take one '
    + 'verdict) and a missing field at `sort.0.field` (`invalid_type`). An undeclared key '
    + 'is still refused BY NAME on the same call (`unrecognized_keys` naming it), the '
    + 'control that makes those refusals verdicts rather than a schema reporting nothing. '
    + 'No `sort` door in `ComponentPropsMap` accepts a string except `record:related_list`, '
    + 'which is the one deliberate exception. At runtime each block orders exactly as the '
    + 'array orders — the same `$orderby` the string lowered to.',
};
