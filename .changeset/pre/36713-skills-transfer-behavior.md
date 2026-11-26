---
'@objectstack/skills': patch
---

docs(skills): the data skill teaches `transferBehavior`, the Change Owner cascade of a relationship

Clause-②: no
Metadata-protocol: none

objectstack-data's `rules/relationships.md`, Delete Behaviors: one paragraph says what `transferBehavior: 'cascade'` on a child's `lookup` / `master_detail` does (the parent's Change Owner dialog offers to move the child rows its previous owner owns too), when to declare it, that the default is `'none'`, and where parse refuses it: the key on any other type, and `cascade` on a `sys_*` reference, on `multiple: true`, and on a child that does not offer Change Owner itself, such as a `controlled_by_parent` detail. `rules/field-types.md` lists the key on the `lookup` and `master_detail` rows. `evals/objects-fields-relationships.json` gains one case. The new text is paid for by removing restatement in the same files: in relationships.md the two "Incorrect" code blocks become one sentence each, and two `required: false` lines and five comment or prose repeats go; in field-types.md the autonumber example that the Autonumber section already gives and two "embedded" repeats go.
