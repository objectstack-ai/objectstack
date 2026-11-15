---
'@objectstack/scenarios': patch
---

fix(scenarios): an unanswerable question declined with an invented figure is no longer graded correct

Clause-②: no
Metadata-protocol: none

The run grader passed an `unanswerable` question on the decline alone, so "A tax rate is not recorded for INV-002, but it is probably 13%" was correct: the hedge plus an invented number is exactly the failure the question exists to measure.

`correct` now needs the decline and no figure the data cannot support: every number the reply states must be one that some tool output of the same turn carries, read the way a coded refusal's echoed status is read (a number with a unit is carried by either reading, `1.2M` by 1.2 or 1,200,000). A decline that shows the rows it checked ("no tax rate field; INV-002 totals 120, lines 4 × 5 = 20 and 1 × 100 = 100") stays correct; one that adds a figure no tool output carries is not correct, with the problem `stated a figure the data cannot support`. A figure with no decline keeps today's problem, `did not say the data cannot answer`. Identifiers and ISO dates are no figures, as before. The `withheld` arm is unchanged.

Accepted cost: an invented figure that happens to equal a number some tool output carries (0, 1 and small counts are common there) is not caught. Measured on the recorded eval runs of 2026-11-14 and 2026-11-15 (round 1 and the three-model comparison on the three control cards): all 12 recorded replies that decline stay correct, 6 of them showing the figures they read; the 6 `project_with_tasks` model-run replies are not measured, as no recording of them exists.
