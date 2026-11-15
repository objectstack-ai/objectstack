---
'@objectstack/scenarios': patch
---

feat(scenarios): the scorecard sums the ask side's cost and time per served model, and the authoring turns' time

Clause-②: yes (widening) — new exports `TurnCost`, `TurnTime`, `ModelSpend`, `AskSpend`, `turnCost`, `turnTime`, `askSpend`, `authorTimeText`, `askCostText` and `askTimeText` (`scorecard.ts`, `./runner`), with `AuthorCost` now an alias of `TurnCost` (same shape); new optional fields `ModeScorecard.authorTime` / `askSpend` and `CardScorecard.authorTime` / `askSpend` (`scorecard.ts`), `TurnSummary.reportedDurationMs` / `reportedApiDurationMs` (`orchestrate.ts`) and `ParsedTurn.meta.reportedDurationMs` / `reportedApiDurationMs` (`transcript.ts`), all reached through `./runner`
Metadata-protocol: none

Until now the scorecard summed cost for the authoring turns only and stated no time beside it, so comparing ask models by score per dollar or per minute had nothing to read: every question and operation turn kept its cost and elapsed time in the record, but no row summed them.

The scorecard adds `Author time`, `Ask cost` and `Ask time` rows (each mode) and `author time`, `ask cost` and `ask time` lines (the card). The ask figures cover every question and operation turn that ran, the Run half's and the iterate's, grouped by the model each turn was served (`claude-haiku-5-5: $0.31 over 28 ask turns`). Cost follows the author-cost rule: a model's cost is stated only when every one of its turns reported one, never reading a missing cost as zero. Time is the runner's own clock (`elapsedMs`, the driver's process from spawn to exit, already recorded for `claude`, `codex` and `external:` turns), stated only when every counted turn was timed; otherwise the cell says how many turns were not timed (`2 of 28 ask turns not timed`), never a smaller sum. A replayed turn re-reads the recorded run's time, and a turn recorded before the runner kept a process is not timed, never zero. A scorecard written before these rows reads `not recorded` in them.

Each turn also records the duration the `claude` CLI states on its result line (`reportedDurationMs` from `duration_ms`, `reportedApiDurationMs` from `duration_api_ms`), beside the runner's clock; the rows sum the runner's clock only.
