// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'element-number-filter-rule-array',
  surface:
    "`element:number` component props — `filter` (the FORM: the MongoDB-style "
    + '`FilterConditionSchema` record vs the `ViewFilterRule` array)',
  replacement:
    '`z.array(ViewFilterRuleSchema)` — the rule array `[{ field, operator, value }, ...]` '
    + 'every other `filter` input in `ComponentPropsMap` already declares '
    + '(`record:related_list` and its Add-affordance picker). A record-form filter '
    + "`{ status: 'won' }` becomes `[{ field: 'status', operator: 'equals', value: 'won' }]`; "
    + "an operator object `{ amount: { $gt: 100 } }` becomes "
    + "`[{ field: 'amount', operator: 'greater_than', value: 100 }]`; several keys become "
    + 'several rules (they AND). Legacy operator shorthands (`eq`, `gt`, `notIn`, …) are '
    + 'accepted and normalized on parse',
  reason:
    'One filter orthography platform-wide (objectui#6206, maintainer batch adjudication '
    + "2026-08-25, verbatim 「同意」, Option B). `ComponentPropsMap['element:number'].filter` "
    + 'was the one `filter` input in the map declared as the MongoDB-style record '
    + '(`FilterConditionSchema`) while its siblings declared the `ViewFilterRule` array, so '
    + 'the filter a list view stores and renders was refused by the KPI element beside it, '
    + 'and the objectui parity gate had to carry a reasoned exemption to look away. The '
    + 'convergence was sequenced consumer-first (ruling recorded 2026-08-25, Option A): '
    + 'objectui#6828 made `ObjectStackAdapter.aggregate()` lower a rule array through the '
    + 'same `translateFilterArray` its `find()` path runs before the analytics wire, and the '
    + 'objectui pin carrying it was re-measured before this entry moved — authored array → '
    + 'adapter lowering → filter AST → accepted by `lowerAnalyticsWhere`, which still refuses '
    + 'a RAW rule-object array by design. The ruled migration check ran with the change: the '
    + 'sweep of first-party corpora (examples/, skills/, create-objectstack, content/docs/, '
    + 'packages/apps/, spec fixtures) found ONE `element:number` author writing a record-form '
    + '`filter` — a spec test fixture, rewritten to the array form in the same change — and '
    + 'zero outside the spec package; this entry carries the prescription for authors outside '
    + 'the repo.',
  acceptanceCriteria:
    "`ComponentPropsMap['element:number'].safeParse({ object, aggregate, filter: [{ field: "
    + "'status', operator: 'equals', value: 'won' }] })` succeeds and the parsed `filter` is "
    + "the same rule array; a record-form `filter: { status: 'won' }` is refused at the "
    + '`filter` path (`invalid_type`, expected array). At runtime the element renders its '
    + 'aggregate on an analytics-capable deployment with the array filter applied — the same '
    + 'filter a list view renders. Downstream (objectui, after a released spec version reaches '
    + "the pin): the `element:number.filter:array` entry in `OFF_SPEC_ARM_EXEMPTIONS` "
    + '(`registry-inputs-spec-parity.test.ts`) becomes deletable, which is what closes '
    + 'objectui#6206.',
};
