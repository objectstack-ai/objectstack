---
'@objectstack/plugin-approvals': patch
---

fix(plugin-approvals): the schema-read delegate answers "is this member party to any approval request?" with bounded reads, and `sys_approval_action` indexes the columns it filters on (#33046)

Clause-②: no
Metadata-protocol: none

`authorizeSchemaRead`, which the object-schema posture asks whenever a member who cannot read `sys_approval_request` / `sys_approval_action` lists or reads object definitions, ran the approvals door's id-collecting participant probe: up to three 10000-row id windows, one of them a scan of `sys_approval_action` on `actor_id` / `acted_as`, which no index covered, then one `$in`. Every metadata list read by such a member paid a cost that grew with the approval history.

- The participant rule's reads now live once, as data (`participantProbes`): current approver (the `sys_approval_approver` index), submitter, already acted (`actor_id` is the caller, or `acted_as` is a slot the caller acts under). The approvals door still collects each in its window, with the same reads as before. The schema-read delegate asks each for at most one row and confirms a hit with one row read of its request in the caller's organization.
- On the delegate, the already-acted probe is scoped on the action row's own `organization_id`, which every writer stamps from its request and the organization backfill moves with it.
- `sys_approval_action` declares two indexes, `(actor_id, organization_id)` and `(acted_as, organization_id)`. Schema sync builds them as it builds the object's other declared indexes.

The answer is unchanged: the same members are admitted (the pending approver, the submitter, a past actor, the holder of a slot a decision was taken under, the override holder) and the same members are refused. Two edge cases differ. A member whose participation lay past one of the old 10000-row windows is now admitted, where before the window could hide it. A decision row whose `organization_id` disagrees with its request's is now judged by its own column, which is the state the organization backfill repairs.
