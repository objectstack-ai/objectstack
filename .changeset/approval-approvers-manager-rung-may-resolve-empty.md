---
"@objectstack/lint": minor
---

`approval-approvers-may-resolve-empty` now covers the `manager` rung, not just the group-routed ones.

The rule exists for the empty-slate dead-end (#3424): an approver slate that resolves to nobody, with `lockRecord` turning that into a stranded record. It reasoned about `position` / `team` / `department` and said nothing about `{ type: 'manager' }` — which has the same failure shape and a strictly worse cause. A `position` rung resolves empty because the position is unstaffed, and an operator can staff it. A `manager` rung resolves empty because `sys_user.manager_id` is unset, and an operator **cannot** set it: the managed-update whitelist for `sys_user` is exactly `{name, image, locale}` (ADR-0092), the auth admin endpoints do not accept the column, and the Console renders no field for it. So the rule warned about the rung an author can rescue and stayed silent on the one they cannot — and `manager` is the canonical first rung of a tiered approval ladder, so the silent case was also the common one.

- **What fires.** A node whose approver slate is made up ENTIRELY of `{ type: 'manager' }` rungs now draws one `approval-approvers-may-resolve-empty` finding, at the same `info` tier as its `position` sibling. `manager` resolves through `sys_user.manager_id` of the record's owner and yields nobody when that column is unset; when nothing else is on the node, the request waits forever, and under the default `lockRecord` the record stays locked.
- **What it does not claim.** The message states in as many words that this is a static check which cannot read the column, and that it does not assert the slate IS empty — it reports that nothing else on the node can approve if it is. A lint rule must not claim a runtime fact it did not read.
- **The remedy it prescribes.** Populate `sys_user.manager_id` by SCIM provisioning, a seed / bulk import or directory sync — explicitly **not** by editing the user in the Console, which cannot write it — or add a fallback approver that cannot resolve empty, such as `{ type: 'org_membership_level', value: 'owner' }`. That second escape works today regardless of whether the column ever gains a write surface.
- **When it stays quiet.** A stack whose own seed data wires `sys_user.manager_id` on any seeded row has shown the linter that it populates the column, and the advisory is suppressed. Seed rows are the only manager-chain evidence a stack can carry, so that is the whole of what this check reads on the question.

Existing verdicts are unchanged. The new arm is scoped to slates that are entirely `manager` rungs, which keeps it disjoint from the group-routed arm by construction — no node can draw both findings — and leaves every `position` verdict exactly as it was, mixed slates included: a `[position, manager]` node stays silent, as it is pinned to.

This is a purely additive widening of a published package's public surface — the rule begins covering a case it was silent on — so it is graded `minor`, the floor that act carries regardless of the commit type.

No severity moved. The finding is `info`, so it lands in the advisory channel on every consumer: `os lint` renders it as a suggestion and its exit code is unchanged (a suggestion does not fail a run even under `--strict`), and the runtime publish gate returns it on the 2xx `advisories` array rather than refusing the write. What changes is the report, not any verdict.
