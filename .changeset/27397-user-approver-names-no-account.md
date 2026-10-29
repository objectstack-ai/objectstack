---
'@objectstack/plugin-approvals': patch
---

fix(plugin-approvals): a `user` approver whose id or email no account carries expands to nobody, warns, and takes the node's `onEmptyApprovers` route instead of opening on a slot no one can take

Clause-②: no
Metadata-protocol: none

A `{ type: 'user', value }` approver used to put `value` on the slate as it was written, without asking whether any account carries it. A mistyped id, or the id of a person removed since the flow was authored, opened a request pending on that slot: no one could ever decide it, it appeared in no one's queue, and nothing was logged.

Now the value is checked against `sys_user` (by id, or by email for an email-shaped value), with the same predicate the reassign door already uses. When no account carries it:

- the approver logs the same `approver 'user:<value>' expanded to nobody` warning the team, department, position and membership-tier approvers log;
- it adds no slot to the request;
- a slate this leaves empty is decided by the node's `onEmptyApprovers`, by default `admin_rescue`, which opens the request on the organization's administrators;
- beside other approvers, only the unresolvable one is dropped, and the others carry the request.

Unchanged: a real account keeps its slot, including a banned one and a person from another organization's directory (a `user` approver names a person outright, so no tenancy screen is applied). An out-of-office delegation that routes the approver to a delegate still routes. A failed `sys_user` read keeps the slot, because it does not prove that the account is missing.
