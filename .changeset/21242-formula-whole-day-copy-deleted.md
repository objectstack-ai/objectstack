---
"@objectstack/formula": minor
---

fix(formula)!: `matchesFilterCondition` compares a bare-day upper bound as written; its own whole-day copy is deleted (ADR-0053 D-D1 items 5 and 9)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) a change of how one runtime evaluator answers an ordering comparison, not of anything an author writes: no spec key, spelling, export or stored shape moves. FilterConditionSchema, every RLS policy, object and query definition parse and save as before, @objectstack/formula exports the same names with the same types, and no stored row is read or rewritten. What moves is the answer for a bare-day upper bound that reaches the evaluator without the shared lowering, which the seams already apply, so there is nothing for objectstack migrate meta to rewrite. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers a filter's bound semantics and this diff adds none (not registered / already-registered); and the change is runtime behaviour, not a declaration (not runtime-interface-only / type-surface-only). -->

**BREAKING**: this narrows what the RLS write check admits on columns that are not `datetime`, and moves a few `engine.aggregate` answers that no seam lowers. It ships as `minor` under the launch-window convention for accept-set narrowings. No export or published type changes.

**What is deleted.** `matchesFilterCondition` no longer reads a bare `YYYY-MM-DD` `$lte`, or a `$between` maximum, as "through that whole day", and no longer drops the bound on `9999-12-31`. It compares the value as written, as every other ordering operator here does, and as `driver-sql` compares it on the read. The whole day is applied once, at the seams that feed this evaluator, by the shared `lowerFilterCondition` (`@objectstack/spec/data`): the RLS compile seam lowers every policy filter on the object's declared `datetime` columns, the engine lowers `having` and `aggregations[i].filter` the same way, and the RLS write check judges a declared `date`, `datetime` or `time` column in its stored form. So a `check` on a `date` or `datetime` column answers exactly as before.

**The RLS write check now agrees with the read on other columns.** Measured through `ObjectQL.insert` and `SecurityPlugin` on `SqlDriver` (better-sqlite3), as a member whose policy has the same `using` and `check`:

- a `text` column under `record.title <= '2026-01-05'`, written as `'2026-01-05T15:00:00Z'` or `'2026-01-05 noon'`: the write was admitted while the read hid the stored row. It is now refused `PERMISSION_DENIED` / 403, and the read still hides it;
- two `text` columns, `record.title <= record.code`, with `code` holding `'2026-01-05'`: the same, admitted before and 403 now, with the read hiding the row;
- a `number` column under `record.amount <= '9999-12-31'`: the write was admitted because an epoch number read as an instant on the last supported day. A number is not less than a day string, so it is now 403. The engine refuses the same comparison in a `where` (`INVALID_FILTER` / 400: a day string is not a number).

The access explanation (`explain`) judges a stored row with this evaluator, so its row verdict moves the same way: for the two `text` cells it now says hidden, as the read does.

**`engine.aggregate` answers that no seam lowers.** A `{ $field }` referent is per row, so no seam can lower it. These positions are now compared as written:

- two declared `text` columns of one class, at a per-aggregation `filter` or between two `having` group columns: `'2026-01-05 noon'` against `'2026-01-05'` is no longer counted or kept, which is what the same comparison answers in a `where`;
- the pairs the class rule cannot judge because a side has no declaration: an object the registry does not declare, and an audit-opt-out object's row-carried `created_at` / `updated_at` against a `date`. An instant on the due day is no longer counted against that bare day;
- a direct `applyInMemoryAggregation` call, which applies no class rule.

**The remedy.** Compare a `datetime` with a `datetime` and a `date` with a `date`. A `datetime` against a calendar day has no single answer across SQL and memory, and a declared pair of the two is already refused. A number compared with a day string has no answer at all: compare a number with a number. A caller that evaluates a filter on a `datetime` column without passing a seam lowers it first with `lowerFilterCondition(filter, { isDatetimeColumn })` to get the whole-day reading.

**Unchanged.** A `check` on a declared `date`, `datetime` or `time` column, a `{ $field }` pair of two `date` or two `datetime` columns (with or without `addDays`), a full-ISO bound, `$gte` / `$gt` / `$lt` and `$eq`.
