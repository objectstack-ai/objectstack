---
'@objectstack/plugin-approvals': patch
---

fix(plugin-approvals): a `manager` approver whose record owner has no manager adds no slot to the request, instead of the literal `manager:undefined`

Clause-②: no

An approval request whose user-resolving approver resolves to nobody now opens on an empty `pending_approvers`, and the node's `onEmptyApprovers` policy applies, as `content/docs/automation/approvals.mdx` documents ("An entry that resolves to nobody is not an error: the request opens with an empty `pending_approvers`"). This covers `{ type: 'manager' }` when the record's owner has no `sys_user.manager_id`, or the manager is outside the request's organization, and `{ type: 'field' }` when there is no record to read.

Before this fix the expansion stored a literal `manager:<value>` slot: `manager:undefined` when the approver authors no `value`, which is the usual case. Both read doors (`GET /api/v1/approvals/requests` and `GET /api/v1/data/sys_approval_request`) served that slot. Nobody can ever act under it: a caller acts only under their user id, their own account's email, or the `position:<name>` address of a position they hold.

What changes, and for whom:

- **A slate made only of such rungs** opens with `pending_approvers: []` under the default `onEmptyApprovers: 'admin_rescue'`, where it held `["manager:undefined"]` before. `fail`, `auto_approve` and `fallback` behave as before, because those policies already treated a slate of literals as empty.
- **A slate with other approvers** (for example `[{ type: 'manager' }, { type: 'user', value: 'u9' }]`) is carried by the others. Under `unanimous`, `quorum` or `per_group`, the dead literal used to be an unapprovable slot: it held the request open after every real approver had approved, until an admin overrode it. Now the real approvers' approvals finish the step. This is the "second approver entry that cannot resolve empty" escape that the docs name for an unset manager.
- **Group approvers are unchanged.** An unstaffed `position` still opens on its `position:<name>` literal, which a holder staffed into the position later decides. `team`, `department` and `org_membership_level` still fall back to their `type:value` literal.
- The `manager` rung still logs a warning when it resolves to nobody. The warning now says that the rung adds no slot, and names the subject user.

Stored requests are not rewritten. A pending request that already holds a `manager:…` or `field:…` slot keeps it, and it stays recoverable as before: a platform or tenant admin can approve, reject, reassign or recall it. To list such requests, filter `sys_approval_request` on `status = pending` and on `pending_approvers` containing `manager:` or `field:`.
