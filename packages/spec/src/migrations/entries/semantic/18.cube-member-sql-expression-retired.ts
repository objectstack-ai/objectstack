// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #20943, maintainer ruling D — a cube member's `sql` is a column reference;
// the expression half is retired at the contract (ADR-0021's zero raw
// expressions, carried from the dataset layer to the cube members it compiles
// to). Semantic only, with no D2 conversion: an expression has no mechanical
// rewrite — it moves to another metadata type, and a ratio changes scale on
// the way — so the upgrader owes the judgement this entry states.
export const entry: SemanticMigration = {
  id: 'cube-member-sql-expression-retired',
  // No backticks and no pipes in `surface` — build-upgrade-guide.ts renders it
  // inside a code span AND a table cell.
  surface:
    'analyticsCubes[].measures.<metric>.sql and analyticsCubes[].dimensions.<dimension>.sql '
    + '(data.MetricSchema.sql / data.DimensionSchema.sql) authored as a SQL expression — a CASE '
    + 'expression, an aggregate or a ratio of aggregates, a quoted or $-prefixed spelling, or any '
    + 'other value that is not a column reference',
  replacement:
    'a column reference: a field of the cube\'s object (`amount`), a relationship path ending '
    + 'in one (`account.amount`), or `\'*\'` for a count. A derived value moves to an '
    + 'ADR-0021 dataset over the same object: a conditional count or sum is a dataset measure '
    + 'with its own structured `filter` (`{ name: \'done_count\', aggregate: \'count\', filter: '
    + '{ status: \'done\' } }`), and a ratio, sum, difference or product of measures is '
    + '`derived: { op, of: [...] }` over measures named in the same dataset (`{ name: '
    + '\'done_rate\', derived: { op: \'ratio\', of: [\'done_count\', \'task_count\'] }, format: '
    + '\'0.0%\' }`). A dimension that bucketed a column with a CASE expression has no expression '
    + 'form in either layer: group by the column itself, or keep the bucket as a field of the '
    + 'object and name that field',
  reason:
    'Maintainer ruling D (2026-09-30), from the analytics field-level read gate: a member whose '
    + '`sql` is an expression names no single field, so no platform check can judge which fields '
    + 'it reads, and the analytics strategies never agreed on it — the raw-SQL path emitted it '
    + 'verbatim and the ObjectQL path refused it. ADR-0021 already set the direction for the '
    + 'author surface ("zero raw SQL / zero raw expressions"); it governed the dataset layer and '
    + 'left the cube members it compiles to open, which is the gap this closes. The dataset form '
    + 'is the declared home of a derived value because every field it reads is named: a measure '
    + 'filter names its fields, and a derived measure references other measures by name only. '
    + 'There is no D2 conversion: the rewrite moves a member to a different metadata type and '
    + 'cannot be derived from the expression text in general, so only the author can say which '
    + 'dataset measures express what the expression meant. A ratio also changes SCALE on the way: '
    + 'a `derived` ratio is a 0–1 fraction, while an expression that multiplied by 100 returned '
    + 'percentage points — pair the ratio with a `%` numeral pattern (the server marks a ratio '
    + 'column\'s percent scale as a fraction) and re-check any consumer that read the old number '
    + 'raw. ADR-0021 / ADR-0049 / ADR-0087',
  acceptanceCriteria:
    'Every analytics cube parses: `CubeSchema`, the analytics_cube write door and defineStack '
    + 'refuse an expression member at its `sql` with a prescription that names the dataset form, '
    + 'so the sweep is mechanical — parse each cube, and each refusal is one member to move. For '
    + 'each moved measure, a dataset over the same object declares it, and a query over a fixture '
    + 'where the condition excludes rows returns the same figure the expression returned (a '
    + 'ratio: the same value divided by 100 when the expression returned percentage points). '
    + 'Every dashboard, report or saved query that named the cube member now names the dataset '
    + 'measure. A cube member that aggregates a column parses byte-identically to before.',
  relevantWhen: { kind: 'stack-declares', keys: ['analyticsCubes'] },
};
