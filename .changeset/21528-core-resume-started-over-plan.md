---
'@objectstack/core': patch
---

fix(core): a resumed migration run is compared against the chunk plan it started over, so `os migrate resume` completes an interrupted `recorded-by` run that had committed a chunk or was started with a non-default `--chunk-size` (#21528)

Clause-②: no

`runMigrationJournal` recomputed a resumed run's chunk plan from the rows `load()` returned at resume time, at the plan's current chunk size, and refused `PLAN_CHANGED` when that plan's hash differed from the one `run_started` recorded. Two kinds of interrupted run could differ. A plan whose `load()` selects only the work still to do, which `recorded-by`'s plan does, returns fewer rows once a chunk has committed. And the plan handed back for a resume carries its own chunk size, not the one the run was started with. So `os migrate resume` listed such a run as `resumable: true`, and `os migrate resume --run <id> --yes` then refused it.

A resume now reads the chunk plan back from the journal's `run_started` record:

- **Identity.** The plan's id and step names are hashed with the recorded chunk boundaries and compared with the recorded hash. A plan whose id or steps changed is still refused `PLAN_CHANGED`. The run resumes at the chunk size it started with.
- **Rows.** Each step's rows are bound to that chunk plan. If `load()` returns every row the run started over, each chunk's rows are where the journal put them, as before. If it returns exactly the rows of the chunks not yet committed, those rows go, in order, to those chunks. Any other row count is refused `PLAN_CHANGED`, and the message names the step.
- **Unwind.** If a chunk fails after a resume that bound its rows the second way, the runner compensates the chunks this process committed, newest first. It then stops at the newest chunk an earlier process committed and journals `run_failed`, because `load()` no longer returns that chunk's rows. It does not compensate other rows in their place, and the run ends `failed`.
