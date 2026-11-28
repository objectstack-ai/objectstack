---
'@objectstack/skills': patch
---

docs(skills): the approvals reference says what a deleted pending record leaves of its parked flow run

Clause-②: no
Metadata-protocol: none

- `skills/objectstack-automation/references/state-machines-and-approvals.md`, Approval Best Practices item 2: deleting the pending record now also cancels its parked run, and neither the `approve` nor the `reject` branch runs, so an action that must happen on the delete belongs in the record's delete hook.
- Paid for on the same page by cutting restatements, with no rule dropped: "three roots — nothing else" drops "nothing else", "genuinely-optional inputs explicitly" is "optional inputs", "the child object" is "the child", item 3's prohibition is one clause, and item 4 is compressed. The file stays at its token ceiling (5927 of 5927).
