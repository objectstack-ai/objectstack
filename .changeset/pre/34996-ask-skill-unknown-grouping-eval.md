---
'@objectstack/skills': patch
---

test(skills): the `objectstack-ask` eval cases cover a matched measure beside a grouping word that names nothing

Clause-②: no
Metadata-protocol: none

Two changes to the eval fixtures of the `objectstack-ask` skill (`evals/metric-selection-fallback.json`, which ships inside the catalog and is inert in a consumer install); the skill text and the page at `GET /mcp/skill` are unchanged.

- A new case, 20: the word for the thing measured equals one measure, and the grouping word matches nothing in any dataset and has no candidates. The expected answer computes the measure through `query_dataset` and cites its source, takes the breakdown by that grouping from the object tools (`describe_object`, then `aggregate_records`) under the line saying it is not from a governed metric (非指标口径), and asks the user nothing about the word. This is ADR-0149 D3 rule 2 for the measure and rule 4 for the word, as `list_datasets`' `nextStep.note` already writes it; the skill already says to follow that note and to go to step 4 for a word with no match and no candidates, so no rule and no skill sentence is added.
- Case 19 (a reply to an ask-back that names another word) now also forbids the `list_objects(` call spelling, so an answer that starts the object-query fallback at its first call no longer passes by mentioning `list_datasets`.
