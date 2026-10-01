---
"@objectstack/service-analytics": minor
---

fix(service-analytics)!: the cube door asks the aggregate × field-type table for every measure, so a configured or suffix-inferred cube measure whose aggregate the table refuses for its column's declared type answers `INVALID_FIELD` / 400 on every driver and both strategies, and a `min` / `max` over a temporal column is described `time` in `fields[]`

Clause-②: no (narrowing)

<!-- adr-0087: not-required (already-registered dataset-measure-selecting-aggregate-field-type-refused, dataset-measure-aggregate-field-type-refused) the pairs this change refuses are exactly the pairs AGGREGATE_FIELD_TYPE_COMPATIBILITY already refuses, and the table is not edited: every refused min / max pair is registered under protocol major 18 by the first id and every refused sum / avg pair by the second, each with its routes (count, a sort for a first or last record, or a numeric / temporal field for a quantity stored as text). This change adds a query-time reader of the same table at the analytics cube door; it refuses a query shape, not a stored one, and no authorable key, export or stored row moves: CubeSchema and the analytics query body keep parsing every member. -->

**BREAKING**: this narrows what `POST /api/v1/analytics/query` and its dry run `POST /api/v1/analytics/sql` accept, on every driver and on both strategies. It ships as `minor` under the launch-window convention for accept-set narrowings. No export or published type changes.

FROM → TO, for a `measures` entry that resolves to a cube measure over a column of the cube's own object (an authored cube measure, or a suffix-inferred one such as `note_max`):

- `min` / `max` over a type outside the numeric, temporal and boolean classes (the string family such as `text`, `email` and `url`; `select`, `radio`, `lookup`, `user`; `autonumber`; the JSON-stored, file and `formula` types): FROM, on the native-SQL strategy, `200` with the column's own value (a string such as `"y"`) under `fields[] { type: 'number' }`, on SQLite and PostgreSQL alike; on the ObjectQL strategy the engine's door already answered `400 INVALID_FIELD` after the strategy began. TO `400 INVALID_FIELD` before either strategy reads anything.
- `sum` / `avg` over a type outside the numeric and boolean classes (`sum` also refuses `percent`): FROM `200` with a plausible `0` on SQLite and `500 DATABASE_ERROR` on PostgreSQL (the ObjectQL strategy refused `avg` at the engine and passed `sum` to the driver, which answered the same `0` / `500`). TO `400 INVALID_FIELD`.
- `min` / `max` over a `date`, `datetime` or `time` column: FROM `fields[] { type: 'number' }` beside the instant. TO `fields[] { type: 'time' }`, the `DimensionType` word a temporal dimension column already carries, by the same rule the dataset door applies (`measureResultType`).

**What an author sees now.** `400 INVALID_FIELD`, naming the measure as the request wrote it, the cube, the column, the object and its declared type, saying the query was not run, and naming the types the aggregate accepts, read off `AGGREGATE_FIELD_TYPE_COMPATIBILITY`. The thrown error carries `member`, `param` (`measures`), `cube`, `field` and `object`.

**Why a refusal.** The dataset door (`POST /api/v1/analytics/dataset/query`) refuses every one of these pairs at compile by the same table (`DATASET_INVALID`), and the engine's aggregate door refuses most of them on the ObjectQL strategy; the native-SQL strategy compiled its own statement and asked nothing. Measured through the real dispatcher route on SQLite and PostgreSQL 16: a configured cube's `max` over a `text` column answered `"y"` under a column described `number` on the native strategy and `400` on the ObjectQL strategy, and `sum` over the same column answered `0` on SQLite and `500` on PostgreSQL. One cube, one query, an answer chosen by the driver.

**What to write instead.** Aggregate a field of a type the aggregate accepts. A question that was counting in disguise is `count` (or `count_distinct` over a scalar-stored field). A first or last record by a text value is a sort on a list, not an aggregate. A quantity stored as text belongs in a numeric field of its own, aggregated there.

**Who is affected.** A dashboard, report or caller that asked `min` / `max` / `sum` / `avg` of such a column through `/analytics/query` on the native-SQL strategy and read the answer as a real one. No example app and no shipped cube authors such a pair. A reader that branched on `fields[].type === 'number'` for a temporal `min` / `max` column now sees `time`.

**Unchanged.** Every pair the table accepts, a `max` over a `boolean` column included (its column keeps `number`: the rule declines the boolean class); `count` over any column; `count_distinct`, which keeps its own door and words; a measure over a relationship path (`account.name`), which this door does not judge; a column the host's field metadata cannot resolve, or a type outside `FieldType`; a measure whose `sql` is `*`; an expression metric type (`number` / `string` / `boolean`); and a host that wires no `sourceFieldMeta`, where the declaration cannot be read. The dataset door keeps its own `DATASET_INVALID` answer at compile.
