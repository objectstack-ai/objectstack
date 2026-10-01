---
"@objectstack/service-analytics": minor
---

fix(service-analytics)!: a cube measure whose `sql` is a relationship path (`account.name`) is judged by the aggregate × field-type table, described in `fields[]` and presented on the native-SQL strategy by the declaration on the object the path's last hop reaches, as a measure over the cube's own column already was

Clause-②: no (narrowing)

<!-- adr-0087: not-required (already-registered dataset-measure-selecting-aggregate-field-type-refused, dataset-measure-aggregate-field-type-refused) the pairs this change refuses are exactly the pairs AGGREGATE_FIELD_TYPE_COMPATIBILITY already refuses, and the table is not edited: every refused min / max pair is registered under protocol major 18 by the first id and every refused sum / avg pair by the second, each with its routes. This change makes the cube door read a relationship-path column's declaration on the object the path reaches, where it already read a base-object column's; it refuses a query shape, not a stored one, and no authorable key, export or stored row moves. -->

**BREAKING**: this narrows what `POST /api/v1/analytics/query` and its dry run `POST /api/v1/analytics/sql` accept on the native-SQL strategy, on every driver. It ships as `minor` under the launch-window convention for accept-set narrowings. No export or published type changes.

The column a relationship path names is located by the one hop resolver both strategies join and read it through: the cube's declared join at that path, else the relationship field's declared `reference`.

FROM → TO, for a `measures` entry that resolves to a cube measure over a relationship path (an authored cube measure, or a compiled dataset's measure over an `include`d relationship):

- `min` / `max` / `sum` / `avg` over a related field of a type the table refuses for that aggregate (the string family such as `text`, `select`, `lookup`; the JSON-stored, file and `formula` types; and the rest the table lists): FROM, on the native-SQL strategy, `200` with the related column's own value (a string such as `"zeta"`) under `fields[] { type: 'number' }` on SQLite and PostgreSQL, and for `sum` a plausible `0` on SQLite and `500 DATABASE_ERROR` on PostgreSQL; the ObjectQL strategy refused it as a cross-object measure. TO `400 INVALID_FIELD` on both strategies, before either reads anything — the refusal a base-object column of the same type already got.
- `min` / `max` over a related numeric field on PostgreSQL: FROM the exact-decimal string (`"250.000000000000000000000000000000"`) under `fields[] number`. TO the number `250`.
- `min` / `max` over a related `date`, `datetime` or `time` field: FROM `fields[] { type: 'number' }` beside the instant. TO `fields[] { type: 'time' }`.

**What an author sees now.** `400 INVALID_FIELD`, naming the measure as the request wrote it, the cube, the path, the related object and the type it declares, saying the query was not run, and naming the types the aggregate accepts. The thrown error carries `member`, `param` (`measures`), `cube`, `field` (the path, `account.name`) and `object` (the related object that declares the column).

**What to write instead.** Aggregate a related field of a type the aggregate accepts, or `count` the rows. A first or last related record by a text value is a sort on a list, not an aggregate.

**Who is affected.** A dashboard, report or caller that asked `min` / `max` / `sum` / `avg` of such a related column through the native-SQL strategy and read the answer as a real one. No example app and no shipped cube or dataset authors such a pair. A dataset whose measure aggregates such a related field is now refused when its query runs (`INVALID_FIELD`), where its compile check, which reads the base object's declaration, still lets it through.

**Unchanged.** Every pair the table accepts; a measure over the cube's own column; `count`, and `count_distinct`, which keeps its own door; a related column the host's field metadata cannot describe; an expression `sql` or `*`; a host that wires no `sourceFieldMeta`; and the ObjectQL strategy's refusal of a related-field measure the table accepts (`max` over a related `number`), a capability limit of the engine aggregate — run that query on a native-SQL driver.
