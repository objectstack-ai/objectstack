---
'@objectstack/service-automation': patch
'@objectstack/service-messaging': patch
---

Stamp `organization_id` on flow-produced notifications and on `markRead`
receipts, so the notification family stops writing org-less rows

An application project's read-only inventory found `sys_inbox_message`,
`sys_notification`, `sys_notification_receipt` and `sys_notification_delivery`
carrying `organization_id = NULL` on **100%** of their rows — existing rows and
same-day new ones alike, while `sys_approval_request` in the same database
carried an organization on every row. Ruled a gap, not a design choice.

Everything below the messaging ingress was already threaded: `emit()` stamps the
`sys_notification` event, the inbox channel stamps `sys_inbox_message` and its
`delivered` receipt, and the outbox carries the value onto
`sys_notification_delivery`. Each of them reads `EmitInput.organizationId` —
and the `notify` flow node, the dominant producer, never supplied it. Its local
structural mirror of `emit()` did not even declare the field, so the value could
not have been passed. One missing argument, four tables at 100% null.

The node now threads the organization from the run's own acting context
(`AutomationContext.tenantId`), the same source the `collab.mention` producer in
`@objectstack/plugin-audit` already uses, so the two notification producers agree
about whose organization a notification carries.

A second producer of the same table is fixed alongside it: the `read` receipt
`markRead` inserts — written when a user reads a notification whose delivered
receipt never landed — named no organization at all. It now carries the
organization of the `sys_notification` row it is about.

There is deliberately **no fallback limb** in either producer: not "the current
organization", not the install's first organization, not the recipient's first
membership. A run with no organization in scope still emits and still writes its
rows, and the `notify` node warns audibly naming the topic and the consequence.
A wrong `organization_id` is worse than a null — a null is visibly missing,
while a wrong value is silently authoritative to every report, export and
cleanup script that filters by organization.

Forward-stamping only. Existing rows are not backfilled and no migration ships.
