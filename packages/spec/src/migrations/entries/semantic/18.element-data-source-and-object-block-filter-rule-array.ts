// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'element-data-source-and-object-block-filter-rule-array',
  surface:
    'Page-component `dataSource.filter` (`ElementDataSourceSchema`, the binding every '
    + 'data-bound element carries) and the `filter` prop of the four `object-*` blocks in '
    + '`ComponentPropsMap` — `object-grid`, `object-metric`, `object-kanban`, `object-calendar` '
    + '(the FORM: the MongoDB-style `FilterConditionSchema` record at the binding, and the '
    + 'accept-anything `z.unknown()` at the four block doors, vs the `ViewFilterRule` array)',
  replacement:
    '`z.array(ViewFilterRuleSchema)` at all five doors — the rule array '
    + '`[{ field, operator, value }, ...]` every other `filter` door in the map already carries '
    + '(`record:related_list`, its Add-affordance picker, `element:number`, '
    + '`element:record_picker`). A record-form filter `{ status: \'active\' }` becomes '
    + '`[{ field: \'status\', operator: \'equals\', value: \'active\' }]`; an operator object '
    + '`{ status: { $ne: \'done\' } }` becomes '
    + '`[{ field: \'status\', operator: \'not_equals\', value: \'done\' }]`; several keys become '
    + 'several rules (they AND). An ObjectQL AST tuple array '
    + '`[[\'owner_id\', \'=\', \'{current_user_id}\']]` — which the `z.unknown()` block doors '
    + 'also took — becomes `[{ field: \'owner_id\', operator: \'equals\', value: '
    + '\'{current_user_id}\' }]`; the value placeholders and date macros are unchanged. Legacy '
    + 'operator shorthands (`eq`, `ne`, `gt`, `notIn`, …) are accepted and normalized on parse. '
    + 'The dashboard widget `filter` (`dashboard.zod.ts`) is a different family and is not moved '
    + 'by this entry (#15829); `object-grid.defaultFilters` is a different key and is not named '
    + 'by the ruling this entry records.',
  reason:
    'One filter orthography platform-wide (objectui#6206, maintainer batch adjudication '
    + '2026-08-25, verbatim 「同意」, Option B) reached two more locations the ComponentPropsMap '
    + 'census could not see (#15442 anchor, #15449 member; decision batch #55, 2026-09-06, '
    + 'verbatim 「同意」, option A: converge family-wide, one entry). The binding-level '
    + '`dataSource.filter` alone still said `FilterConditionSchema`: it refused the array the '
    + 'consumer\'s own pins author at that key, and `element:record_picker` carried two '
    + 'orthographies at two keys (`properties.filter` the rule array, `dataSource.filter` the '
    + 'record) resolved through one `??` in the renderer — the shape in which a dropped or '
    + 'misread filter returns the wrong rows without an error. The four `object-*` doors said '
    + '`z.unknown()`: a read-point record derived from the renderers on 2026-08-13 (#7751), '
    + 'twelve days before the ruling, not an exception to it — so an author following the '
    + 'showcase wrote the record and an author following the manifest wrote an array, and each '
    + 'got a silent success receipt while the html tier already declared `array` for the grid '
    + 'and the metric. The record\'s `$and` / `$or` / `$not` keys were misread by every gate '
    + 'block anyway (objectui#6948), so the exception would have preserved a capability the '
    + 'consumer does not honour. Sequenced measurement-first, as the family had to be: at the '
    + 'objectui pin `a472b07` the `object-metric` aggregate path posted an array `where` that '
    + '`POST /analytics/query` refused with 400 on every array form (#15828), so the converge '
    + 'was parked behind the pin bump #16626; at the pin this repo builds against (`53ded82b`, '
    + 'objectui#7754) the adapter lowers an authored array through `translateFilterArray` and '
    + 'the spec\'s own `parseFilterAST` sink before the wire, `ObjectGrid.tsx` lowers a rule '
    + 'array through `toFilterNode`, `ObjectKanban.tsx` / `ObjectCalendar.tsx` hand it verbatim '
    + 'to `$filter` where `convertQueryParams` lowers it, and the binding\'s composition seam '
    + 'AND-combines it with the named view\'s rules through `mergeFilterNodes`. The ruled '
    + 'migration check ran with the change: the in-repo sweep found four spec test fixtures '
    + 'at the binding (`page.test.ts`, all record form), five showcase authors at the block '
    + 'doors (`my-work.page.ts`, `index.ts`: four records on `object-metric`, one AST tuple '
    + 'array on `object-grid`) and three lint fixtures — every one rewritten to the rule array '
    + 'in the same change, and zero outside those files; this entry carries the prescription '
    + 'for authors outside the repo.',
  acceptanceCriteria:
    '`ElementDataSourceSchema.safeParse({ object, filter: [{ field: \'status\', operator: '
    + '\'equals\', value: \'active\' }] })` succeeds and the parsed `filter` is the same rule '
    + 'array; `ComponentPropsMap[\'object-grid\' | \'object-metric\' | \'object-kanban\' | '
    + '\'object-calendar\'].safeParse({ filter: <that array> })` raises no issue at `filter`; '
    + 'a record-form `filter: { status: \'active\' }` is refused at the `filter` path of all '
    + 'five doors (`invalid_type`, expected array), and an AST tuple array is refused at '
    + '`filter.0` (expected object). No `filter` door in `ComponentPropsMap` accepts the '
    + 'record any more (the twin of the #14406 census pin). At runtime each block and the '
    + 'binding select exactly the rows the array selects — the same filter a list view '
    + 'renders — including the `object-metric` aggregate tile, whose analytics `where` is the '
    + 'lowered condition. Downstream (objectui, after a released spec version reaches the '
    + 'pin): the seventeen `dataSource.filter` test authors at the pin (fifteen tuple arrays, '
    + 'two records) become off-spec fixtures and `ElementDataSourceConfig.filter`\'s '
    + '"three shapes" note narrows — objectui cards filed by the seat, not blocked on here.',
};
