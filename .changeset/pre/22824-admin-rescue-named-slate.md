---
'@objectstack/plugin-approvals': minor
'@objectstack/spec': patch
'@objectstack/lint': patch
---

feat(plugin-approvals): an approval step whose approvers resolve to no one opens on the organization's administrators under the default `onEmptyApprovers: 'admin_rescue'`, as ordinary approvers in their inbox

Clause-②: yes

**FROM → TO: who receives an `admin_rescue` request.** A node whose approvers resolve to no concrete person (an unstaffed position, an empty team or department, an unset manager, an expression that yields no one) under the default `onEmptyApprovers: 'admin_rescue'`:

- **FROM:** the request opened on a slate that named no one, such as the literal `position:sales_manager`. It was in no one's "My Pending", the bell counted 0, no one was told, and a `lockRecord: true` record stayed locked until a platform or tenant admin found it under **All** and decided it through the privileged override.
- **TO:** the request opens on the request organization's administrators: the people who hold the organization-admin capability (`organization_admin` or `organization_admin_no_bypass`, ADR-0095 D3) in that organization. That is the same authority that lets a tenant admin override a request, resolved to the people who hold it, through the same grant resolution every request runs. An organization's owners and admins receive the capability automatically.

They are ordinary approvers. The request is listed and counted for each of them under their own `approverId`, each is told once by `approval.requested`, out-of-office delegation applies to them, and a decision by one of them is an ordinary approval or rejection, recorded with `via_override: false`. The node's `behavior` reads them as one group. A platform administrator is not added for being one; one who also holds the organization's capability, such as its owner, is on the slate for that.

The request says why. Its timeline carries a note, for example "Routed to this organization's administrators because the approver slate named no one: position 'sales_manager' has no holder.", and its node-config snapshot keeps the abandoned slate and the reason under `__resolvedFrom` (`admin_rescue:abandoned`, `admin_rescue:reason`). The abandoned slate is replaced, not kept beside the administrators, so a holder staffed into the position after the request opened does not receive it; an administrator can reassign it to them.

**Unchanged.** A slate that names a person; `fallback`, `auto_approve` and `fail`; a `fallback` whose own list resolves to no one still degrades to `admin_rescue`, which now opens on the administrators. The privileged override stays for what the administrators' slate cannot reach: a request whose named approvers have all left after it opened, and an organization with no administrator (or a request with no organization), where the request still opens on the slate that names no one and the server logs a warning.

**To name the person who should decide instead of the administrators,** declare `onEmptyApprovers: 'fallback'` with a `fallbackApprovers` list.

**`@objectstack/spec`:** the `onEmptyApprovers` description says that `admin_rescue` opens on the organization's administrators and that `fallback` names who decides instead.

**`@objectstack/lint`:** `approval-approvers-may-resolve-empty` no longer says the request "waits forever": it says the request opens on the organization's administrators, its remedy names `onEmptyApprovers: 'fallback'` as the way to name who decides, and its `os explain` text says the same.
