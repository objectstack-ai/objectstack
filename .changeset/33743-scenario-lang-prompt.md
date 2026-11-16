---
'@objectstack/scenarios': patch
---

feat(scenarios): `--lang zh|en` and `--prompt short|detailed` choose the prompts the agent is given

Clause-②: yes (widening) — the CLI flags `--lang zh|en` and `--prompt short|detailed` (the `objectstack-scenarios` bin, `cli.ts`); through `./runner`: the new exports `PROMPT_LANGS`, `PromptLang`, `PROMPT_LENGTHS`, `PromptLength`, `PromptChoice`, `MissingLanguageError`, `promptLanguageGaps`, `promptLanguageRefusal`, `statedPromptChoice` and `promptChoiceText` (`prompts.ts`) and `samePromptChoice` (`driver.ts`); a new optional `choice` parameter on `buildPrompt`, `iteratePrompt`, `templateIteratePrompt`, `questionPrompt`, `operationPrompt` (`prompts.ts`) and `runHalf` (`orchestrate.ts`), and on the `RecordingDriver` constructor (`driver.ts`); the new method `RecordedDriver.assertPromptChoice` (`driver.ts`); the new optional fields `RunOptions.promptChoice`, `CardRun.promptChoice` (`orchestrate.ts`), `Recording.promptChoice` (`driver.ts`) and `CardScorecard.promptChoice` (`scorecard.ts`)
Metadata-protocol: none

Until now every card text reached the agent as `en ?? zh`, so a card with both languages was always given in English, and the build turn was always given `prompt.detailed`: the eval measured only the most favourable input, never the Chinese sentence a customer writes.

`--lang zh|en` renders every card-authored text a prompt carries in that language and no other — the build prompt, the iterate change, and each question's and each operation's ask — in scratch, template and ask modes, at every ask of `--ask-repeats`. The runner's own wrapper text (preamble, data contract, naming rule, answer instructions) stays in English. There is no silent fallback: a card lacking one of the texts the run's modes render in the chosen language is skipped before the first card runs, before any scaffold or boot, with a line naming each missing text, and the other cards run. `--prompt short|detailed` picks the card prompt the build turn is given (default `detailed`); the iterate turn is unchanged.

With either flag the run record states the choice (`promptChoice` on the card's run and on the scorecard) and the scorecard prints `prompts: language zh · build prompt short`. A recording made under a choice carries it, and replaying it (`--driver recorded:F`) under another choice is refused before any card runs, naming the flags to replay it with. With neither flag the prompts, the record, the scorecard and the recording are unchanged byte for byte. The grader already reads a Chinese reply (`来源：` lines, Chinese measure words and declines), so a Chinese turn grades as an English one does; no scoring change.
