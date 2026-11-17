---
'@objectstack/scenarios': patch
---

feat(scenarios): an opt-in skills directory for ask turns, and dataset questions on two open cards

Clause-②: no
Metadata-protocol: none

- **`--ask-skills DIR`** (live `claude` driver only, off by default) places one skill directory, or a directory of them, at `.claude/skills/NAME/` in every question and operation turn's working directory and allows the `Skill` tool beside `mcp__app`. Authoring turns never see them. The record's driver states which skills the turns had: per skill its name, the sha256 of its files, and the front-matter `version` when it has one. `summary` refuses to sum runs with different skills. Off, the turn's arguments and the record are unchanged.
- **Dataset questions.** A card may declare `expect.datasets` (measures with synonyms and descriptions) and `run.datasetQuestions` of three kinds: `metric_selected`, `asked_back` (ambiguous or near-miss) and `fallback_labelled`. The loader holds each word to what the datasets declare, and checks each dataset with the platform's `DatasetSchema`. The Build half checks the datasets. The Run half asks the questions and grades the route each answer took (`metric-selected`, `asked-back`, `fallback-labelled`) on a new `Run · datasets` scorecard row.
- `order_to_cash` and `travel_expense` carry datasets and five dataset questions each.
