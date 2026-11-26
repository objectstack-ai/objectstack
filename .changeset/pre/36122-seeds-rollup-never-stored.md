---
'@objectstack/skills': patch
---

docs(skills): the data skill's seeds reference says a seeded roll-up value is never stored, not stored as written

Clause-②: no
Metadata-protocol: none

objectstack-data's `references/seeds.md` kept the rule "never seed the roll-up" but gave a reason that stopped being true: it said a seeded `amount_paid` is stored as written and a cap on payments then refuses the payments it counts. The seed loader takes a value written for a `summary` field out of the record before the write, logs one warning per dataset naming the fields, and the child rows compute the roll-up. The sentence now says that. The record-order point stays: a rule reading a parent roll-up sees the total earlier rows left. The matching eval case in `evals/hooks-security-seeds-datasources.json` expects the same model. Text only; the sentence pays for its new wording in its own bytes.
