---
"@objectstack/objectql": minor
---

fix(objectql)!: `having` and the per-aggregation `filter` refuse a plain `{ $field }` reference between two columns of different comparison classes with `INVALID_FILTER` / 400, as `where` refuses it

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) a refusal of filter STRUCTURE at the engine's query door: a plain { $field } comparand whose two columns belong to different comparison classes, at having and at a per-aggregation filter. No authorable key, spelling, export or stored shape moves: FieldReferenceSchema, every query shape and every object definition parse as before, @objectstack/objectql exports nothing new and nothing less, and no stored row is read or rewritten. What is refused is a comparison the same query's where already refuses on driver-sql, and which same-class column the caller meant is not something a ledger entry can decide. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers a filter's comparison class (not registered / already-registered); and the change is runtime behaviour, not a declaration (not runtime-interface-only / type-surface-only). -->

**BREAKING**: this narrows what a `{ $field }` reference may pair at two positions of `engine.aggregate`. It ships as `minor` under the launch-window convention for accept-set narrowings. No export or published type changes.

**What was accepted before.** At `having` and at a per-aggregation `filter` (`aggregations[i].filter`), the comparison-class rule was applied only to a reference carrying `addDays`. A plain reference across two classes was answered: `{ closed_at: { $lte: { $field: 'due_on' } } }`, with `closed_at` a `datetime` and `due_on` a `date`, counted rows by `@objectstack/formula`'s whole-day reading of the bare day, and a `having` of `max(closed_at)` against a `day` date bucket kept groups the same way. The same comparison in a `where` is refused `INVALID_FILTER` / 400 by `driver-sql`.

**What is refused now.** A scalar comparison (`$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`) whose comparand is a plain `{ $field }` naming a column of a different comparison class. The classes are the spec's `CROSS_FIELD_COMPARISON_CLASSES` (`numeric`, `text`, `boolean`, `date`, `datetime`, `time`), judged by the spec's `crossFieldComparisonVerdict`, the classification `driver-sql`'s `where` compiler reads. The refusal is `INVALID_FILTER` / 400, raised before any driver is asked for a row, on an empty set as on a populated one, through `engine.aggregate` and `POST /api/v1/data/:object/query`:

- in a per-aggregation `filter`, the fields, the operator and the reason are withheld from the message and written to the server log, as `where` withholds them; the message now names the same-class rule beside the `addDays` one;
- in `having`, the message names the two columns of the query's own projection and their classes, in the sentence `where` logs for the same pair. A `having` column's class is read off the query: a `day` date bucket is a `date`, a coarser bucket a `text` label, `count` / `count_distinct` / `sum` / `avg` are `numeric`, and `min` / `max` take the type of the field they read.

**The remedy.** Compare same-class columns: a `datetime` with a `datetime`, a `date` with a `date` (a `day` bucket is one), a number with a number. A comparison between a `datetime` and a calendar day has no single answer across SQL and memory, so the platform does not define one.

**Unchanged.** A reference between two columns of one class answers as before. A `{ $field, addDays }` pair keeps its judgement and its words. A column whose class the declaration cannot tell is not judged, as an `addDays` pair is not: a host with no registered object, a column the field map does not list (`id`), an aggregation over an undeclared field. A column the spec gives no comparison class at all (a structured-JSON, multi-valued or file field, a formula) is not judged by this rule either.
