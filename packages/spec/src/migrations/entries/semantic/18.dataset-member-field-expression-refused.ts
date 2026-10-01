// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #21220 (ADR-0049 enforce-or-remove) — an ADR-0021 dataset dimension's and
// measure's `field` is a column reference, the accept set the cube members it
// compiles to hold since `cube-member-sql-expression-retired`, from one shared
// declaration. The D3 entry of the `dataset-count-measure-empty-field-removed`
// family: that D2 conversion carries the one lossless repair (a `count`
// measure's empty `field` is dropped, and the measure still counts rows); this
// entry carries the rest, which has no mechanical rewrite — an expression
// becomes a measure filter, a derived measure or a field of the object, and
// only the author knows which.
export const entry: SemanticMigration = {
  id: 'dataset-member-field-expression-refused',
  // No backticks and no pipes in `surface` — build-upgrade-guide.ts renders it
  // inside a code span AND a table cell.
  surface:
    'datasets[].dimensions[].field and datasets[].measures[].field (ui.DatasetDimensionSchema.field / '
    + 'ui.DatasetMeasureSchema.field) authored as anything but a column reference — a SQL expression '
    + '(an arithmetic, an aggregate, a CASE, a subquery, a function call), a quoted or $-prefixed '
    + 'spelling, a padded or empty string, a broken path, or * on a dimension',
  replacement:
    'a column reference: a field of the dataset\'s object (`amount`), or a relationship path ending '
    + 'in one (`account.amount`) whose relationships are declared in `include`; on a measure also '
    + '`\'*\'` for a count, and a count may omit `field` altogether (never `field: \'\'`). A derived '
    + 'value takes its ADR-0021 form: a conditional count or sum is a measure with its own structured '
    + '`filter` (`{ name: \'done_count\', aggregate: \'count\', filter: { status: \'done\' } }`), and a '
    + 'ratio, sum, difference or product of measures is `derived: { op, of: [...] }` over measures '
    + 'named in the same dataset (`{ name: \'done_rate\', derived: { op: \'ratio\', of: '
    + '[\'done_count\', \'task_count\'] }, format: \'0.0%\' }`). A dimension that bucketed a column '
    + 'with an expression has no expression form: group by the column itself, or keep the bucket as a '
    + 'field of the object and name that field',
  reason:
    'The dataset layer was declared to take no raw SQL (ADR-0021 "zero raw SQL / zero raw '
    + 'expressions"), and its `field` was documented as a field or a relationship path, but the slot '
    + 'was a bare string and parsed anything — declared, never enforced (ADR-0049). The runtime had '
    + 'already closed the other end for an expression: the analytics dataset door refuses one with a '
    + '403 refusal, inline or saved, because an expression names no single field and no platform '
    + 'check can judge which fields it reads. So an expression could be saved and never answered. '
    + 'That door never judged an empty `field` — it skips one. The cube members a dataset compiles '
    + 'to were narrowed to the same accept set earlier (`cube-member-sql-expression-retired`); the '
    + 'dataset compiler copies `field` '
    + 'into the member\'s `sql` verbatim, so the two slots now share one declaration. A dimension '
    + 'additionally refuses `\'*\'`: grouping by every column is no axis, and both analytics '
    + 'strategies answered such a dimension with a 500 database fault. An empty string is refused on both: '
    + 'a dimension groups by nothing, and a count spells "no field" by omitting the key. One empty '
    + 'string had a working row and has a lossless repair: a `count` measure with `field: \'\'` (the '
    + 'shape a blank Field box in Studio\'s dataset inspector stores) compiled to the row count on '
    + 'SQLite\'s native-SQL path, and without the key it compiles to `COUNT(*)` — the D2 conversion '
    + '`dataset-count-measure-empty-field-removed` drops it from stored rows and sources. Everything '
    + 'else has no mechanical rewrite into a column: an expression becomes a measure filter, a derived '
    + 'measure or a field of the object, and a ratio changes scale on the way (a `derived` ratio is a '
    + '0–1 fraction, so an expression that multiplied by 100 returned percentage points). ADR-0021 / '
    + 'ADR-0049 / ADR-0087',
  acceptanceCriteria:
    'Every dataset parses: `DatasetSchema`, the dataset write door and defineStack refuse a '
    + 'non-column `field` at `dimensions.N.field` / `measures.N.field` with a prescription that names '
    + 'the column-reference contract and the ADR-0021 form, so the sweep is mechanical — parse each '
    + 'dataset, and each refusal is one member to change. A count measure that carried `field: \'\'` '
    + 'loses the key by the D2 conversion, parses, and still counts rows; a non-count measure or a '
    + 'dimension with an empty `field` is left as stored and refused until it names a column. For '
    + 'each moved measure, a query over a fixture where the '
    + 'condition excludes rows returns the figure the expression meant (a ratio: the same value '
    + 'divided by 100 when the expression returned percentage points). A dimension or measure whose '
    + '`field` is a column or a relationship path parses byte-identically to before.',
  conversionIds: ['dataset-count-measure-empty-field-removed'],
};
