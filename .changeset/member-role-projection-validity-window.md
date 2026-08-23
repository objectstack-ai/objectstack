---
"@objectstack/core": patch
---

A lapsed `sys_member` row now confers no org role either — one row, one answer (#10982)

`resolveUserAuthzGrants` reads `sys_member` once and derives two facts from it:
`accessible_org_ids` (the `group` posture's read reach, ADR-0105 D2) and the
org-administration role projection into `positions` (ADR-0095 D3). Only the
first applied the ADR-0091 validity window. A membership outside
`[valid_from, valid_until)` was therefore excluded from org access while still
projecting its better-auth role — two answers from one read, and with
`role: 'owner'` the role reaches the `organization_admin` capability that
`derivePosture` reads for `TENANT_ADMIN`.

The role projection now drops out-of-window rows **before** the derivation, the
same shape `sys_user_permission_set` already had, so an expired membership can
no more yield `org_owner` than an expired `admin_full_access` can yield
`platform_admin`. Fail-closed per ADR-0091 D2. Maintainer ruling, 2026-08-22
live session (item 2): a lapsed membership is *no membership*, not merely *no
org access*.

**Why `patch` and not a breaking bump, argued in the open.** This is a real
change of authorization semantics — a membership that used to confer a role
stops conferring it — so the direction is a tightening, and tightenings are the
kind of change that normally earns a major. It is nevertheless `patch` because
the population it can affect is provably empty: `sys_member` declares neither
`valid_from` nor `valid_until` (see `sys-member.object.ts`), and `isGrantActive`
reads an absent bound as unbounded, so **no row any deployment can currently
store is lapsed** and every existing membership resolves exactly as before. That
is asserted directly rather than reasoned about, in
`resolve-authz-context.test.ts` ("a membership with NO bounds is unbounded —
every shipped row is unaffected"), alongside the load-bearing leg that an
in-window membership still projects its role. Landing it now is the cheap
moment: once the columns exist, the same change becomes a migration carrying
live semantics.

**Not in scope, and deliberately so.** This does not add the validity columns to
`sys_member`, and it does not reach into `sys_user_permission_set` rows that
plugin-security's `reconcileOrgAdminGrant` provisioned from a membership role.
Such a grant is standing authority in its own right with its own ADR-0091
window; the role is only its provisioning source (ADR-0095 D3). The boundary is
pinned as a measured fact rather than left as an assumption.
