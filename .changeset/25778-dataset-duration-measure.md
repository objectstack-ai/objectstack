---
'@objectstack/spec': minor
'@objectstack/service-analytics': minor
'@objectstack/lint': minor
'@objectstack/platform-objects': minor
'@object-ui/app-shell': minor
---

feat(spec,analytics,lint,platform-objects,app-shell): a dataset measure can aggregate the time between two datetime fields of each record

Clause-②: yes (widening)
Metadata-protocol: added

- **`@objectstack/spec`**: `DatasetMeasureSchema` gains an optional `duration: { from, to, unit }`, in place of `field`. `from` and `to` name two `datetime` fields of the dataset's own object by their bare names, `unit` is `seconds`, `minutes`, `hours` or `days`, and the measure's `aggregate` is `avg`, `min`, `max` or `sum` of `to` minus `from`. A relationship path, an expression or the row wildcard in either column, the same column twice, another unit, a counting aggregate, or a `field`, `derived` or `currency` beside it is refused at parse. New exports: `DatasetMeasureDurationSchema`, `DatasetDurationUnit`, `DATASET_DURATION_UNIT_SECONDS`, `DATASET_DURATION_AGGREGATES`, `DATASET_DURATION_FIELD_TYPE` and the `DatasetMeasureDuration` / `DatasetDurationUnit` types.
- **`@objectstack/service-analytics`**: the dataset compile refuses a duration column declared anything but `datetime` (`400 DATASET_INVALID`, naming the column and its type). The native-SQL strategy computes the duration as one statement on SQLite, PostgreSQL and MySQL, in double precision on each; SQLite and PostgreSQL are tested live to answer the same number: a record missing either instant is left out, a `to` before its `from` counts as negative, and over a group with no such record `sum` answers `0` and the others `null`. Measure filters, derived measures, ordering and the draft preview serve it. A query the native strategy does not serve (a time dimension bucketed by `granularity`, a field-to-field filter, an object served through engine middleware or an external datasource, a non-SQL datasource) is refused with `400 INVALID_FIELD` naming the measure. Its two columns pass the field-level read gate like any measure's field. The temporal half of the aggregate × field-type refusal now names the duration measure instead of a stored "days open" number.
- **`@objectstack/lint`**: `os validate` refuses a duration column not declared `datetime` with the new gating rule `measure-duration-field-type-refused` (at `datasets[N].measures[M].duration.from` / `.to`), with an `os explain` entry. `dataset-field-unknown` now also reports a duration column the object does not declare.
- **`@objectstack/platform-objects`**: the dataset form's new **Duration** row is translated in every shipped locale.
- **`@object-ui/app-shell`**: changing a dataset's base object in the console's dataset inspector now clears a duration measure along with the other measures that name the old object's fields, instead of keeping it as if it were a plain row count.

What to do: nothing. A dataset without `duration` parses, compiles and answers exactly as before.
