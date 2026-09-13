---
"@objectstack/plugin-auth": minor
---

fix(plugin-auth)!: `POST /admin/create-user` reads the deployment's membership policy instead of hard-coding `auto` (#16683)

**BREAKING** — the membership this published endpoint writes moves for existing inputs on `invite-only` deployments. The route, its request body, its response fields and every exported signature are byte-identical; what changes is what an existing call does on a deployment that declared a non-default policy, stated as a FROM/TO pair below.

ADR-0093 D1 makes the deployment's `membershipPolicy` the one answer to "does this new account get an organization membership", and enumerates the `invite-only` flows as a closed set — "which endpoint created the user" is explicitly not a determinant. The `user.create.after` reconciler and the D6 backfill both read it through `AuthManager.getMembershipPolicy()`. This endpoint did not: its belt-and-suspenders bind handed the reconciler a literal `'auto'`, so it was the one membership-writing path in the product that ignored the setting.

FROM: on a deployment declaring `membershipPolicy: 'invite-only'`, an account created through `POST /api/v1/auth/admin/create-user` was bound to the default organization anyway, and the 200 response answered `membershipCreated: true`. The `user.create.after` reconciler had already declined to bind it; this endpoint bound it afterwards.

TO: the same call creates the account and binds no membership. The response answers `membershipCreated: false` and omits `organizationId`, and the audit row records the same. The account is created and can sign in — `invite-only` withholds the membership, not the login.

Who is affected: only deployments that set `auth.membership_policy` (or `OS_AUTH_MEMBERSHIP_POLICY`) to `invite-only`. Under the default `auto` posture behaviour is unchanged in every observable respect — response body, `sys_member` write and audit metadata — and that equivalence is pinned by a test rather than asserted here.

If you relied on admin-created accounts acquiring a membership on an `invite-only` deployment, the supported way to keep it is to bind the membership explicitly (the `add_member` action / `POST /organization/add-member`), which is what `invite-only` means: memberships are granted deliberately, never as a side effect of account creation. Setting the deployment back to `auto` restores the old behaviour for every path at once, including sign-up.

The direction of the old defect was open, not closed: it GRANTED a membership the operator had configured the platform to withhold, and reported success while doing it. An operator who set `invite-only` specifically to keep a shared organization identity off their users got one anyway.

<!-- adr-0087: not-required (no-migration-prescription) nothing authorable changes shape: no spec key, no Zod schema, no stored metadata and no exported symbol is added, removed or renamed, so `os migrate meta` has no edit to make and no ledger id to carry. What moves is one runtime decision inside an HTTP handler, already governed by the `auth.membership_policy` setting an operator sets and can change back. -->
