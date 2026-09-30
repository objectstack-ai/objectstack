---
'@objectstack/service-analytics': minor
---

The analytics seams now run the one shared filter lowering (`lowerFilterCondition`, `@objectstack/spec/data`) that ADR-0053 D-D1, as amended, places at every seam that runs the shared comparand doors: after the doors and after filter-token resolution, so each face compiles one lowered condition — the `$between` split, the whole-day upper bound on a bare `YYYY-MM-DD`, the last supported day, and the NULL-polarity guards.

Clause-②: yes

**The read scope (`compileScopedFilterToSql`).** The scope is lowered at the compiler's entry, right after its placeholders resolve. It reads each column's declared type from the `declaredValueShape` option both of its consumers already pass, so the whole-day rule rewrites a declared `datetime` column and nothing else; with no declarations handed in, no column is read as `datetime`. Corrected answers, each now the rows `SqlDriver.find` returns for the same filter:

- a bare-day `$lte` on a declared `datetime` column kept only the rows before that day and dropped the day itself. Rows at 10:00Z on 07-27, 07-28 and 07-29 under `{ signed_at: { $lte: '2026-07-28' } }` answered 07-27 alone; they now answer 07-27 and 07-28, compiled as `< '2026-07-29'`. This is the NativeSQL statement's read scope and the `/analytics/sql` echo's.
- a bare-day `$between` on a declared `datetime` column answered no row for a one-day range, and now answers that day's rows.
- a `{today}` (or any date-macro) upper bound is widened as the day it resolves to.

An RLS `using` bound already reached the read scope lowered by the RLS compile seam, and answers as before. A declared `date` column compiles byte-identical to before.

**The analytics `where` and draft-preview door.** The condition the door admits is lowered before either face reads it. The `where` → tree face (both strategies) reads each member's declared column type through the host's declared-type hook: a bare-day `$lte` on a `datetime` member now reaches the engine as `$lt` the next day, and the `/analytics/sql` echo prints that half-open bound — the statement the engine runs, where it used to print `<=` the named day. Rows are unchanged on every strategy. A nested-relation filter (`{ account: { region: 'NA' } }`) is spelled as the dotted member it has always compiled to before the lowering reads it, so a guard it adds under `$not` names that member.

The draft preview (`queryDataset` with `previewDrafts`) now evaluates `$null` — the one operator the lowering emits that it did not — so a drafted chart filtered on `{ field: { $null: true } }` is answered instead of refused `INVALID_FILTER` / 400; `$exists` and `$empty` stay refused. Corrected answers: a row with no value now satisfies `$ne`, `$nin` and the negation of an equality even when the comparand is the text `"null"` or `"undefined"`, which this face used to compare as text against the missing value — the answer every data driver gives. Its bare-day bounds answer as before.

Compiled SQL for `$ne`, `$nin`, `$notContains` and a `$not` operand now carries the lowering's NULL guard around each face's own copy of it: the same rows, a longer statement, until those copies are deleted.
