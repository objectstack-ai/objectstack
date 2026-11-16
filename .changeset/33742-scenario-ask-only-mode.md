---
'@objectstack/scenarios': patch
---

feat(scenarios): `--modes ask` runs only the questions and operations on a supplied verified build, so ask models compare on the same app

Clause-②: yes (widening) — the `--modes` value `ask` (`cli.ts`); the mode unions widened to `'scratch' | 'template' | 'ask'` on `RunOptions.modes`, `ModeRun.mode`, `modeDir`'s `mode` (`orchestrate.ts`), `StepRef.mode` (`driver.ts`, so the external driver contract's `step.mode` may now be `ask`), `ModeScorecard.mode` (`scorecard.ts`) and `CliArgs.modes` (`cli.ts`); the new export `askModeRefusal` (`orchestrate.ts`) and the new optional field `ModeScorecard.supplied` (`scorecard.ts`), all reached through `./runner`; on `./export`, the run-record reader's `mode` now accepts `ask`, the new export `ASK_MODE_NOT_EXPORTED` (`pass.ts`) and the new optional field `Transcript.notShown` (`transcript.ts`)
Metadata-protocol: none

Until now every mode authored: scratch builds the app and template mode authors an iterate before its only Run half, so two ask models were always graded on two different builds, and a difference in 问数 could be the build's rather than the model's.

`--modes ask` installs a verified build into a blank host of its own, the same build template mode installs and by the same unmanaged install (`--template F`, else this run's scratch build when it passed), seeds it, and runs the Run half alone: every question (`--ask-repeats` honoured) and every operation. The driver is never asked to author; there is no build score and no iterate. Its turns key as `card/ask/run/<step>/<persona>`, and `--driver recorded:F` replays them. On the same build and the same turns its grades equal scratch mode's first Run half. `ask` without `--template` and without `scratch` in the same run is refused before any card runs; relying on a scratch build that did not pass, it is skipped with the reason, as template mode is.

The record names the build's source on the mode (`template.source`); its Build row is `not-run` with the note `supplied (…): not scored`, its iterate rows `not run: ask mode authors no iterate`. The scorecard's `ask` column reads `supplied` in its Build cells and `no authoring turns` in its author rows (and the card's author lines too when ask is the only mode that ran), with a line naming the build's source; every Run row reads as for any Run half. The gallery exporter reads a record holding an ask mode and passes over it: the mode is not judged, its turns are not shown, and the transcript states why. The default modes (`scratch`, `template`) and their records, scorecards and exports are unchanged byte for byte.
