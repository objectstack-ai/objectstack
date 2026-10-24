---
'@objectstack/plugin-approvals': patch
---

fix(plugin-approvals): an SLA escalation that reassigns to a target resolving to no one keeps the request on its approvers and notifies them, instead of stranding it on a slate nobody can decide

Clause-②: no
Metadata-protocol: none

An approval node's `escalation: { action: 'reassign', escalateTo }` expands `escalateTo` to the holders of that position, and when nobody holds it falls back to the value itself, so a config naming a specific user id keeps working. That fallback is now judged by the same rule the reassign door applies: a user id or email an account carries (and not a user of other organizations only), or `position:<name>` for a position someone in the request's organization holds.

- **A target that resolves** reassigns exactly as before.
- **A target that does not** (an unstaffed or mistyped position name, a user id with no account, a `team:` / `department:` / `org_membership_level:` / `role:` literal) no longer replaces the slate. The pending approvers are kept and receive `approval.sla_breached`, and the `escalate` audit row records `reassign → <target> — not applied: <why>`. The escalation still fires once.
- **The submitter's escalation notice** now names the action actually taken (`notify` when the reassign was not applied, or when no `escalateTo` was set), not the configured one.
- A directory read that fails during the sweep leaves the request untouched and unmarked, so the next sweep retries it.

Nothing an author writes is refused that was accepted before. To have an overdue request move, name a staffed position or a person in the request's organization in `escalateTo`.
