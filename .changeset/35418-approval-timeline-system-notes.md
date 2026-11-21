---
'@objectstack/plugin-approvals': patch
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
'@object-ui/console': patch
---

fix(approvals): the approval timeline names an unstaffed position by its label, and the platform's own rows read as the system's

Clause-②: yes (widening) — @objectstack/plugin-approvals adds the optional `ApprovalServiceOptions.positionLabelSource`; @object-ui/i18n adds approvalsInbox.systemActor and approvalsInbox.actSystemNote; nothing removed
Metadata-protocol: none

When a request goes to the organization's administrators because a position on its approver list has no holder, its timeline note named the position by its machine name ("岗位「crm_sales_manager」无人任职"). The note a reader is served now names it by its label: the reader's language pack (`positions.<name>.label`) first, else the position's declared `label`, else the name as before ("岗位「销售经理」无人任职"). The English the row stores for audit keeps the name.

On the timeline, a row no person took read its actor as "—", and the routing, submitter-exclusion and no-approver notes read as "Commented". A row with no actor now reads its actor as "System", and a `comment` row with no actor reads as "System note". A person's comment keeps "Commented" and its author.

New locale keys: `approvalsInbox.systemActor` and `approvalsInbox.actSystemNote`, in all eleven packs.
