---
'@objectstack/verify': patch
---

fix(verify): the RLS probe persona is provisioned through the registry — `provisionRlsProbePersona` no longer mints a `sys_permission_set` row

Clause-②: no

`provisionRlsProbePersona` used to find-or-create a `sys_permission_set` row named `verify_rls_probe` and grant it. Under ADR-0131 D3/D4 a permission set's one home is the registry: the authorization resolver reads the grant's `permission_set` name and takes the definition from the security catalog, never from a row. So a row this function minted was a copy of a definition nothing read.

It now:

- asks the security catalog (`securityCatalogReaderOf`, the read the resolver itself uses) whether `verify_rls_probe` is registered. `rlsProbeSecurity(config)` registers it at boot;
- reads the id of the row the boot already seeded for that registered set, because `sys_user_permission_set.permission_set_id` is still a required column;
- writes the one grant, carrying both columns.

It throws, writing nothing, when the catalog does not serve the probe set or the boot seeded no row for it. `objectstack verify --rls` reports either as a degraded probe persona and fails the run, as it already does for any provisioning failure. Fix for a caller that hits it: boot the stack with `rlsProbeSecurity(config)` as the `security` option of `bootStack`.
