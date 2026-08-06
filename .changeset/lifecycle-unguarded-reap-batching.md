---
'@objectstack/objectql': patch
---

fix(objectql): bound every lifecycle reap, not just the guarded ones

`LifecycleService.reap()` issued a single unlimited `delete(..., { multi: true })`
per sweep for any object without a registered reap guard — no limit, no paging.
Batching existed only on the two side paths (`guardedReap` and the Archiver,
both 500 × 20 per sweep), whose comment gives the reason plainly: "bound one
sweep's work, drain the backlog across sweeps". That reason never depended on a
guard being registered.

Steady state was fine — an hourly sweep deletes a small increment. The cost
landed exactly once per table, on the first sweep after `retention` is declared
on a table that already holds history: one DELETE scanning every historical row,
which on SQLite holds the whole database's write lock for its duration and on
Postgres arrives later as autovacuum debt.

Unguarded reaps now run the same batched machinery the guarded ones do — an
object with no guard is simply the empty guard intersection, which confirms
every candidate row — so there is one reap path rather than two parallel ones.
Candidates are read a page at a time and deleted by id, at most 500 × 20 rows
per object per sweep, with the remainder draining on later sweeps. Cutoff and
`retention.onlyWhen` predicates are unchanged; they now select the candidate
read. The sweep report's `deleted` count reflects rows actually deleted this
sweep.

Two consequences worth knowing:

- A reap fires one `afterDelete` hook per reaped row instead of one per object
  per sweep. Every lifecycle-declaring platform object is in the audit writer's
  `SKIP_OBJECTS`, and `sys_file` already reaped per id via its guards, so no
  object in the platform changes its audit output.
- An engine that does not implement `find` cannot page and keeps the previous
  single bulk DELETE, so retention enforcement never silently stops on it. Every
  real engine implements `find`.
