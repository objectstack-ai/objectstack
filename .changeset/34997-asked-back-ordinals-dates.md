---
'@objectstack/scenarios': patch
---

fix(scenarios): the asked-back "no figure" check no longer reads an option's place or a date as a figure

Clause-②: yes (widening: published @objectstack/scenarios adds `DATASET_GRADER_REVISIONS` on ./score/full, the optional `DatasetGrade.revision`, and the optional per-grader `revision` in `HalfScores` datasets `byGrader` on ./runner; `asked-back:no-figure` now passes replies it used to fail — option places and dates after a time word)
Metadata-protocol: none

An ask-back that numbered its options and then pointed at them (「通常选第 1 个或第 3 个」) failed `asked-back:no-figure` with "the reply states 1, 3, 1, 3", and one that offered a time window "through 2026-11-17" failed with "the reply states 11, 17": the rule that drops a year written after a time word cut the year off the date, and its month and day were then read as figures. An option named by its place (`option 2`, `options 1 or 3`, `the 3rd one`, 「第 1 个」, 「选项 2」) is now no figure, and a date keeps its year, so it is skipped whole as before. A real figure in the same reply (`10,290`, `6 claims`, 「共 6 笔」) still fails the check, and an English place number before any other noun (`the 3rd quarter`) still reads as a figure.

The rule change is recorded: `DATASET_GRADER_REVISIONS` names each dataset grader's rule revision, an `asked-back` grade now carries `revision: 2`, the scorecard's datasets tally carries it per grader, and the `Run · datasets` row reads `asked-back rev 2 k/N`. A round graded before this change shows no revision, so the two are not compared like for like. A replay (`--driver recorded:F`) grades with the current rules.
