---
'@objectstack/scenarios': patch
---

feat(scenarios): `--effort` (and `--author-effort` / `--ask-effort`) reaches `claude --effort`, and every turn records the effort it asked for

Clause-②: yes (widening) — new CLI flags `--effort`, `--author-effort` and `--ask-effort` on `objectstack-scenarios run` / `run-scenarios`; new exports `CLAUDE_EFFORT_ENV` and `effortLevelsFromHelp` (`./runner`); new optional fields `ClaudeCodeDriverOptions.effort` / `authorEffort` / `askEffort`, `ExternalDriverOptions.effort` / `authorEffort` / `askEffort`, `DriverInfo.authorEffort` / `askEffort`, `ExternalLimits.effort`, `TurnProcess.requestedEffort`, `TurnSummary.requestedEffort` and `HalfScores.build.author.requestedEffort`, and the field `ModelTally.requestedEfforts` (all `./runner`)
Metadata-protocol: none

Until now the runner passed no effort, so every turn ran at the CLI's default and neither the run record nor the scorecard could say which effort produced a score.

`--effort LEVEL` passes `claude --effort LEVEL` on every live turn; `--author-effort` and `--ask-effort` set the authoring turns and the question and operation turns apart, each in place of `--effort`, as the model flags do. The levels are the CLI's own, read off its `--help` when an effort is asked for (Claude Code 2.1.325: `low`, `medium`, `high`, `xhigh`, `max`); a level the CLI does not list is refused before any card runs, because the CLI itself only warns about an unknown level and runs the turn at its default effort.

`CLAUDE_CODE_EFFORT_LEVEL`, which the CLI lets win over `--effort`, no longer reaches a turn: with no effort flag, the runner passes its level as `--effort` (`auto` and `unset` still mean the default), so the record names the effort that ran.

Every turn records the effort it asked for (`requestedEffort`); the CLI reports no served effort. The scorecard shows the effort beside the served model on the author rows and the `Run · model` rows, and the record's driver states `authorEffort` and `askEffort`. `--driver external:` passes the level to the command as `limits.effort`; `--driver codex` and `--driver recorded:` refuse the three flags (`codex exec` has no effort flag; a replay re-reads each turn as it was recorded).
