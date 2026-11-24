---
'@objectstack/skills': patch
---

docs(skills): the data skill no longer teaches a boolean `inlineEdit` on a master-detail relationship

Clause-②: no
Metadata-protocol: none

objectstack-data's `rules/relationships.md`, "Inline-edit form factor": the `inlineEdit: true // auto (default)` line is gone, and the smart default is now described as what an omitted key gets, with a note that a boolean is refused. The spec parse refuses `true` and `false` on a relationship field's `inlineEdit` since 18.7.0; only `'grid'` and `'form'` are accepted, and leaving the key out picks the form factor from the child's shape. `evals/objects-fields-relationships.json` case 25 drops the same `true` from its expected answer.
