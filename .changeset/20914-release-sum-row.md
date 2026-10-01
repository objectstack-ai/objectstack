---
"@objectstack/objectql": minor
"@objectstack/spec": patch
---

fix(objectql)!: the engine's `aggregate` judges the `sum` row of the aggregate × field-type table too, so `sum` over a type the table refuses answers `INVALID_FIELD` / 400 on every driver instead of `0` in memory and on SQLite and a 500 on PostgreSQL

Clause-②: no (narrowing)

<!-- adr-0087: not-required (already-registered dataset-measure-aggregate-field-type-refused) the pairs this change refuses are exactly the pairs the sum row of AGGREGATE_FIELD_TYPE_COMPATIBILITY already refuses, and the table is not edited: that id's prescription covers sum / avg over every field class the table refuses (widened to them by a later change that registered against it), with its routes (count, an aggregate the type accepts, or a numeric field for a quantity stored otherwise). This change lets the engine door ask the one row it had skipped; it refuses a query shape, not a stored one, and no authorable key, export or stored row moves. -->

**BREAKING** (`@objectstack/objectql`): this narrows what `aggregate` accepts, on every driver and for every caller that reaches the engine — the REST query door, a flow or hook, a roll-up summary's recompute, and the analytics strategy that lowers a cube query onto `engine.aggregate`. Shipped as `minor` under the launch-window convention for accept-set narrowings. No export or published type changes.

This completes the change of this same release that made the engine's `aggregate` ask the table for `min`, `max` and `avg`, and that held the `sum` row back. Its paragraph "Not judged yet: `sum`" is superseded: this entry is the later word, and the door now asks every row of the table.

FROM → TO, per aggregation `{ function: 'sum', field }` naming a declared field:

- `sum` over a type outside `number`, `currency`, `rating`, `slider`, `progress`, `summary`, `boolean` and `toggle` — a `percent` (a rate does not add), the temporal types (`date`, `datetime`, `time`), the string family (`text`, `email`, `url`, `phone`, …), the option and reference types (`select`, `radio`, `lookup`, `master_detail`, `tree`, `user`), `autonumber`, the file family, the structured-JSON types (`json`, `composite`, `repeater`, `record`, `location`, `address`, `vector`), the multi-option types (`multiselect`, `checkboxes`, `tags`) and `formula` — and over any `select`, `radio`, `lookup`, `user`, `file` or `image` declared `multiple: true`: FROM whatever the driver answered TO `400 INVALID_FIELD`. Measured through `engine.aggregate` over two rows: a `json`, `text`, `select` or `tags` field summed to `0` in memory and on SQLite and answered 500 `DATABASE_ERROR` on PostgreSQL 16 (`function sum(json) does not exist`); a `datetime` field summed to `0` in memory, to the years added on SQLite and a 500 on PostgreSQL; a `formula` field summed to `0` in memory and was already refused `400 INVALID_FIELD` by both SQL drivers, which have no column for it; a `percent` field added the rates on all three.

**What an author sees now.** `400 INVALID_FIELD`, naming the position (`aggregations[0].field`), what the function does and the field with its declaration (`sums 'meta', a declared json field — a structured-JSON value`), saying the query was not run, and naming the types `sum` accepts, read off the table, inside the first 500 characters the REST door keeps. The thrown error carries `field`, `fields` (every offending aggregation), `object` and `param` (`aggregations`).

**What to write instead.** Sum a field of a type `sum` accepts: `number`, `currency`, `rating`, `slider`, `progress`, `summary`, `boolean` or `toggle`. A rate stored as a `percent` is averaged (`avg` accepts it), or the quantity it is a rate of is summed. A value computed by a `formula` is stored in a numeric field of its own when it must be summed on the server. A question that was counting in disguise is `count`.

**Who is affected.** A caller that asked `sum` of such a field on the in-memory driver or SQLite and read the `0` as a real total, and a caller that summed a `percent` field on any driver. On PostgreSQL the other measured pairs were already refused (a 500, or a 400 for a `formula`), and on SQLite so was a `formula`. Metadata that lowers onto `engine.aggregate` takes the same verdict at run time: a roll-up summary (`summaryOperations`) whose `sum` names such a child field records a failed recompute, a grouped list view's server-side header summary is refused, and a chart or metric component's `sum` over such a field is refused. No example app authors such a pair. One published stack authors a `sum` list-column summary over a `formula` field; that summary is computed client-side and does not reach `engine.aggregate`.

**Unchanged.** Every pair the table accepts, `sum` over the eight types above included; `count` over any field; an aggregation that names no field; an undeclared name or a relationship path, which this door does not judge (the REST door answers an unknown name `INVALID_FIELD` before the engine is reached); a field whose declared type is outside `FieldType`.

**A correction to the earlier entry of this release.** It listed the multi-capable types declared `multiple: true` as `select`, `lookup`, `user`, `file` or `image`; the list is `select`, `radio`, `lookup`, `user`, `file` and `image` (`MULTI_CAPABLE_TYPES`). A `radio` declared `multiple: true` was refused by `min` / `max` / `avg` there all the same, by its type's own row, and it is refused by `sum` here.

`@objectstack/spec`: the TSDoc of `AGGREGATE_FIELD_TYPE_COMPATIBILITY` and `isAggregateCompatibleWithFieldType` states that the engine's `aggregate` door asks every row of the table, where it said "the other rows" while one was held, and names `radio` among the multi-capable types. The table and the predicate are unchanged.
