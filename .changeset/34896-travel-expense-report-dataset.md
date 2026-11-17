---
'@objectstack/scenarios': patch
---

fix(scenarios): the travel_expense card pins the dataset its report reads, so no build names one after the ambiguous word

Clause-②: no
Metadata-protocol: none

The travel_expense card asks "What is our total travel spend?" on purpose: "travel spend" (「差旅花费」) is a synonym of two measures in two datasets, so the right answer is to ask which one is meant. The build prompt also asked for "a report of travel spend by department and expense type" and pinned no dataset for it, so a build could declare its own dataset named "Travel spend" for that report. An agent that sees such a dataset answers from it instead of asking back, and two builds of the card no longer measure the same question.

The card now declares a third dataset, `claim_lines` on `claim_line` (measure `line_amount`, the sum of `amount`; dimension `expense_type`), and its report sentence names that dataset in both languages and no longer uses the phrase "travel spend". No name, label or synonym of the new dataset equals the ambiguous word, so the question still matches exactly the same two measures. The department grouping is left to the build: a card dimension names a field of the base object, and `claim_line` carries no department field.
