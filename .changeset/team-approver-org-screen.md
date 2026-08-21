---
"@objectstack/plugin-approvals": patch
---

**Who loses access:** members of a team belonging to a *different* organization
than the record being approved. Concretely — a request raised in `org_a` routed
to a `team` approver whose `sys_team.organization_id` is `org_b` used to place
every `sys_team_member` of that team into `pending_approvers`, giving them the
approve/reject buttons on a record they are not a tenant of. They no longer
enter the slate, and the step falls back to the dead `team:<id>` literal with
the existing `#3807` "expanded to nobody" warning — the same shape a cross-org
`position` approver has always produced (#10230).

`team` was the last approver expansion that resolved people without asking
which organization was asking; `department`, `position`, `org_membership_level`
and (since #10153) `manager` all do. The screen reads the team's own
`organization_id`, so it costs one row and a team that fails it never fans out.

**Who does not lose access**, deliberately: a team stamped with the request's
own organization; a team stamped with **no** organization (`organization_id:
null` on a platform object means "owned by no organization" — what a seed
writes, since a seed cannot know the id the runtime mints at boot); a team id
with no `sys_team` row at all; and any request that carries no organization —
all four leave routing exactly as it was, because the tenancy fact is absent
rather than negative.

⚠️ One externally observable accept→reject change beyond the routing itself:
under the non-default `onEmptyApprovers: 'fail'` policy, a node whose *sole*
approver was a cross-org team used to open a request and now throws
`NO_APPROVERS`. Under the default (`admin_rescue`) the node still opens.
