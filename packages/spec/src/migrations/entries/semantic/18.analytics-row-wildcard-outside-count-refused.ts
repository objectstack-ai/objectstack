// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #21409 (ADR-0049 enforce-or-remove) — the row wildcard `'*'` is admitted only
// where a `count` consumes it: a cube measure under `type: 'count'` and a dataset
// measure under `aggregate: 'count'`. A cube dimension's `sql` takes the column
// path without the wildcard arm (the dataset dimension's pattern since
// `dataset-member-field-expression-refused`), and both measure slots ask one
// shared predicate. Semantic only, with no D2 conversion: such a member never
// produced an answer, and there is no lossless rewrite — `count` changes the
// figure the author asked for, and a column is the author's to name.
export const entry: SemanticMigration = {
  id: 'analytics-row-wildcard-outside-count-refused',
  // No backticks and no pipes in `surface` — build-upgrade-guide.ts renders it
  // inside a code span AND a table cell.
  surface:
    'analyticsCubes[].measures.<metric>.sql, analyticsCubes[].dimensions.<dimension>.sql and '
    + 'datasets[].measures[].field (data.MetricSchema.sql / data.DimensionSchema.sql / '
    + 'ui.DatasetMeasureSchema.field) authored as the row wildcard * where no count consumes it — a cube '
    + 'measure whose type is anything but count, any cube dimension, and a dataset measure whose '
    + 'aggregate is anything but count or that declares none (a derived measure)',
  replacement:
    'what the member meant. A row count: `type: \'count\'` on a cube measure or `aggregate: \'count\'` '
    + 'on a dataset measure, keeping `\'*\'` (a dataset count may also omit `field`). An aggregate of '
    + 'values: the column it aggregates — a field of the object (`amount`) or a relationship path '
    + 'ending in one (`account.amount`). A cube dimension: the column it groups by; to count rows, '
    + 'declare a `count` measure instead. A `derived` measure: delete the `field` key, which nothing '
    + 'read — a derived measure combines other measures by name',
  reason:
    '`\'*\'` is the row wildcard a `count` aggregates (`COUNT(*)`): it reads no field value, so no '
    + 'other aggregate has a column to read over it, and a dimension has no aggregate at all. The '
    + 'contract nevertheless admitted it in a cube member\'s `sql` on any measure and on a dimension, '
    + 'and in a dataset measure\'s `field` under any aggregate, and the analytics strategies passed it '
    + 'to the database as written. Measured at POST /api/v1/analytics/dataset/query over a real '
    + 'SQLite driver, on the native-SQL and the ObjectQL strategy alike: a dataset measure aggregating '
    + '`\'*\'` under `sum`, `avg`, `min`, `max` or `count_distinct` answered 500 DATABASE_ERROR — a '
    + 'server fault for an authoring mistake the contract had admitted. A dataset measure compiles to '
    + 'the cube measure it names verbatim, so the same reading covers an authored cube measure; a '
    + 'dimension over `\'*\'` (GROUP BY *) was measured the same way when the dataset dimension was '
    + 'narrowed. Such a member never produced an answer, so no working document changes meaning: the '
    + 'failure moves from the query to the authoring parse, which names the slot and the aggregate and '
    + 'prescribes a `count` or a column. There is no D2 conversion: rewriting to `count` would change '
    + 'the figure the author asked for, and only the author knows which column a sum over `\'*\'` was '
    + 'meant to read. A STORED document is not rewritten: a metadata read still serves it as stored, '
    + 'with the refusal on its read diagnostics, and a re-save through the metadata write door is '
    + 'refused at the slot. The dataset query door parses every dataset it is handed, inline or saved, '
    + 'so a stored dataset carrying such a measure is refused 400 VALIDATION_FAILED on EVERY query — '
    + 'including a query that selects only its other measures, which used to answer: it fails closed '
    + 'until the member is fixed. An authored cube reaches the analytics runtime through the stack '
    + 'definition, whose parse refuses it when the stack is built. In-repo census before the change: no '
    + 'example, platform object, doc, skill or fixture authored one, and neither did objectui at the '
    + 'pinned commit; deployed metadata was NOT measured. ADR-0021 / ADR-0049 / ADR-0087',
  acceptanceCriteria:
    'Every analytics cube and dataset parses: `CubeSchema`, `DatasetSchema`, the analytics_cube and '
    + 'dataset write doors, defineCube and defineStack refuse `\'*\'` on a cube measure whose `type` is '
    + 'not `count` and on a dataset measure whose `aggregate` is not `count` (at its `sql` / `field`, '
    + 'code custom), and on a cube dimension (at its `sql`, code invalid_format), each naming the slot '
    + 'and prescribing a `count` or a column, so the sweep is mechanical — parse each document, and each '
    + 'refusal is one member to change. For each changed member, a query that selects it returns a '
    + 'figure instead of a 500, and a dashboard bound to a stored dataset that carried one answers '
    + 'again on every widget. A `count` over `\'*\'`, a dataset count with no `field`, and every member '
    + 'that names a column parse byte-identically to before and run on both strategies.',
};
