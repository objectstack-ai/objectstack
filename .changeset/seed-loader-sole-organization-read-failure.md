---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): a failed `sys_organization` probe is no longer answered as "no sole organization" (#12852)

`SeedLoaderService.resolveSoleOrganizationId()` sat behind a bare `catch {}` whose
comment named ONE benign cause — "sys_organization may not exist (single-tenant
runtime)" — while the `catch` swallowed every cause. A dropped connection, a
timeout, a permission refusal or a driver fault all arrived at the caller as
`undefined`, which is not a neutral value here: it is the verdict the method's
own JSDoc calls "genuinely ambiguous", so `load()` stamped no `organization_id`
and every BUSINESS seed row of that run landed org-less — invisible afterwards
under strict org-scoping. Nothing reported it either: `SeedLoadResult` carries an
`errors` field and this path never touched it, so the operator saw a clean,
successful seed.

The repair is the one already landed on the sibling probe across the engine
boundary (`ObjectQL.probeInstallOrganizations`, #9817), copied: bind the
parameter and ask the declared predicate. Only an unprovisioned TABLE is
truthful emptiness — the exact cause the swallowed comment already named — so
the JSDoc's "or when `sys_organization` is absent" stays true, while every other
cause now propagates with its envelope intact.

Bump argued, not defaulted: `patch`. No exported signature, type or option
moves, and the declared answer for every case the JSDoc describes is unchanged.
What changes is a failure path — a seed run that used to complete while writing
invisible rows now fails loudly — which is the correction of a defect rather
than a new capability. The three landed repairs in this family (#8896, #8906,
#9817) all shipped as `patch`, and this is the site that pass missed.
