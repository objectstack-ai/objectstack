---
'@objectstack/plugin-security': patch
---

fix(plugin-security): a declared position rename carries its holders after a hot install too, not only at boot (#33238)

Clause-②: no
Metadata-protocol: none

A position that declares `renamedFrom` moves the holders of each old name (`sys_user_position.position`) to the new one, as the system, in every organization. That carry ran only at `kernel:bootstrapped`. It now also runs on `metadata:reloaded` after the boot run, but a reload run judges only the renames declared by what the announcement names as registered at that moment, so the rule that a package never claims an old name it did not own holds on both paths. Within that scope the judgement is the boot's own, over the whole catalog: every refusal (claimed twice, still declared, held or owned by another package, switched off, a disabled claimant) applies the same way. Being idempotent, a run with nothing new moves nothing and writes nothing.

Carried at once, without a restart:

- a hot install or upgrade through the marketplace install-local door (`/marketplace/install-local`), for the positions of the package it names (`app/ID`). An upgrade over a version the running kernel still serves is carried too: re-registering the package withdraws the position its new version no longer ships (`@objectstack/objectql`, #33050), so the old name is no position the kernel serves when the announcement is heard;
- a per-item publish of a position, and a package publish of drafts, for each position they publish (`position/NAME`);
- the runtime's package install (`POST /packages`) and the enable of a disabled package (`PATCH /packages/:id/enable`), which announce `app/ID` (`@objectstack/runtime`, #33302). A package still disabled when it is announced is not carried until the enable switches it on and announces it again.

Still carried at the next restart, by the boot run:

- an artifact reload, which announces a file path and names no package or position.

An uninstall's announcement names a package no longer registered, so a withdrawal carries nothing. A reload heard before the boot run is ignored. Runs never overlap, and a run never fails the door that announced it. A reload run that moves no row does not read the other references it would leave behind, and a warning the run before already gave is not repeated; a move is always reported.
