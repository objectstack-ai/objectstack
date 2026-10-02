// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #21000 (ADR-0049 enforce-or-remove) — `AggregationMetricType`'s `number`,
// `string` and `boolean` declared a custom SQL expression returning that type,
// and a cube member's `sql` has been a column reference since
// `cube-member-sql-expression-retired`, so the three had nothing left to
// compute. A value-level retirement (`enumWithRetiredValues`), semantic only:
// no D2 conversion, because no rewrite can say which aggregate the author
// meant, and a stored cube carrying one is refused at every door rather than
// rewritten.
export const entry: SemanticMigration = {
  id: 'cube-metric-expression-types-retired',
  // No backticks and no pipes in `surface` — build-upgrade-guide.ts renders it
  // inside a code span AND a table cell.
  surface:
    'analyticsCubes[].measures.<metric>.type (data.AggregationMetricType) authored as number, string '
    + 'or boolean — the custom-SQL-expression metric types',
  replacement:
    'the aggregate the measure means: `sum`, `avg`, `min` or `max` over the column, `count` (over '
    + '`\'*\'` for a row count, or over a column for its non-null values), or `count_distinct`. A value '
    + 'computed per row becomes a field of the object (a stored or formula field) that the measure '
    + 'aggregates; a ratio or other value derived from measures is `derived: { op, of: [...] }` on an '
    + 'ADR-0021 dataset',
  reason:
    'The three types existed to mark a measure whose `sql` was the whole computation — a ratio, a '
    + 'CASE, a window function — and named only what it returned. Since '
    + '`cube-member-sql-expression-retired` a member\'s `sql` is a column reference, so the types had '
    + 'nothing left to declare: measured before this retirement, the raw-SQL strategy emitted the '
    + 'referenced column unaggregated (a bare column in a grouped statement, by SQL\'s own rules an '
    + 'error on PostgreSQL and an arbitrary row\'s value on SQLite) and the ObjectQL strategy refused '
    + 'the measure. There is no D2 conversion: the column alone does not say which aggregate the author '
    + 'wanted — a `number` over `amount` may have meant its sum, its average or its largest value — '
    + 'so only the author can choose, and a measure whose old expression computed something per row '
    + 'needs that value stored on the object before any aggregate can read it. Nothing is rewritten '
    + 'or dropped at rest: a stored or built cube that still carries one of the three is refused, '
    + 'with the prescription, at the boot and write doors, and a cube that reaches the analytics '
    + 'service without meeting the parse is refused at query time with the same text. ADR-0049 / '
    + 'ADR-0087',
  acceptanceCriteria:
    'Every analytics cube parses: `CubeSchema`, the analytics_cube write door and defineStack refuse '
    + 'a measure typed number, string or boolean at its `type` with a prescription naming the six '
    + 'aggregates, so the sweep is mechanical — parse each cube, and each refusal is one measure to '
    + 'retype. For each retyped measure, a query over a fixture with more than one row per group '
    + 'returns the aggregate the author chose, and every dashboard, report or saved query that read '
    + 'the measure is checked against the number it now returns. A measure typed with one of the six '
    + 'aggregates parses byte-identically to before.',
};
