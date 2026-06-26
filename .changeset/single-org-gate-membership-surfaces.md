---
"@objectstack/platform-objects": patch
---

fix(platform-objects): hide org/membership surfaces in single-org mode

The platform gates multi-org features two ways — nav entries on
`requiresService: 'org-scoping'` (e.g. setup-nav Organizations/Invitations)
and object actions on `visible: 'features.multiOrgEnabled != false'` (e.g.
`sys_organization.create_organization`). That convention had only been applied
to a handful of spots, so a wide band of org/membership surface leaked into
single-org deployments where it is pure noise or a broken affordance:

- The Account app's "My Organizations" entry (`sys_member` / `mine` view) was
  gated on `requiresObject: 'sys_member'` — but `sys_member` is a system object
  that is always registered, so the gate never fired. In single-org there are
  no `sys_organization` rows and no auto-stamped memberships, so the view is
  always empty for every user. Re-gated on `requiresService: 'org-scoping'`.
- The setup-nav "Teams" entry had no gate at all, while its sibling
  Organizations/Invitations entries were correctly service-gated. Added
  `requiresService: 'org-scoping'`.
- Org/membership mutation actions rendered (and on toolbars, were clickable)
  in single-org but hit better-auth endpoints that resolve an active org that
  does not exist, failing at the API. Gated each on
  `features.multiOrgEnabled != false`:
  - `sys_user.invite_user` (the most exposed — the Users list is always
    reachable in single-org)
  - `sys_member.add_member` / `update_member_role` / `remove_member`, and
    `transfer_ownership` (combined with its existing `record.role != 'owner'`
    condition)
  - `sys_team.create_team` / `update_team` / `remove_team`
  - `sys_team_member.add_team_member` / `remove_team_member`
  - `sys_invitation.invite_user` / `resend_invitation` / `cancel_invitation`
    (recipient-side accept/reject stay record-gated; they are unreachable in
    single-org anyway since no invitation rows exist)

Also tightened the remaining single-org rough edges on these objects:

- `sys_organization` admin actions (`update` / `delete` / `set_active` /
  `leave` / `change_slug`) are now all gated on
  `features.multiOrgEnabled != false`, joining the already-gated
  `create_organization` — previously only create was gated.
- `titleFormat` no longer renders a null organization: `sys_member` is titled
  `'{user_id} ({role})'` (was `'… in {organization_id}'`) and `sys_invitation`
  is titled `'Invitation for {email}'` (was `'Invitation to {organization_id}'`).
  In single-org `organization_id` is null, so the old formats read "… in null".
  The new fields are more useful identifiers in both modes.

No behavior change in multi-org deployments (`OS_MULTI_ORG_ENABLED=true`):
`features.multiOrgEnabled` is true and the `org-scoping` service is present, so
every gate evaluates to visible exactly as before. This is metadata-only — no
schema, API, or runtime changes.
