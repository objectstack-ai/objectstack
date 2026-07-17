---
"@objectstack/spec": minor
"@objectstack/plugin-approvals": minor
"@objectstack/lint": minor
---

feat(approvals): rename the `role` approver type to `org_membership_level` (#3133)

`ApproverType.role` was the last platform surface projecting the reserved word
"role" (ADR-0090 D3). It is not covered by D3's better-auth exception: that
exception protects better-auth's own `sys_member.role` **column**, which we do
not own — `ApproverType` is our own enum, an authoring surface, and D3 mandates
that the projection of that concept is spelled `org_membership_level` and
labelled "organization membership", **never "role"**.

The sentence licensing the leak was also false: ADR-0090 D3 claims
`sys_member.role` is "already relabelled `org_membership_level` in the platform
projection", but `org_membership_level` existed nowhere in the codebase and
ADR-0057 D7 lists that relabel under "Deferred (evidence-gated, P4)". The
projection never landed, so the word reached authors.

The name manufactured a real, silent failure — "hotcrm class": every other
surface renamed to `position` (`sys_role`, `ShareRecipientType.role`,
`ctx.roles[]`), so `{ type: 'role', value: 'sales_manager' }` reads as the
legacy spelling of a position. It resolves against the membership tier, finds
no member row, falls back to an inert `role:sales_manager` literal, and the
request waits forever on an approver that cannot exist.

- **spec**: `ApproverType` gains `org_membership_level`; `role` stays as a
  deprecated alias for one window (a published 15.x flow keeps loading) with
  `DEPRECATED_APPROVER_TYPES` + `canonicalApproverType()` as the single source
  for the mapping. Removed in the next major.
- **plugin-approvals**: resolves on the canonical type and warns on the
  deprecated spelling. The `type:value` fallback literal keeps the **authored**
  spelling — stored `sys_approval_approver` rows and `pending_approvers` slots
  from 15.x carry `role:<v>`, and rewriting it would orphan them.
- **lint**: `approval-role-not-membership-tier` → `approval-approver-not-membership-tier`
  (the rule id carried the reserved word too), plus a new
  `approval-approver-type-deprecated`. The two are mutually exclusive: a bad
  *value* wins, because prescribing `org_membership_level` for a position name
  would be wrong advice — the fix there is `position`.

Authoring `type: 'role'` keeps working and now says so out loud. Rewrite it as
`org_membership_level`; if the value is an org position, the fix is `position`.
