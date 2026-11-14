---
'@objectstack/plugin-security': patch
---

fix(plugin-security): a declared position rename carries its holders after a hot install too, not only at boot (#33238)

Clause-②: no
Metadata-protocol: none

A position that declares `renamedFrom` moves the holders of each old name (`sys_user_position.position`) to the new one, as the system, in every organization. That carry ran only at `kernel:bootstrapped`, so a package installed into a running kernel left them on the old name until the next restart. It now runs again on each `metadata:reloaded` after the boot run: the re-sync the marketplace install-local door announces once a hot install or upgrade has registered the package (and a package publish, a per-item publish and an artifact reload announce too). The judgement is the boot's own, over the catalog as it stands then: every refusal (claimed twice, still declared, held or owned by another package, switched off, a disabled claimant) applies the same way. Being idempotent, a run with nothing new moves nothing and writes nothing.

- A reload heard before the boot run is ignored, so nothing is judged against a catalog that is still filling. Runs never overlap. A run never fails the install that announced it.
- A warning the run before already gave (a refusal that still stands, a reference left behind) is not repeated at the next reload; a move is always reported.
- A hot upgrade over an installed version: the running kernel keeps serving the previous version's positions until the restart, so the old name reads as still declared and its holders keep it, and the position it names still serves. The boot after the restart carries them, as before.
- A door that registers positions without announcing `metadata:reloaded` (the runtime's package install and enable routes) is still carried at the next boot.
