---
"@objectstack/service-analytics": minor
---

fix(service-analytics)!: a grouped dimension or a `count_distinct` measure over a JSON-stored column reached through a relationship path the cube declares no join for is refused with `INVALID_FIELD` / 400 at the analytics door, as the same member over a declared join already was

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) a refusal of a grouping or distinct-count TARGET at the analytics door, extended from a relationship path the cube declares a join for to one it does not: the door now locates the column on the object the one hop resolver names (the declared join, else the relationship field's declared reference), the object both strategies already join and read. No authorable key, spelling, export or stored shape moves (`assertNoStructuredJsonDimension` is internal to the package; `CubeSchema`, `DatasetSchema` and the analytics query body keep parsing every member), and no stored row is read or rewritten. The grouping and the distinct count had no shared meaning to preserve (one group or one distinct value per serialized document on SQLite, a 500 on PostgreSQL), and which scalar part a caller meant is not something a ledger entry can rewrite. The other categories are closed on facts: the package publishes (not `unpublished`); no ADR-0087 id covers an analytics grouping or distinct-count target, and this diff adds none (not `registered` / `already-registered`); and the change is runtime behaviour, not a declaration (not `runtime-interface-only` / `type-surface-only`). -->

**BREAKING**: this narrows what `POST /api/v1/analytics/query` and its dry run `POST /api/v1/analytics/sql` accept, on both strategies and every driver. It ships as `minor` under the launch-window convention for accept-set narrowings. No export or published type changes.

The column of a dotted path is now located by the one hop resolver both strategies join and read it through: the cube's declared join at that path, else the relationship field's declared `reference`, else the relationship's own name for a host that cannot answer. Before, the door read the cube's declared joins alone and stood down on a path the cube declares no join for. This reverses one clause of the earlier entries for this door in the same release, which listed such a path as unchanged.

**Before and after**, measured on a configured cube over an object whose lookup the cube declares no join for — `owner`, declaring `reference` a person object — and a member over that lookup. An ad-hoc query's inferred cube declares no join at all, and a dotted dimension on it (`owner.prefs`) now gets the same refusal:

- A `dimensions` entry, or a `timeDimensions` entry with a `granularity`, over a structured-JSON field (`owner.prefs`, `json`) or a multi-value field (`owner.labels`, `tags`; or a field declared `multiple: true`). Before, on the native-SQL strategy: `200` with one group per serialized value on SQLite and `500 DATABASE_ERROR` on PostgreSQL; the ObjectQL strategy answered `400 INVALID_FIELD` from the engine under its own position (`groupBy[1]`), a name the request never wrote. Now: `400 INVALID_FIELD` from this door on both strategies, before either reads anything.
- A `count_distinct` measure over the same columns. Before, on the native-SQL strategy: `200` with a count of serialized values on SQLite and `500` on PostgreSQL; the ObjectQL strategy refused it as a cross-object measure. Now: the same `400 INVALID_FIELD` from this door.

**What an author sees now.** The refusal the same member over a declared join already got: `400 INVALID_FIELD`, naming the member as the request wrote it, the cube, the path, the object the lookup declares as its target and the column's declared type, saying the query was not run, and naming the route. The thrown error carries `member`, `param` (`dimensions`, `timeDimensions` or `measures`), `cube`, `field` (the path, `owner.prefs`) and `object` (the target object).

**What to write instead.** Group by, or count distinct, a related field that stores one scalar value. For a multi-value field, run a record query on the target object filtered by one member with `$contains`, one query per member.

**Who is affected.** A dashboard, report or caller that grouped or counted distinct such a related column through a lookup the cube declares no join for, on SQLite, and read the serialized values as real groups or a real count. On PostgreSQL the same queries were already a 500. No example app and no shipped cube or dataset authors such a member.

**Unchanged.** Every member over a declared join; a scalar related column (`owner.email`), which is served on both strategies; a related column whose object the host's field metadata does not describe; an expression `sql`; a host that wires no `sourceFieldMeta`; and a dataset dimension over an `include`d relationship, whose join the dataset compiler declares.
