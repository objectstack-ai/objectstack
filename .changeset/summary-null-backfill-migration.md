---
"@objectstack/objectql": patch
"@objectstack/cli": patch
---

feat(objectql,cli): `os migrate summary-nulls` backfills roll-up count/sum columns left NULL by pre-seed inserts (#6063)

#5749 / PR #6013 fixed the **producer**: a parent row created from that release
on has its `count` / `sum` roll-up columns seeded to the empty-set value at
insert, so `filter ["task_count", "=", 0]`, sorting, `GROUP BY` and formulas
over the column stop silently dropping parents that never had a child.

Being a create-time fix, it reaches **new rows only**. A database upgraded **in
place** still holds parents stored before the upgrade, and the recompute that
would otherwise correct them runs only when one of their **children** is
written — so those rows keep their `NULL` indefinitely and keep disappearing
from the same queries. A freshly seeded deployment is correct; an upgraded one
is not. This release ships the other half: a one-off, explicit data migration.

```bash
os migrate summary-nulls                    # dry run: full report, writes nothing
os migrate summary-nulls --apply            # recompute and write (prompts)
os migrate summary-nulls --apply --yes --json   # CI / scripts
os migrate summary-nulls --object project   # restrict to one object (repeatable)
```

**Every NULL row is recomputed, never blanket-set to 0.** A pre-upgrade parent
that *does* have children is `NULL` too — nothing ever recomputed it — and its
correct value is the real aggregate. `UPDATE ... SET col = 0 WHERE col IS NULL`
would replace a visibly-missing value with a confidently-wrong one, which the
next child write would then silently change back. The run computes each value
through the same code path the engine's own child-write recompute uses
(`aggregateSummaryValue`), over the descriptors the engine itself maintains, so
a backfilled column and a recomputed one can never mean different things.

**`min` / `max` / `avg` are never touched.** They are undefined on an empty set
— which is why the insert-time seed leaves them `null` — so a stored `null`
there is the correct reading of "no child rows", not a defect. The report names
them as deliberately skipped rather than omitting them silently.

Other properties: dry run by default and a dry run writes nothing at all;
idempotent, so re-running is safe and a clean report is the operator's own
verification; driver-agnostic (it reads values and tests them in JS rather than
pushing a null predicate down, since null-predicate compilation is precisely
where drivers diverge); one row's failure is recorded and the run carries on.
It records no deployment flag — unlike its `os migrate` siblings, nothing is
gated on it having run.

Never running it is safe in the sense that nothing breaks *further*: the
affected rows simply stay missing from `= 0` filters until a child of theirs is
written.
