// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'element-record-picker-filter-rule-array',
  surface:
    "`element:record_picker` component props — `filter` (the FORM: the MongoDB-style "
    + '`FilterConditionSchema` record vs the `ViewFilterRule` array)',
  replacement:
    '`z.array(ViewFilterRuleSchema)` — the rule array `[{ field, operator, value }, ...]` '
    + "the map's array-declared `filter` doors already carry (`record:related_list`, its nested "
    + 'Add-affordance picker, `element:number`; the four `object-*` blocks declare `filter` as '
    + '`z.unknown()`, #15449). A record-form filter '
    + "`{ status: 'active' }` becomes `[{ field: 'status', operator: 'equals', value: 'active' }]`; "
    + "an operator object `{ amount: { $gt: 100 } }` becomes "
    + "`[{ field: 'amount', operator: 'greater_than', value: 100 }]`; several keys become "
    + 'several rules (they AND). Legacy operator shorthands (`eq`, `gt`, `notIn`, …) are '
    + 'accepted and normalized on parse. The binding-level `dataSource.filter` on the same node '
    + 'is a different key (`ElementDataSourceSchema`) and is not moved by this entry',
  reason:
    'One filter orthography platform-wide (objectui#6206, maintainer batch adjudication '
    + "2026-08-25, verbatim 「同意」, Option B). `ComponentPropsMap['element:record_picker'].filter` "
    + 'was the LAST `filter` input in the map still declared as the MongoDB-style record '
    + '(`FilterConditionSchema`) after `element:number` converged (#12039 Key 2): the three '
    + 'array-declared doors (`record:related_list`, its nested Add-affordance picker, '
    + '`element:number`) carried the `ViewFilterRule` array and the four `object-*` doors '
    + 'declare `z.unknown()` (#15449), so the filter a list view stores and renders was refused '
    + 'by the picker beside them, and a lone holdout is the state where the next author copies '
    + 'the wrong form. Sequenced measurement-first, as that convergence had to be (the 2026-08-25 '
    + 'Option-A ordering ruling, #14406): at the objectui pin `00d3f09c` the renderer hands '
    + '`filter` to `query.$filter` and calls `adapter.find()` '
    + '(`components/src/renderers/basic/record-picker.tsx`); `ObjectStackAdapter.convertQueryParams` '
    + 'lowers an ARRAY `$filter` through `translateFilterArray` into filter AST tuples '
    + '(`data-objectstack/src/index.ts`), the same door every list view\'s stored rule array '
    + 'already takes, and the engine lowers the tuples before the driver '
    + '(`engine-filter-array-lowering.test.ts`); nothing on that path parses `properties` '
    + 'against the installed spec. The pin and objectui `main` (`f7cf7e8`) are byte-identical on '
    + 'every read-path file. The ruled migration check ran with the change: the sweep of '
    + 'first-party corpora (examples/, skills/, content/docs/, docs/, packages/**, .changeset/) '
    + 'found ONE `element:record_picker` author writing a record-form `filter` — a spec test '
    + 'fixture, rewritten to the array form in the same change — and zero outside the spec '
    + 'package; this entry carries the prescription for authors outside the repo.',
  acceptanceCriteria:
    "`ComponentPropsMap['element:record_picker'].safeParse({ object, filter: [{ field: "
    + "'status', operator: 'equals', value: 'active' }] })` succeeds and the parsed `filter` is "
    + "the same rule array; a record-form `filter: { status: 'active' }` is refused at the "
    + '`filter` path (`invalid_type`, expected array). At runtime the picker offers exactly the '
    + 'rows the array selects — the same filter a list view renders. Downstream (objectui, after '
    + "a released spec version reaches the pin): the registry's `inputs.filter` entry for "
    + "`element:record_picker` (`type: 'object'`, `record-picker.tsx`) flips to the array arm and "
    + 'the `record-picker-inputs-spec-parity.test.ts` pins that assert the record form follow — '
    + 'objectui#7663, filed from #14406 with a Blocked-by line.',
};
