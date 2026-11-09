---
'@objectstack/skills': patch
---

docs(skills): more of objectstack-automation's self-contained examples are type-checked by `check:skill-examples`

Clause-②: no
Metadata-protocol: none

Ten more fenced TypeScript blocks in `skills/objectstack-automation/` carry the opt-in check marker, so 13 of its 19 are now compiled against the spec. In `SKILL.md` the `notify` node and the trigger start node are typed `FlowNode` (`@objectstack/spec/automation`). In `references/examples-flows.md` the time-relative sweep is wrapped in `defineFlow`. In `references/state-machines-and-approvals.md` the `state_machine` rule is typed `ValidationRule` (`@objectstack/spec/data`) and the discount approval flow is wrapped in `defineFlow` with `cel` imported. In `references/integration-recipes.md` recipes 1 to 5 import `defineConnector` / `defineFlow` from `@objectstack/spec`. No example was wrong. The six left unmarked are fragments (or, for two `SKILL.md` blocks, fences indented inside a list item, which the check does not read). The marks are paid inside each file by removing restatements and pointers whose rule lives on elsewhere; no rule's teaching changes.
