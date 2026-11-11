---
'@objectstack/skills': patch
---

docs(skills): the `conditionalRequired` → `requiredWhen` rule and the flow `runAs` rule for `readonly` fields each keep one home

Clause-②: no
Metadata-protocol: none

The removed `conditionalRequired` alias was stated in three skills. `objectstack-data` § Conditional Field Rules keeps it. `objectstack-formula` § 3 Predicate drops its copy for a one-line link to that section, and `objectstack-ui` § Field Conditional Rules in Forms drops its copy and turns its existing plain-text pointer to the same section into a real link. The rule that a flow maintaining a `readonly` field runs `runAs: 'system'`, and that `os validate` / `os build` fail a `runAs: 'user'` `update_record` writing one, was stated in `objectstack-data` and `objectstack-automation`. `objectstack-automation` § Failure routing & `runAs` keeps it, and the `readonly` bullet in `objectstack-data` now links there. The data bullet keeps what only it says: REST/UI writes are stripped too, system hooks, seeds, imports and migrations are exempt, and the field stays `readonly` when automation maintains it. No rule's teaching changes.
