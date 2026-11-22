---
'@objectstack/skills': patch
---

docs(skills): `objectstack-formula` says that `==` / `!=` between a list-valued field and a scalar is refused, and teaches the null-guarded membership test

Clause-②: no
Metadata-protocol: none

The CEL cheat-sheet of the `objectstack-formula` skill gains a note under its operator table: `==` / `!=` between a list-valued field (`multiselect`, `checkboxes`, `tags`, or a `select` / `lookup` / `user` field with `multiple: true`) and a scalar literal is refused by the validator as `list-equality` ("list compared with a scalar"), because CEL compares the whole list and the expression answers one constant on every row. The note shows the refused form and the two forms that replace it, `record.tags != null && 'vip' in record.tags` for `==` and `record.tags == null || !('vip' in record.tags)` for `!=`, and says why the null guard is there: `in` and `.exists()` fault on a `null` list. This is the behaviour `@objectstack/formula` already ships; the skill only teaches it.

Paid for by deletion in the same file, with the token ceiling unchanged (6008): six restatements were cut, each keeping another home — the `has()` section's opening sentence (the cheat-sheet `Key existence (NOT null-safety)` row and the paragraph that follows it), the Salesforce-flavor block's `os build` / runtime clause (the `Verify your work` section), the sentence saying hook conditions and validation predicates bind the same two roots (the `previous` table under it), the sentence saying record-change flow triggers ride the same dispatch (the same table's `after*` row), the closing "It is a refusal" sentence of the 10 000-row paragraph (that paragraph's own "the platform refuses"), and the translation table's `"abc"` row (the cheat-sheet `String literal` row).
