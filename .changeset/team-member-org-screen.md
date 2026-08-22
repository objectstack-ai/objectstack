---
"@objectstack/plugin-approvals": patch
---

Screen expanded `team` approver members to the request's organization (#10547).

#10230 made a `team` approver prove the TEAM's tenancy, and deferred the
members on purpose. `sys_team_member` carries `team_id` and `user_id` and no
organization column, so a team that passed that screen still routed every user
id it listed — including a user whose only `sys_member` row is in another
organization. Measured on a fixture, not read off the schema: an `org_a`
request against an `org_a` team returned `["u_outsider","u_insider"]` with zero
`sys_member` reads.

The expansion now screens the members with the same provably-outside posture
the neighbouring screens pin, in ONE `$in` read for the whole slate:

- membership rows exist for the user and none is the request's organization
  (present and NEGATIVE) — dropped, with a warning naming the users, the team
  and both organizations;
- no membership rows, an unreadable `sys_member`, a possibly-truncated read, or
  a request carrying no organization (ABSENT) — routing is left exactly as it
  was, and the no-organization case performs no read at all.

Holding membership elsewhere is not disqualifying; holding none here is.

⚠️ Behaviour change, confined to one non-default policy: a node whose only
approver is a team staffed entirely by users provably outside the organization
now resolves to no one. Under the default `onEmptyApprovers: 'admin_rescue'` it
still opens, routed to the dead `team:<id>` literal as any unresolved slate is;
under `onEmptyApprovers: 'fail'` it now throws `NO_APPROVERS` where it
previously opened.

Residual condition on the security value: the screen can only act on tenancy
facts that exist. A deployment that stamps an organization on its approval
requests but does not materialize `sys_member` rows sees no change — by design,
since #3807 recorded what treating an absent fact as a negative one costs.
