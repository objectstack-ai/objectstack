---
'@objectstack/skills': minor
---

docs(skills): the data skill teaches a field rename through `renamedFrom`

Clause-②: no
Metadata-protocol: semantic

`objectstack-data`'s schema-evolution table gives a field rename its own row (declare `renamedFrom: ['old_key']` on the new key; the sync carries the column's values), and its evals ask for one.
