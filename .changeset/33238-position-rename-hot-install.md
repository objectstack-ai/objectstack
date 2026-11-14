---
'@objectstack/plugin-security': patch
---

fix(plugin-security): a declared position rename carries its holders after a hot install too, not only at boot (#33238)

Clause-②: no
Metadata-protocol: none

A position that declares `renamedFrom` moves the holders of each old name (`sys_user_position.position`) to the new one, as the system, in every organization. That carry ran only at `kernel:bootstrapped`. It now also runs on `metadata:reloaded` after the boot run, but a reload run judges only the renames declared by what the announcement names as registered at that moment, so the rule that a package never claims an old name it did not own holds on both paths. Within that scope the judgement is the boot's own, over the whole catalog: every refusal (claimed twice, still declared, held or owned by another package, switched off, a disabled claimant) applies the same way. Being idempotent, a run with nothing new moves nothing and writes nothing.

Carried at once, without a restart:

- a hot install through the marketplace install-local door (`/marketplace/install-local`), for the positions of the package it names (`app/ID`), when the old name is no position the running kernel still serves (for example, an install after the earlier version was uninstalled);
- a per-item publish of a position, and a package publish of drafts, for each position they publish (`position/NAME`).

Still carried at the next restart, by the boot run:

- a hot upgrade over a version the running kernel still serves: its old position keeps serving until the restart, so its holders keep it until then;
- the runtime's package install and enable routes, which do not announce `metadata:reloaded`;
- an artifact reload, which announces a file path and names no package or position.

An uninstall's announcement names a package no longer registered, so a withdrawal carries nothing. A reload heard before the boot run is ignored. Runs never overlap, and a run never fails the door that announced it. A reload run that moves no row does not read the other references it would leave behind, and a warning the run before already gave is not repeated; a move is always reported.
