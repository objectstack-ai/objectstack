---
'@objectstack/plugin-hono-server': patch
---

fix(hono-server): apply the baseline ADDITIVELY on `/auth/me/permissions` and `/me/apps` — the ADR-0090 D5 fallback cliff, one plane over (#7608)

Both permission resolutions in `current-user-endpoints.ts` applied the deployment
baseline permission set(s) only in a **second** `resolvePermissionSets` call gated on
`resolved.length === 0`. That is the fallback **cliff** D5 abolishes, verbatim:

> The fallback cliff is abolished. Today's semantics ("fallback applies only while the
> user has *zero* explicit grants") mean the first real grant silently removes the user's
> baseline. `everyone` is additive like any other position: baseline ∪ explicit, always.

`SecurityPlugin.resolvePermissionSetsForContext` — the **data** plane, one function call
away — has pushed the baseline into `requested` and resolved once for as long as D5 has
existed. These two endpoints had not, so the two planes disagreed the moment a member
held any explicit grant at all.

**What a user saw.** A member who received their **first** position or permission-set
grant kept the baseline on the data plane and lost it on the **UI** plane.
`/auth/me/permissions` reported object/field access narrower than a read actually
returns, and `/me/apps` dropped every app whose `requiredPermissions` or tab visibility
came from the baseline. Measured on the fixture that ships with this change — a member of
one org, a baseline granting two capabilities, one explicit grant adding a third —
receiving that grant took the member from **2 apps to 1**. It now takes them from 2 to
**3**: the two baseline apps are retained instead of traded away, and the same member
regains one readable object, one readable field and two capabilities on
`/auth/me/permissions`. The fail-direction was **closed** (the console hid what the API
allowed), which is why it read as cosmetic for as long as it did.

The baseline names are now pushed into `requested` before the **single** resolution, in
one shared `effectivePermissionSetNames` helper both handlers call — which retires the
second `resolvePermissionSets` call outright rather than merely widening its guard: once
the baseline is an input to the first call, a second call over a subset of those same
names can add nothing. Unchanged: a member with zero grants still gets the baseline, a
deployment declaring an empty baseline still resolves the caller's own names alone, and
`/me/apps` still filters an app whose `requiredPermissions` nobody holds.

No `principalKind === 'agent'` branch, unlike the plugin's copy, and that is a property
of this surface rather than an omission — these endpoints are reached only through the
better-auth **session** resolver, which never marks a principal kind, so an agent has no
session to present here.
