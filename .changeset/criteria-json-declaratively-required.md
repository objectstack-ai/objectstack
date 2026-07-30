---
"@objectstack/plugin-sharing": patch
---

feat(sharing): `sys_sharing_rule.criteria_json` is declaratively required (ADR-0113 P2)

The field the ADR was written for: `required: true` as the write contract —
insert must provide, update may not null out, legacy null rows rest, an admin
can still `active: false` an over-broad legacy rule. Deliberately NO
`storage.notNull`: deployed tenants' legacy nulls are the case the split
exists for. The Setup form's required marker and client validation now derive
from the declaration.

Not breaking: a rule without criteria was already rejected by the #3929 hook
guard; the guard narrows to the non-null match-all shapes `required` cannot
express ('{}', vacuous $and/$or, unparsable JSON), `defineRule` keeps the API
seam, and the evaluator stays fail-closed (ADR-0049).
