---
'@objectstack/plugin-approvals': patch
---

fix(plugin-approvals): the out-of-office delegation form's Delegator picker offers only the signed-in user, the one delegator the server accepts

Clause-②: no

No accept set moves. The field gains a picker filter, which nothing on the write path reads, and the delegation write guard and `required` are unchanged.

- **Before.** `sys_approval_delegation.delegator_id` was a free `sys_user` lookup, so Approvals → Delegations → New offered every user. The delegation write guard accepts one delegator on a non-system write, the acting user, so picking anyone else was refused with 403 `FORBIDDEN`.
- **Now.** The field declares `lookupFilters: [{ field: 'id', operator: 'eq', value: '{current_user_id}' }]`. The engine resolves the placeholder against the caller on every read, so the picker's candidate query offers the signed-in user and nobody else.
- **Unchanged.** What a write may store. A create or an update that names another delegator is still refused, and there is no admin exemption. An admin covering for an absent approver reassigns, recalls or rejects that approver's pending approvals through the approval override instead.
