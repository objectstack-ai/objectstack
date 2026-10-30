---
'@objectstack/service-automation': patch
---

fix(service-automation): a `runAs: 'user'` run carries its user's posture rung, so a flow run as the platform administrator is served the ledger's deployment-level rows its user's request is served (#28070)

Clause-②: yes (widening) — `RunIdentityContext` (barrel-exported), and so the data context `resolveRunDataContext` answers, gains an optional `posture` member, and `FlowUserGrants` gains one; a `runAs: 'user'` run seeded with `PLATFORM_ADMIN` is served the rows that rung admits.
Metadata-protocol: none

A request carries the posture rung its user resolves to (`ExecutionContext.posture`, derived in `@objectstack/core`'s `resolveUserAuthzGrants` and copied on by `resolveAuthzContext`). A `runAs: 'user'` automation run seeded the same user's positions, permission sets, peers and email through the same resolver, and no rung. Every reader keyed on the rung then answered the run as for a principal below it. The measured case: after #26750 the compliance ledger's deployment-level rows (`tenant_id` NULL) are served to `PLATFORM_ADMIN` alone, so a flow run as the platform administrator was served organization rows only. That failed closed (fewer rows, never more).

- **Now.** Run setup takes the rung off the resolution it already makes for the run's user (the automation plugin's grants bridge forwards `resolveUserAuthzGrants`' own `posture`; nothing in this package derives one), seeds it beside the positions and permission sets, and every data node carries it to the data engine. The platform administrator's run is served the deployment-level rows, as their request is.
- **Only with the grants it came from.** The rung is seeded exactly when the run's positions and permission sets are resolved at setup. A context that brought its own grants (a door's pre-resolved envelope, an agent's narrowed ceiling) gains no rung from a re-resolution, so a rung never stands beside grants it was not derived from. A value that names no rung is not carried.
- **After an approval decision.** The decision switch removes the submitter's rung with their other facts, and the decider's segment carries the decider's own.
- **Unchanged.** A `runAs: 'system'` run (elevated; no rung is resolved or carried). A member's run is served what the member's request is served, as before: a rung below `PLATFORM_ADMIN` admits nothing a missing one did not, and plugin-security's tenant-wall exemption already enforced the narrower of the carried rung and its capability probe.
- **Still without a rung.** A run started through the REST or action door, which forwards the request's positions and permission sets but not its rung, keeps failing closed for the rung's readers until that door forwards it.
