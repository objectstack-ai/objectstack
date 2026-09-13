// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'dataset-measure-aggregate-field-type-refused',
  surface: 'dataset measure `aggregate` × `field` pairs (`DatasetMeasureSchema`, the rows '
    + 'inside `Dataset.measures[]`) over a TEMPORAL field — `date`, `datetime`, `time` — '
    + 'whose aggregate that declared `FieldType` cannot carry: `avg` and `sum` over any of '
    + 'the three. ⚠️ This entry is the FIRST of three that widened the same leg, and its '
    + 'scope sentence is kept as written: it covered the temporal class and nothing else. '
    + 'The non-temporal `sum` / `avg` rows followed under #16099, and the `min` / `max` '
    + 'rows under `dataset-measure-selecting-aggregate-field-type-refused` (#17560) — read '
    + 'all three when migrating, not this one alone',
  replacement: 'an aggregate the field\'s type accepts, per '
    + '`AGGREGATE_FIELD_TYPE_COMPATIBILITY` (`@objectstack/spec/data`, #16353): '
    + '`min` / `max` for a temporal field — both return a real instant of the field\'s own '
    + 'type — or `count` / `count_distinct`, which read no arithmetic off the value. '
    + 'A DURATION is not recoverable from an aggregate over instants: store it as a '
    + 'number (a computed "days open" field) and aggregate that. A `derived` measure whose `of` '
    + 'names a refused measure is fixed by fixing that measure, not the `derived` one',
  reason:
    '#16737 / #16099. Nothing between the author and the driver correlated a measure\'s '
    + 'aggregate with its field type, so `avg` over a `Field.datetime` compiled to '
    + '`AVG(col)` and reached the backend — where the ANSWER was decided by the dialect '
    + 'rather than by the data. Measured on both halves: SQLite coerces the column\'s '
    + 'canonical UTC text to a number by reading its leading digits, so '
    + '`avg(submitted_at)` over 2026-05 and 2025-01 returns `2025.5` — the average YEAR, '
    + 'no error, no log; PostgreSQL 16 answers `function avg(timestamp with time zone) '
    + 'does not exist` (SQLSTATE 42883). ⚠️ The two halves are not evidenced alike: the '
    + 'SQLite half is PINNED by a live `sql.js` suite in '
    + '`__tests__/aggregate-datetime-measure-refusal.test.ts`, while the Postgres half was '
    + 'MEASURED IN-SESSION on PostgreSQL 16.13 and is not pinned by any test — the live PG '
    + 'conformance job carries no cell for it. Nothing depends on it: the refusal is '
    + 'decided from declared metadata before a driver is reached. ⭐ The silent half is '
    + 'the dangerous one, and it is the DEV default: '
    + '`derived: { op: \'difference\', of: [avg_a, avg_b] }` over two '
    + 'such averages rendered `-0.85` on a tile labelled "average cycle time delta" — '
    + 'indistinguishable from a correct answer, which is the shape Prime Directive #12 '
    + 'exists to remove. Which pairs are accepted is therefore a contract, declared once '
    + 'in `@objectstack/spec` under the director ruling of decision batch #59 '
    + '(2026-09-06, "both legs, table in spec") and executed by the consumer legs; the '
    + 'compile-time leg (`dataset-compiler`, `service-analytics`) refuses the pair with '
    + '`DATASET_INVALID` / 400 before any query is built, using the declared type the '
    + 'host already supplies through `AnalyticsServiceConfig.sourceFieldMeta`. '
    + '⚠️ A `date` / `datetime` used as a DIMENSION — grouping, bucketing, date-range '
    + 'filtering — is untouched: this is about aggregation only.',
  acceptanceCriteria:
    'Every dataset measure over a `date` / `datetime` / `time` field pairs that field with '
    + 'an `aggregate` the temporal class accepts — `min`, `max`, `count`, `count_distinct` '
    + '— and none pairs it with `avg` or `sum`. ⚠️ The criterion reaches no further ON ITS '
    + 'OWN: a measure over a field of any OTHER class was not judged by this leg, and is '
    + 'covered instead by the two entries that widened it — #16099 for `sum` / `avg` over '
    + 'every other class, and `dataset-measure-selecting-aggregate-field-type-refused` '
    + '(#17560) for `min` / `max`. At protocol major 18 as a whole, every refused pair in '
    + '`AGGREGATE_FIELD_TYPE_COMPATIBILITY` is refused at the compile door. '
    + 'Accepted pairs compile and execute byte-identically to before '
    + '(`avg` over `number` / `currency`, `min` / `max` over `datetime`, `count` over '
    + 'anything); a refused pair answers `400 DATASET_INVALID` naming the measure, the '
    + 'field, its declared type and the accepted set, with no SQL emitted. The refusal '
    + 'stands down rather than guessing wherever the type cannot be resolved: no '
    + '`sourceFieldMeta` wired, an unknown field, or a `relationship.field` path whose '
    + 'column lives on a joined object.',
};
