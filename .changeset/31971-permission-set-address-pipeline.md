---
'@objectstack/core': patch
'@objectstack/plugin-security': patch
'@objectstack/objectql': patch
'@objectstack/service-automation': patch
'@objectstack/service-storage': patch
'@objectstack/plugin-audit': patch
'@objectstack/plugin-auth': patch
---

fix(security): carry each permission set's package from the grant to the per-request evaluation

Clause-②: no
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and nothing at rest changes shape. The two exports that move are server-side code interfaces with no spec schema and no stored form: one return field is renamed and one callback takes requests in place of names, and the FROM -> TO lines below are their whole migration. There is nothing for `objectstack migrate meta` to rewrite. -->

When two installed packages each ship a permission set of the same name, a request now gets the set its grant names and no other. The authorization resolver records the `(package, name)` each granted set resolved to on `ExecutionContext.permissionSetAddresses`, and the security plugin's evaluator reads every set through the security catalog at that address. It used to take the first set of the name the metadata list returned. A name that arrives with no address (an API key's seeded sets, an agent's scope ceiling, the baseline) resolves by ADR-0150 D3 with no caller: one holder answers as before, two or more are refused, naming every candidate once in the log, and nothing is granted.

The activation ledger now switches a set off per holder, through its row's `package_id`: switching off one package's `sales_rep` leaves another package's `sales_rep` granting. A set the `everyone` anchor carries because a deployment accepted a package's suggestion resolves at the package the suggestion row names. The access explainer reports the same holders enforcement reads. Every context built by hand from the resolver's grants (objectql's scoped context, a `runAs: 'user'` flow run, storage, the audit mention gate and the organization-administrator check) carries the addresses with the names.

A deployment where every set name has one holder sees no change.

**BREAKING** for code outside this repository that calls two server-internal exports:

- FROM `readDisabledCatalogNames(...).permissions` (a set of names) TO `readDisabledCatalogNames(...).permissionSets` (a set of holder keys), asked with `permissionSetSwitchedOff(disabled, packageId, name)` from `@objectstack/core`.
- FROM a fourth argument to `PermissionEvaluator.resolvePermissionSets` that takes names (`(names: string[]) => Promise<PermissionSet[]>`) TO a `CatalogSetLoader` that takes requests (`{ name, packageId? }[]`); wrap an old loader as `(requests) => old(requests.map((r) => r.name))`.
