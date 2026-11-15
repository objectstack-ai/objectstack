---
'@objectstack/scenarios': patch
---

feat(scenarios): `--ask-repeats N` asks each question turn N times, and the scorecard states k/N per turn

Clause-②: yes (widening) — new CLI flag `--ask-repeats N` on `objectstack-scenarios run` / `run-scenarios`; new export `repeatTally` and type `QuestionRepeats` (`scorecard.ts`); new optional fields `StepRef.repeat` (`driver.ts`), `RunOptions.askRepeats`, `QuestionResult.repeat` and `CardRun.askRepeats` (`orchestrate.ts`), `HalfScores.repeats` and `CardScorecard.askRepeats` (`scorecard.ts`); new methods `RecordedDriver.heldAsks` and `RecordedDriver.assertAskRepeats` (`driver.ts`); a new optional seventh parameter `askRepeats` on `runHalf` (`orchestrate.ts`); all reached through `./runner`
Metadata-protocol: none

Until now the runner asked each (question, persona) turn once, so a question's grade was one sample of a non-deterministic agent: a model comparison whose 问数 cells differ by one or two questions could not tell a real difference from chance.

`--ask-repeats N` (default 1) asks each (question, persona) turn N times on the same booted app, in a row, each ask a fresh agent session, and grades each ask on its own; the run record keeps every ask (`repeat` on each question result, `askRepeats` on the card's run). Every question is asked before any operation writes, so each ask reads the same rows. Operations are not repeated: they write, and a second run would act on the rows the first one changed. A turn the seed takes out is not measured at every ask alike.

The `Run-问数` cell counts passes over every asked turn, the heading says how many times each turn was asked, and a table after the halves states each turn's k/N per Run half. The `Run · model`, `Ask cost` and `Ask time` rows and the `injection_as_data` guardrail count each ask as a turn. With N = 1 the record and the scorecard are as before.

The first ask keeps the replay key a single ask has; asks 2..N add a `repeat-N` segment, so a recording made without repeats still replays. `--ask-repeats` is not a live-only flag: with `--driver recorded:F` it decides how many recorded asks of each question turn are read, and an N larger than the recording holds of any question turn is refused before any card runs, naming the turn and the count found. The gallery exporter joins each ask to the reply recorded under its own key.
