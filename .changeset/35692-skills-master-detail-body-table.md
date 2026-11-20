---
'@objectstack/skills': patch
---

docs(skills): the data and ui skills teach that a `master_detail` child is a record-page body table by default

Clause-②: no
Metadata-protocol: none

The record page draws a `master_detail` child as a full-width body table whenever its FK declares no `relatedList`. The skills still tied that to `inlineEdit`. They now teach the rule the runtime applies.

- objectstack-data's `rules/relationships.md`, "Detail-page related lists": a `master_detail` child is a body table by default and a `lookup` child is a panel. `inlineEdit` governs entry in the parent's form only. The `relatedList` list reads `'primary'` (the `master_detail` default), `true` (the `lookup` default) and `false`. The example no longer writes `inlineEdit` and `relatedList: 'primary'` on a `master_detail` field to get the table.
- objectstack-ui's `rules/record-page.md`, step 2: the same defaults, the body table is drawn above the field sections (it used to say after the first one), and "put the tasks first" is the parent's `relatedLists`. The example field drops its `relatedList: 'primary'`.
- objectstack-ui's `evals/record-page.json`, case 1: the expected answer adds no placement flag to a `master_detail` field, and an answer that authors `inlineEdit` fails the case. `evals/README.md` follows.

Both rules files are shorter than before. No ceiling moves.
