---
'@objectstack/plugin-auth': minor
'@objectstack/platform-objects': minor
'@objectstack/spec': minor
'@objectstack/lint': patch
'@objectstack/cli': patch
'@objectstack/verify': patch
'@objectstack/plugin-dev': patch
'@objectstack/runtime': patch
---

feat(auth)!: membership grade is not a capability channel — the `sys_member.role`
vocabulary is closed (ADR-0108, #3723)

`sys_member.role` answers "what is your standing in this organization". It does
not answer "what may you do" — that is what positions are for. One column was
answering both.

`resolve-authz-context` projects EVERY value stored in `sys_member.role` into
`current_user.positions`, alongside the rows read from `sys_user_position`. So a
business role handed out through the membership role *was* capability — granted
with none of the position system's controls: no `granted_by`, no ADR-0091
validity window, no BU-subtree check, no `assignablePermissionSets` allowlist.
That is what ADR-0057 D4 ruled out ("feed the names to better-auth **only** so
invitations are accepted — **never as the authority for RBAC**"), what
ADR-0090 D3's word ban restates (distribution = `position`), and what
ADR-0095 D3 keeps out of the enforcement path.

The vocabulary is therefore closed to the four framework-owned names:
`owner` / `admin` / `delegated_admin` / `member`.

**BREAKING — `additionalOrgRoles` is removed** from `AuthManagerOptions` and
`AuthPluginOptions`, together with `plugin-auth/src/org-roles.ts` in full
(`collectStackOrgRoles`, `collectRegisteredOrgRoles`,
`normalizeAdditionalOrgRoles`, `membershipRoleOptions`,
`withMembershipRoleOptions`, `membershipRoleLabel`, `orgRoleNames`,
`MEMBERSHIP_ROLE_OBJECTS`, `OrgRoleDescriptor`, `OrgRoleInput`,
`OrgRoleLogger`) and the `kernel:ready` derivation hook that fed them. From
`@objectstack/spec`, `MEMBERSHIP_ROLE_NAME_PATTERN` and
`MEMBERSHIP_ROLE_NAME_MIN_LENGTH` are removed — they existed only to validate
app-supplied names. A TypeScript error is the intended failure: an option that
is silently ignored is `declared ≠ enforced` one more time.

FROM → TO:

```diff
- new AuthPlugin({ additionalOrgRoles: ['sales_rep'] })
+ new AuthPlugin({ /* nothing — declare `sales_rep` as a position */ })

- POST /organization/invite-member { email, role: 'sales_rep' }
+ POST /organization/invite-member { email, role: 'member',
+                                    businessUnitId, positions: ['sales_rep'] }
```

For an existing member, assign the position through `sys_user_position` (the
governed write path). Invitation placement (ADR-0105 D8) is the one-step
admission flow: issuance is authorized against the issuer's `adminScope` by
dry-running `DelegatedAdminGate`, and acceptance writes real
`sys_user_position` rows with a `granted_by` stamp. It reaches **further** than
what it replaces — a delegated admin may use it within their subtree, where the
membership-role route was open to org admins only (the invitation role cap holds
anyone below admin grade to plain `member`).

An invitation naming an app role now fails at better-auth's door with
`ROLE_NOT_FOUND`, before any row is written.

This reverses two changesets that were never consumed into a release
(`app-org-roles-storable`, `auth-org-roles-self-derived`), so no published
version ever offered the behaviour; both are removed rather than shipped and
retracted in the same changelog. A pre-existing deployment could only have
stored a custom value by direct DB write.

Also derived rather than transcribed: `@objectstack/lint`'s `MEMBERSHIP_TIERS`
now reads `BUILTIN_MEMBERSHIP_ROLES` from `@objectstack/spec`. The hand-kept
copy carried `guest`, which the `sys_member.role` select has never offered — an
approver authored as `{ type: 'org_membership_level', value: 'guest' }`
resolved to nobody and the lint whose whole job is to catch that stayed silent.
