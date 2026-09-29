---
'@objectstack/driver-sql': minor
'@objectstack/driver-turso': minor
'@objectstack/driver-memory': minor
'@objectstack/driver-mongodb': minor
'@objectstack/formula': minor
'@objectstack/objectql': minor
'@objectstack/spec': minor
---

feat(drivers,formula,objectql): the engine's filter faces answer the staged `$empty` operator (#20444)

Clause-②: yes (widening)

`$empty: true | false` is declared by `@objectstack/spec` (`FieldOperatorsSchema`) with a per-type meaning: a text-like field is empty when it is null or `''`, a multi-value field (multiselect, checkboxes, tags, or a select / radio / lookup / user / file / image with `multiple: true`) when it is null or `[]`, and every other type only when it is null. `$empty: false` is the exact complement. Until now every face in this list refused it (`INVALID_FILTER` / 400), except `matchesFilterCondition`, which answered `false` for every record. **A driver or evaluator called directly now answers it:**

- **By the field's declared type**, through the spec's one expansion (`expandEmptyOperator`): `driver-sql`'s filter compiler (and so `driver-sqlite-wasm` and `driver-turso`'s local transport, which inherit it), `driver-turso`'s remote transport, `driver-memory`'s query path (`find` / `count` / `update` / `delete`) and `driver-mongodb`'s `translateFilter` (its `find`, its aggregate `$match`). The declaration is the one each driver already receives — `initObjects` / `registerObjectMetadata` / `registerExternalObject` on the SQL family, `syncSchema` on the others. On SQL a multi-value field's empty list is tested as stored JSON per dialect (SQLite `json_array_length` behind a `json_valid` guard, PostgreSQL a `jsonb` comparison, MySQL `JSON_LENGTH`), never as an equality comparand.
- **By value** — null, a missing value, `''` and `[]` are empty (`isEmptyFilterValue`) — on the faces that read no field declaration: `@objectstack/formula`'s `matchesFilterCondition` (the RLS write-side `check`), `driver-memory`'s reference matcher, and `@objectstack/objectql`'s `having` and per-aggregation `filter`. In `having`, a `count` or `sum` holding `0` is not empty.

**Refused, never guessed** (`INVALID_FILTER` / 400): `$empty` on a field whose declaration the driver does not hold (a table built outside its registration, a builtin column such as `id`, a field with no `type`, or `translateFilter` / `RemoteTransport` used standalone without a declaration), a multi-value field on a SQL dialect the driver does not model, and a flag that is not a boolean. `driver-memory`'s analytics (cube) face refuses `$empty` as an operator it cannot compile, as it does `$null`.

New optional API: `translateFilter(where, temporalKind?, valueShape?)` in `@objectstack/driver-mongodb` takes a declared-value-shape resolver (type `ValueShapeResolver`), and `buildAggregationPipeline` a `valueShape` option; `RemoteTransport.setDeclaredValueShapeResolver` in `@objectstack/driver-turso`, which `TursoDriver` wires. `@objectstack/spec`'s shared `FILTER_LOGIC_CASES` table gains seven `$empty` cases: a backend that runs it answers `$empty` or goes red, and its harness must declare the fixture's columns.

`$empty` stays staged: it is not in `FILTER_OPERATORS`, so the engine's front door still refuses it until the flip card adds it, and the view operators `is_empty` / `is_not_empty` still lower to `$null`.
