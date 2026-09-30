---
"@objectstack/objectql": minor
---

fix(objectql)!: a `groupBy` on a structured-JSON field is refused with `INVALID_FIELD` / 400 at the engine's `aggregate`, on every driver

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) a refusal of a grouping TARGET at the engine's aggregate door: a groupBy entry naming a declared json, composite, repeater, record, location, address or vector field. No authorable key, spelling, export or stored shape moves (the door module is internal; `@objectstack/objectql` exports nothing new and nothing less, and `EngineAggregateOptions` / `QuerySchema.groupBy` keep parsing the entry), and no stored row is read or rewritten. The grouping had no shared meaning to preserve (one merged group on the in-memory driver, one group per serialized document on SQLite, a 500 on PostgreSQL), and which scalar part of the document a caller meant to group on is not something a ledger entry can rewrite. The other categories are closed on facts: the package publishes (not `unpublished`); no ADR-0087 id covers a grouping target (not `registered` / `already-registered`); and the change is runtime behaviour, not a declaration (not `runtime-interface-only` / `type-surface-only`). -->

**BREAKING**: this narrows what `aggregate` accepts as a grouping target. A `groupBy` entry that names a declared field of the structured-JSON class (`json`, `composite`, `repeater`, `record`, `location`, `address`, `vector`) is refused by the engine before any driver is asked. Both entry spellings are judged, the field name and the `{ field }` object, a `dateGranularity` bucket included. It ships as `minor` under the launch-window convention for accept-set narrowings. No export or published type changes.

**What an author sees now.** `400 INVALID_FIELD`, naming the position (`groupBy[0]`, or `groupBy[0].field` for the object form), the field and its declared type, saying the query was not run, and naming the route inside the first 500 characters the REST door keeps: group by a field that stores one scalar value, storing the part of the document you group on in a field of its own. The thrown error carries `field`, `fields`, `object` and `param: 'groupBy'`.

**Why a refusal.** The drivers share no meaning for a JSON document as a group key. Measured through `POST /api/v1/data/:object/query` over three rows with different documents under the grouped field: the in-memory driver answered 200 with one group holding every row, SQLite answered 200 with one group per serialized document, and PostgreSQL answered 500 `DATABASE_ERROR`. A `vector` field split the same three ways, and a date bucket over a `json` field answered one `null` bucket on memory and SQLite and 500 on PostgreSQL. No producer that groups by a structured-JSON field was found (no dataset, cube, view grouping or `groupBy` in the example apps names one), so no meaning is defined for it here.

**Who is affected.** A caller of `engine.aggregate` or of the REST query door that grouped by such a field on the in-memory driver or on SQLite and read the merged or per-serialization groups as real ones. On PostgreSQL the same query was already a 500. The analytics service's aggregate path (a cube query the native-SQL strategy declines, such as a time dimension with a granularity, or any cube query on the in-memory driver) reaches the engine and answers this refusal too.

**Unchanged.** A `groupBy` on any other type (`text`, `number`, a `multiple: true` select, a file field), a structured-JSON field as an AGGREGATED column (`count`, `count_distinct`, `min`, `max`), and an undeclared name, which the REST door answers `INVALID_FIELD` as unknown before the engine is reached.
