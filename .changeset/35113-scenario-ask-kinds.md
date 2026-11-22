---
'@objectstack/scenarios': patch
---

feat(scenarios): every question of a dataset card names its ask kind, and a round's record counts every kind

Clause-②: yes (widening) — new optional card key `askKind` on `QuestionSchema` and `DatasetQuestionSchema`; new exports `ASK_KINDS`, `AskKind`, `AskKindSchema`, `questionTurnKind`, `checkAskKinds`, `askTurns`, `askKindCounts` and `AskTurn` (package root); `kindTally`, `kindCell` and `KindTally` (`./runner`); new optional fields `QuestionResult.askKind`, `DatasetQuestionResult.askKind` (`./runner`) and `HalfScores.kinds` (`scorecard.ts`, `./runner`)
Metadata-protocol: none

The open dataset cards (`order_to_cash`, `travel_expense`) stated no kind of question for their ordinary questions, so a round could not show which of the ten ask kinds it measured. A question and a dataset question now name one (`askKind`): `count`, `group_sum`, `top_n`, `time_range`, `join`, `owner_latest`, `business_term`, `ambiguous`, `forbidden` or `unanswerable`. A card that names one kind names the kind of every question and dataset question it asks, all or none, so a card that names no kind loads as before; the loader refuses a kind its question's truth or route contradicts (a `top_n` that does not rank, an `owner_latest` that does not group by a person field, a `business_term` that is not a `metric_selected` dataset question, an `unanswerable` the seed answers), at the question's `askKind`. A turn asked as a persona its truth is withheld from is a `forbidden` ask.

The runner stamps each turn's kind on its result (`askKind` on every question and dataset-question result), the scorecard counts the asks kind by kind (`HalfScores.kinds`, new `Run · kinds` and `Iterate · Run · kinds` rows naming all ten kinds), and `summary` sums the row. A card that names no kind, and a record written before turns carried one, show no such row. New exports: `ASK_KINDS`, `AskKind`, `AskKindSchema`, `questionTurnKind`, `checkAskKinds`, `askTurns`, `askKindCounts` and `AskTurn` from the package root; `kindTally`, `kindCell` and `KindTally` from the runner.

The two cards ask every kind at least twice per round, a table in `docs/qa/scenarios/README.md` states the counts, and a test holds it equal to the cards. `order_to_cash` changes only by the added `askKind` keys, and `travel_expense` also by the step-2 approver line of its build prompt (the changeset beside this one), so both cards' sha256 move and ask-round records split at these card hashes.
