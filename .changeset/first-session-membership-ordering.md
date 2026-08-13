---
"@objectstack/plugin-auth": patch
---

fix(auth): a user's first session no longer predates their membership, so its audit rows carry a tenant (#8245, #8247)

`session.create.before` resolves a session's `activeOrganizationId` from the
caller's `sys_member` row. The ADR-0093 D2 reconciler that **writes** that row is
composed into `user.create.after`, and better-auth defers it past the sign-up
transaction — so the session sign-up mints ran first, found no membership, and
carried no active organization. Structurally, for every new user, on every
deployment.

That first session was not a harmless intermediate. Its `login` audit row takes
its tenant from `session.activeOrganizationId`, so the row landed with a NULL
tenant and the SecurityPlugin's RLS predicate (`organization_id =
current_user.organization_id`) hid it from every reader **permanently** —
nothing back-fills a written ledger row, and the rows lost this way are exactly
the ones describing account creation.

The membership now settles at the seam that needs it: when the active-org lookup
finds nothing, the reconciler runs and the lookup is repeated, so the first
session mints *with* its organization.

**This changes ordering, not policy.** It calls the same reconciler with the same
membership policy and the same target-organization resolution that
`user.create.after` uses — both now share one assembly point on the manager — so
the outcome is exactly what would have happened a moment later:

- `invite-only` binds nobody, and those sessions still mint with no active
  organization;
- a multi-organization deployment resolves no unambiguous target and binds
  nobody, unchanged;
- a user who already holds a membership never reaches the new branch, and no
  second membership is ever written;
- owner-preference in the active-org selection is unchanged, because the
  selection is one function called on both sides of the settle.

Cost is paid only where there is something to fix. A deployment that binds nobody
stops at the reconciler's own policy check without touching the store, and the
repeat lookup is gated on an outcome meaning a membership now exists — so an
ordinary sign-in issues no extra query.

Unchanged: `user.create.after` still reconciles (the creation paths that mint no
session at all — admin create-user, bulk import, SSO JIT — are untouched), the
host `session.create.before` hook still chains first and still wins,
`autoActiveOrganization: false` still opts out entirely, and a failing engine
still never breaks session creation.
