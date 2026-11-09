---
'@objectstack/core': patch
'@objectstack/plugin-security': patch
---

feat(core, plugin-security)!: permission sets are read by (package, name), and a package position's sets resolve from its package

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) nothing an author writes is renamed, removed or re-shaped; the change is which permission set a position's bare name reads at runtime, so there is no stored or authored shape for objectstack migrate meta to rewrite -->

Permission sets are now resolved by (package, name) (ADR-0150 D3/D4/D7). The security catalog reads each permission set through the one package-scoped rule in `@objectstack/core` and the one declared-closure walk in `@objectstack/metadata-core`, and a position's `permissionSets` resolves from the package that declared the position: that package's own set, else the one holder in its declared dependency closure (plus `sys`), else a refusal that names every candidate. Stored grants, an environment-authored position, an administrator's overlay of a package position and the `everyone`/`guest` anchors still resolve across the whole environment, so they answer as before. Positions are unchanged: one environment-wide slot per name, and a second package holder is still refused. The permission-set list now has one entry per (package, name) holder.

Who is affected: a deployment where a package's position names a permission set that its package cannot reach. That happens when the set is held only by an environment-authored item, or only by a package outside the position package's declared dependencies. Before this change the bare name served that set. Now the position grants nothing through that name. The boot's catalog reference report lists each such position with every candidate holder. No first-party package or example does this.

Fix: declare a dependency on the package that holds the set, or bind the set through an administrator overlay of the position. An overlay resolves the set the way the environment does.

`@objectstack/core` now depends on `@objectstack/metadata-core` at runtime (it was a dev dependency), because the security catalog reads the declared-closure walk from there.
