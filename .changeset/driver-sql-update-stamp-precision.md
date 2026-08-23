---
"@objectstack/driver-sql": minor
---

fix(driver-sql): stamp `updated_at` at the audit column's own precision on MySQL, so an updated row stops reading as modified BEFORE it was created (#11224)

`createAuditTimestampColumn` builds the audit columns on MySQL as `DATETIME(3)`
defaulted with `now(3)`, and its docblock says why in as many words
("`CURRENT_TIMESTAMP` has to carry matching precision for a `DATETIME(3)`
default", #3942). `updatedAtStamp()` — the value every UPDATE door writes into
that same column — was a bare `knex.fn.now()`, which compiles to an unqualified
`CURRENT_TIMESTAMP` that MySQL truncates to whole seconds. So the column was
created at millisecond precision on purpose and then written at second precision.

Measured on live MySQL 8.0.46, against the exact schema the driver produces:

```
                            created_at                 updated_at              delta
before  CURRENT_TIMESTAMP     2026-08-23 10:22:36.799   2026-08-23 10:22:36.000  -799 ms
after   CURRENT_TIMESTAMP(3)  2026-08-23 10:22:36.799   2026-08-23 10:22:36.802    +3 ms
```

Nothing errors. Three silent consequences, in ascending order of damage:

1. **"Last modified" precedes "created".** Any consumer comparing the two — an
   audit answer, a "modified since creation?" badge, a data-quality check —
   reads a row that WAS modified as if it were not.
2. **A delta / incremental sync SKIPS the row.** A cursor held at millisecond
   precision (`updated_at > cursor`) misses every row whose stamp was truncated
   back below it. Measured: all six rows in the new suite's §2 were invisible to
   their own cursor immediately after being updated. This is the same
   silent-wrong-answer family as #11067 / #11176 / #11223, reached by a fourth
   mechanism.
3. **Two updates in the same second are indistinguishable**, so an
   `order by updated_at` over them is unstable exactly where it matters most.

The fix is the expression #11176 had already derived and measured for the UPSERT
door: `now(3)` on MySQL, unchanged elsewhere. Every UPDATE door reads one helper
(`update`, `updateMany`, `rotatedUpdateById`), so all three move together.

**Postgres and SQLite emit byte-identical SQL to before, and that is a
measurement rather than an assumption.** Postgres' `CURRENT_TIMESTAMP` is
`transaction_timestamp()` at microsecond precision against a `timestamptz`
column; SQLite's stamp is a JS ISO-8601 string that already carries millis.
Neither has anything to truncate. The new suite runs every cell on SQLite AND on
live Postgres AND on live MySQL, and its §5 pins which expression each dialect
gets — so a future "just add `(3)` everywhere" cannot satisfy the ordering
assertions while changing the SQL the other two dialects emit. In the baseline
run against the unfixed driver, the SQLite and Postgres cells were green (7/7
each) and only the MySQL cell was red (6 of 7).

**BREAKING**, narrowly, and the reason this is not a patch: the `protected`
`upsertUpdatedAtStamp()` that shipped in 17.2.0 with #11176 is **removed**. It
existed only to hold the precision-matched form for the upsert door without
changing the SQL every `update()` emits — a split that card made deliberately
because it had not measured the UPDATE door. This one measured it, so the pair
collapses back into the single `updatedAtStamp()`, which now carries the matched
precision for both doors. A subclass of `SqlDriver` that OVERRODE
`upsertUpdatedAtStamp()` would otherwise have kept compiling while silently
ceasing to be called, which is precisely the failure mode a release note has to
name out loud. Such a subclass should override `updatedAtStamp()` instead; the
two in-repo subclasses (`SqliteWasmDriver`, `TursoDriver`) override neither and
are unaffected. Nothing else was removed or renamed, no authored metadata
changes, and no public API moves — under this repo's launch-window convention
(breaking changes ship as `minor` while the stack versions in lockstep) `minor`
is the honest slot.

Stored data is not rewritten. Rows updated before this change keep their
truncated `updated_at`; the ordering invariant holds from the next write onward.

<!-- adr-0087: not-required (no-migration-prescription) A precision fix to the value one builtin audit column is written with, plus the removal of a `protected` driver hook that has no authorable face. No authorable key, export, config field or stored `sys_metadata` shape changes, so there is nothing for `objectstack migrate meta` or the upgrade guide to carry — a subclass that overrode the removed hook moves its override to `updatedAtStamp()`, which is a code edit rather than a metadata migration. -->
