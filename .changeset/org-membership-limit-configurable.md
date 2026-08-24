---
'@objectstack/types': patch
'@objectstack/plugin-auth': patch
---

Lift better-auth's hidden 100-member-per-organization cap; make it
configurable via `OS_ORG_MEMBERSHIP_LIMIT`

Adding a member to an organization past its 100th failed with 403
`ORGANIZATION_MEMBERSHIP_LIMIT_REACHED` ("Organization membership limit
reached") — on `POST /api/v1/auth/organization/add-member` and on invitation
acceptance alike. The cap was never ours: better-auth's organization plugin
treats an **absent** `membershipLimit` option as a hard 100-member limit
(`membershipLimit || 100`, measured on the installed 1.7.1,
`dist/plugins/organization/routes/crud-members.mjs` and `crud-invites.mjs`),
and the auth plugin configured `organizationLimit` (orgs a user may create,
`OS_ORG_LIMIT`) but never `membershipLimit` — so every deployment silently
carried a 100-member ceiling per org with no knob to turn. A hospital
deployment hit it in production: its 101st staff member could not be added.

The auth plugin now ALWAYS passes `membershipLimit`, so the vendor fallback
never applies: the new `resolveOrgMembershipLimit()` in `@objectstack/types`
reads `OS_ORG_MEMBERSHIP_LIMIT` (positive integer → that cap; unset or
non-positive → no limit), mirroring `resolveOrgLimit`'s self-host-default
posture of unlimited. Metered SaaS postures that want a per-org member cap set
the env; nobody else inherits an arbitrary vendor ceiling.

Passed in **function form** deliberately, even though the value is static per
process: the vendor adapter reuses a *numeric* `membershipLimit` as the default
query limit for member listings (`adapter.mjs`), so a numeric
`Number.MAX_SAFE_INTEGER` would leak into `list-members` pagination. A
function only ever feeds the cap check in `addMember` / `accept-invitation`,
both of which support the function shape on 1.7.1.
