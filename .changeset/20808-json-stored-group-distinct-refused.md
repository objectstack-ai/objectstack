---
"@objectstack/objectql": minor
"@objectstack/spec": minor
"@objectstack/lint": patch
"@objectstack/service-analytics": patch
---

fix(objectql,spec)!: a `groupBy` on a multi-value field and a `count_distinct` on a JSON-stored field are refused with `INVALID_FIELD` / 400 at the engine's `aggregate`, on every driver, and the aggregate × field-type table stops accepting `count_distinct` over the JSON-stored types

Clause-②: no (narrowing)

<!-- adr-0087: not-required (already-registered dataset-measure-aggregate-field-type-refused) the one metadata-facing half of this change is a row of AGGREGATE_FIELD_TYPE_COMPATIBILITY narrowing, and that family's hand-migration is already registered under protocol major 18 by this id: "an aggregate the field's type accepts, per AGGREGATE_FIELD_TYPE_COMPATIBILITY", with every refused pair of the table refused at the compile door. The non-temporal sum / avg narrowing rode the same id the same way; this diff amends that entry's surface and acceptance prose to name the count_distinct rider, and corrects the min / max entry's route that called count_distinct valid over every type. The engine-door halves refuse a query shape, not a stored one: no authorable key, export or stored row moves. -->

**BREAKING** (`@objectstack/objectql`): this narrows what `aggregate` accepts, in two positions, on every driver and for every caller that reaches the engine (the REST query door, a flow or hook, and the analytics strategy that lowers a cube query onto `engine.aggregate`). Shipped as `minor` under the launch-window convention for accept-set narrowings. No export or published type changes.

- A `groupBy` entry that names a **multi-value** field: an inherently-multi option type (`multiselect`, `checkboxes`, `tags`), or a `select`, `lookup`, `user`, `file` or `image` field declared `multiple: true`. Both entry spellings are judged, the field name and the `{ field }` object.
- A `count_distinct` aggregation over a **JSON-stored** field: a structured-JSON type (`json`, `composite`, `repeater`, `record`, `location`, `address`, `vector`), an inherently-multi option type, or a multi-capable field declared `multiple: true`.

**BREAKING** (`@objectstack/spec`): `AGGREGATE_FIELD_TYPE_COMPATIBILITY.count_distinct` no longer lists the ten JSON-stored types (the structured-JSON seven and `multiselect`, `checkboxes`, `tags`), so `isAggregateCompatibleWithFieldType('count_distinct', type)` answers `false` for them. Every reader of the table refuses those pairs now: the dataset-measure lint rule (`measure-aggregate-field-type-refused`, run by `os validate` and at a runtime dataset save), the analytics dataset compile leg (`400 DATASET_INVALID`), and the engine door above. The `count` row is unchanged.

**What an author sees now.** `400 INVALID_FIELD`, naming the position (`groupBy[0]`, `groupBy[0].field`, or `aggregations[0].field`), the field and its declaration, saying the query was not run, and naming the route inside the first 500 characters the REST door keeps. For a multi-value field the route is to filter by one member: `where` with `$contains` on the field, one query per member. For a structured-JSON field it is to store the part you count in a field of its own, or to count rows with `count`. The thrown error carries `field`, `fields`, `object` and `param` (`groupBy` or `aggregations`).

**Why a refusal.** Every SQL driver stores these values in a JSON column, and the drivers share no meaning for one as a group key or a distinct key. Measured through `POST /api/v1/data/:object/query` over three rows: grouping by any of the eight multi-value declarations answered one group per array on the in-memory driver, one group per serialized array on SQLite, and 500 `DATABASE_ERROR` on PostgreSQL 16. `count_distinct` over any structured-JSON or multi-value field answered 3 on the in-memory driver (equal values counted apart), 2 on SQLite (serialized text compared), and 500 on PostgreSQL (no equality operator for `json`). No example app and no published stack groups by a multi-value field or counts one distinct, so no meaning is defined for either here.

**What to write instead.** A dataset measure or a query that counted a JSON-stored field distinct: use `count` over it, or store the scalar part you meant to count in a field of its own and `count_distinct` that field. A grouping by a multi-value field: filter by each member with `$contains` and count.

**Who is affected.** A caller that grouped by a multi-value field, or counted a JSON-stored field distinct, on the in-memory driver or on SQLite and read the answer as a real one; on PostgreSQL both were already a 500. A dataset whose measure pairs `count_distinct` with a JSON-stored field is refused by the lint rule and the compile leg.

**Unchanged.** (Two shapes the structured-JSON `groupBy` entry of this same release lists as unchanged are narrowed here: a `multiple: true` select as a group key, and `count_distinct` over a structured-JSON field. This entry is the later word on both.) A `groupBy` or `count_distinct` on a scalar-stored field, a single-value `select` or `lookup` included; `count` over any field; the `having`, filter and sort positions; and an undeclared name, which the REST door answers `INVALID_FIELD` as unknown before the engine is reached.

`@objectstack/lint`: the dataset-measure refusal's hint no longer says `count_distinct` accepts every type.

`@objectstack/service-analytics`: the dataset compile leg's refusal of a `count_distinct` measure over a JSON-stored field says why it diverges (the drivers compare the values for equality three ways) and prescribes `count`, or a scalar field for the part being counted; its other refusals no longer say `count_distinct` accepts every type.
