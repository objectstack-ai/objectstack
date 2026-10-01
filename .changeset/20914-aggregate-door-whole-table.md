---
"@objectstack/objectql": minor
"@objectstack/spec": patch
---

fix(objectql)!: the engine's `aggregate` asks the aggregate × field-type table for every aggregation over a declared field, so `min` / `max` / `avg` over a type the table refuses answer `INVALID_FIELD` / 400 on every driver instead of one answer per driver

Clause-②: no (narrowing)

<!-- adr-0087: not-required (already-registered dataset-measure-selecting-aggregate-field-type-refused, dataset-measure-aggregate-field-type-refused) the pairs this change refuses are exactly the pairs AGGREGATE_FIELD_TYPE_COMPATIBILITY already refuses, and the table is not edited: every refused min / max pair is registered under protocol major 18 by the first id and every refused avg pair by the second, each with its routes (count, a sort for a first or last record, or a numeric / temporal field for a quantity stored as text or JSON). This change adds a query-time reader of the same table at the engine door; it refuses a query shape, not a stored one, and no authorable key, export or stored row moves. -->

**BREAKING** (`@objectstack/objectql`): this narrows what `aggregate` accepts, on every driver and for every caller that reaches the engine — the REST query door, a flow or hook, a roll-up summary's recompute, and the analytics strategy that lowers a cube query onto `engine.aggregate`. Shipped as `minor` under the launch-window convention for accept-set narrowings. No export or published type changes.

FROM → TO, per aggregation `{ function, field }` naming a declared field:

- `min` / `max` over a type outside the numeric, temporal and boolean classes — the structured-JSON types (`json`, `composite`, `repeater`, `record`, `location`, `address`, `vector`), the multi-option types (`multiselect`, `checkboxes`, `tags`), the string family (`text`, `email`, `url`, `phone`, …), the option and reference types (`select`, `radio`, `lookup`, `master_detail`, `tree`, `user`), `autonumber`, the file family and `formula` — and over any `select`, `lookup`, `user`, `file` or `image` declared `multiple: true`: FROM whatever the driver answered (a document or an array in memory, the serialized text on SQLite, a 500 on PostgreSQL for a JSON-stored field; a collation-dependent string for a text field) TO `400 INVALID_FIELD`.
- `avg` over a type outside the numeric and boolean classes — a `date`, `datetime` or `time` field included: FROM `null` in memory, a coerced number on SQLite (the average YEAR for a datetime), a 500 on PostgreSQL, TO `400 INVALID_FIELD`.
- `count_distinct` is unchanged: it was already refused over the JSON-stored types, in the same words.

**What an author sees now.** `400 INVALID_FIELD`, naming the position (`aggregations[0].field`), what the function does and the field with its declaration (`takes the max of 'meta', a declared json field — a structured-JSON value`), saying the query was not run, and naming the types the function accepts, read off the table, inside the first 500 characters the REST door keeps. The thrown error carries `field`, `fields` (every offending aggregation), `object` and `param` (`aggregations`).

**Why a refusal.** `AGGREGATE_FIELD_TYPE_COMPATIBILITY` already declares which pairs every backend answers the same way, and the dataset compile and lint legs refuse the rest; the engine door asked only its `count_distinct` row. Measured through `engine.aggregate` over two rows: `max` over a `json` field answered `{ a: 1 }` in memory, the string `'{"b":1}'` on SQLite and 500 `DATABASE_ERROR` on PostgreSQL 16 (`function max(json) does not exist`); a `tags` field and a `multiple: true` select or lookup split the same way; `avg` over a `datetime` answered `null`, `2026` and a 500. One query, three answers.

**What to write instead.** Aggregate a field of a type the function accepts — for `min` / `max`: `number`, `currency`, `percent`, `rating`, `slider`, `progress`, `summary`, `date`, `datetime`, `time`, `boolean` or `toggle`; for `avg`: the same minus the temporal three. A question that was counting in disguise is `count` (or `count_distinct` over a scalar-stored field). A first or last record by a text value is a sort on a list, not an aggregate. A quantity stored as text or JSON belongs in a numeric or temporal field of its own, aggregated there.

**Who is affected.** A caller that asked `min` / `max` / `avg` of such a field on the in-memory driver or SQLite and read the answer as a real one; on PostgreSQL a JSON-stored field was already a 500. Metadata that lowers onto `engine.aggregate` takes the same verdict at run time: a roll-up summary (`summaryOperations`) whose `min` / `max` / `avg` names such a child field records a failed recompute, a grouped list view's server-side header summary is refused, and a chart or metric component's `aggregate` over such a field is refused. No example app and no published stack authors such a pair.

**Not judged yet: `sum`.** The `sum` row of the table is held back at this door: a published stack authors a `sum` column summary over a `formula` field, a pair the table refuses, so that row awaits its own decision. `sum` over any field reaches the driver as before.

**Unchanged.** Every pair the table accepts; `count` over any field, a JSON-stored one included; an aggregation that names no field; an undeclared name or a relationship path, which this door does not judge (the REST door answers an unknown name `INVALID_FIELD` before the engine is reached); a field whose declared type is outside `FieldType`. The structured-JSON `groupBy` entry of this same release lists a structured-JSON field as an aggregated `min` / `max` column as unchanged; this entry is the later word on that shape.

`@objectstack/spec`: the TSDoc of `AGGREGATE_FIELD_TYPE_COMPATIBILITY` and `isAggregateCompatibleWithFieldType` no longer says the engine's `aggregate` door reads only the `count_distinct` row. The table itself is unchanged.
