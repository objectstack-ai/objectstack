---
"@objectstack/plugin-auth": patch
---

fix(auth): a degraded tenancy posture must not hand out a default organization

`TenancyService.defaultOrgId()` documented "returns `null` under any walled
posture", but the implementation keyed on the posture actually **in force**
(`isolationActive()`) rather than the one the operator **requested**. Those two
disagree in exactly one state — DEGRADED: a deployment that asked for `group`
or `isolated` and could not enforce it (the enterprise `@objectstack/organizations`
package is absent) reports `posture: 'single'`, and the resolver then happily
answered with "the `slug='default'` org, or the only org that exists".

Everything downstream of that resolver binds new users to whatever it returns.
The membership reconciler (ADR-0093 D2) runs on `user.create.after` — the seam
every creation path flows through — so in a degraded deployment **every fresh
signup, admin-created user and SSO JIT user was auto-bound as a `member` of
whichever organization happened to be resolvable**, and `backfillMemberships`
(D6) would sweep the pre-existing member-less ones in on the next
`kernel:ready`.

This reached production. ObjectStack Cloud's control plane runs
`OS_MULTI_ORG_ENABLED=true` while deliberately not mounting the enterprise
package — it enforces its own control-plane org wall instead — so the
`org-scoping` probe missed, the posture resolved degraded, and self-serve
signups landed inside a stranger's organization with read access to that org's
environments (cloud#957).

`defaultOrgId()` now keys on `requestedPosture`: any walled request, enforced or
degraded, returns `null` and the framework never guesses. This is the same
judgement D6 already applies to the backfill — "a wrong org in a tenant-isolated
deployment is a data-exposure bug, not a convenience" — applied to the resolver
those consumers share. It also makes the resolver agree with the default-org
bootstrap in `AuthPlugin.start()`, which was already gated on the requested
posture.

Single-org deployments are unaffected: nothing about `requested: 'single'`
changes. A degraded deployment loses the auto-bind, which is the point — and
ADR-0093 D5 already refuses to boot that deployment at all unless the operator
sets `OS_ALLOW_DEGRADED_TENANCY=1`.
