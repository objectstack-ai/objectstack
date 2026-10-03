---
"@objectstack/service-analytics": minor
---

fix(service-analytics)!: the analytics read scope and the `where` tree compile the shared lowering's bound and NULL guards; their own whole-day and NULL-polarity copies are deleted (ADR-0053 D-D1 items 7 to 9)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) a change of how the native analytics strategy answers an ordering comparison on a column its host declares neither datetime nor date, not of anything an author writes: no spec key, spelling, export or stored shape moves. AnalyticsQuerySchema, CubeSchema, DatasetSchema and every RLS policy parse and save as before, the package index exports the same names with the same types, and no stored row is read or rewritten. What moves is the row set a bare-day upper bound selects on such a column, which now equals the engine's own answer for the same filter, so there is nothing for objectstack migrate meta to rewrite. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers a filter's bound semantics and this diff adds none (not registered / already-registered); and the change is runtime behaviour, not a declaration (not runtime-interface-only / type-surface-only). -->

**BREAKING**: this narrows the rows the native analytics strategy selects for a bare-day upper bound on a column the host declares as neither `datetime` nor `date` — a `text` column, for example. It ships as `minor` under the launch-window convention for answer narrowings. No export, published type, accepted input or error code changes.

**What is deleted.** The native SQL strategy no longer reads a bare `YYYY-MM-DD` `$lte`, a `$between` maximum or an explicit `dateRange` end as "through that whole day" on every column, and no longer drops such a bound on `9999-12-31` whatever the column holds. The whole-day rule is applied once, by the shared `lowerFilterCondition` (`@objectstack/spec/data`), with the column's declared type, the reader the plugin already wires from the engine's registry (`sourceFieldMeta`): a declared `datetime` column keeps the whole day, and every other declared column is compared as written, as the engine compares it. The `/analytics/sql` echo renders the same lowering.

**The native face now agrees with the engine.** Measured through `AnalyticsService.query` (what `POST /api/v1/analytics/query` relays) in the plugin's own composition, on SQLite and on PostgreSQL 16, over a `text` column `note` holding `'2026-07-27'`, `'2026-07-28'`, `'2026-07-28 late'`, `'n'` and no value:

- `{ note: { $lte: '9999-12-31' } }` counted every row with a value (4). It now counts 3, the rows the engine's `find` returns: `'n'` sorts above `'9999-12-31'`.
- `{ note: { $lte: '2026-07-28' } }` counted 3, the `'2026-07-28 late'` row included. It now counts 2.
- `$between ['2026-07-28', '2026-07-28']` and a `dateRange` window of the same day counted 2; they now count 1. Their negation through `$not` gains the row the bound lost.

On a declared `datetime` or `date` column every answer is unchanged, on both strategies.

**A host with no typed reader** (a strategy context with no `declaredFieldType` hook, or an `AnalyticsService` built without `sourceFieldMeta`) reads every column type-blind, as ADR-0053 D-D1 item 7 prescribes for a seam that cannot read declarations: its native answers do not move. Pass `sourceFieldMeta` (the README shows how) to get the engine's answer on a non-temporal column.

**The `/analytics/sql` echo.** A `dateRange` window on a declared `date` column now prints the inclusive `<=` the engine runs, where it printed `<` the next day; on a column the host names no type for, it prints the bound the ObjectQL strategy hands the engine, as written. A preset window that stops before its end (`today`, `this_month`, …) now prints `<` its end instant with that instant bound, where it printed `<=` with no value bound. The NULL guards print once where they printed two or three nested copies of the same guard; every row set is unchanged.

**Unchanged.** Every answer on a declared `datetime` or `date` column, on the native and the ObjectQL strategy; every answer of the ObjectQL strategy; every answer of the read scope; and the draft preview, which keeps its own bound until its typed reader is wired.
