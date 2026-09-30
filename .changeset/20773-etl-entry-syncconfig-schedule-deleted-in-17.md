---
'@objectstack/spec': patch
---

fix(spec): two ADR-0087 migration entries state what the tree does — `etl-pipeline-layer-retired` dates the `syncConfig.schedule` deletion to `@objectstack/spec` 17, and `driver-sql-unresolvable-where-column-refused` names the remote `aggregate()` refusals

Clause-②: no

**`etl-pipeline-layer-retired` (protocol 17).** The entry explains that connector-attached
`syncConfig` has no reader outside `packages/spec`, and cites the same measurement that removed
`syncConfig.schedule`. Its `replacement` text said that key was retired "in 18". It was deleted
in `@objectstack/spec` 17 under ADR-0049 (first released in 17.5.0), as the note at the deleted
position in `integration/connector.zod.ts` already says. The sentence now reads "the same
measurement that deleted `syncConfig.schedule` in @objectstack/spec 17 under ADR-0049".

**`driver-sql-unresolvable-where-column-refused` (protocol 18).** The entry named only a `where`
column on `find()` / `findOne()` / `count()` and `INVALID_FILTER` / 400. On the remote face of
`TursoDriver`, the `aggregate()` door answered `[]` for a missing column or a missing table. It
now refuses as the local face does: `INVALID_FILTER` / 400 for a `where` column the table lacks, `INVALID_FIELD` / 400 for a
`groupBy` or aggregation column the table lacks, and `DATABASE_ERROR` / 500 for an object whose
table is absent. The entry's `surface` now names that door and those codes. Its remedy adds
grouping and aggregating, and running schema sync so the object's table exists. Its acceptance
criterion now also covers a report or dashboard that groups by, or aggregates over, a name the
object has no column for.

Text only: no entry id, conversion or matching logic changes, and `os migrate meta` rewrites
exactly what it rewrote before. The generated migration registry, `spec-changes.json` and the
protocol upgrade guide carry the corrected text.
